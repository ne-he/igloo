"""Finalisasi aset igloo setelah build_igloo.py: gutter fill + WebP untuk bake, Draco untuk glb.

Pakai (dari root projek):  python tools/blender/finalize_igloo.py
- Gutter (piksel di luar pulau UV) diisi lavender bayangan #727B9C supaya mipmap tidak bocor jahitan gelap.
  Pulau diambil dari tools/blender/out/igloo_uv_rects.json (UV gaya Blender, v dari bawah).
- Bake bata di-sample rendah (CPU dibagi), jadi noise dibersihkan blur gaussian bertopeng (hanya di dalam
  pulau, sigma 0.8 px di 2048) sebelum gutter diisi.
- WebP kualitas 90 (bake warna saja). PNG master dipindah ke tools/blender/out/bakes/.
- Draco lewat gltf-transform: posisi 14 bit, texcoord 12 bit, generic 12 bit (setara aset referensi).
- Cetak rata-rata warna (sRGB 0..1) piksel yang tertutup pulau, dibanding bake tanah lembah.
"""
import json
import os
import shutil
import struct
import subprocess

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TEX = os.path.join(ROOT, 'public', 'assets', 'textures')
GEO = os.path.join(ROOT, 'public', 'assets', 'geometries')
RAW = os.path.join(ROOT, 'tools', 'blender', 'out')
BAKES = os.path.join(RAW, 'bakes')
GUTTER = np.array([0x72, 0x7B, 0x9C], dtype=np.uint8)


def coverage_mask(size, rects, expand_px=4):
    m = np.zeros((size, size), dtype=bool)
    e = expand_px / 2048
    for u0, v0, u1, v1, *_ in rects:
        c0, c1 = max(0, int(np.floor((u0 - e) * size))), min(size, int(np.ceil((u1 + e) * size)))
        r0, r1 = max(0, int(np.floor((1 - v1 - e) * size))), min(size, int(np.ceil((1 - v0 + e) * size)))
        m[r0:r1, c0:c1] = True
    return m


def masked_blur(rgb, mask, sigma):
    m = mask.astype(np.float32)
    w = gaussian_filter(m, sigma)
    out = rgb.astype(np.float32).copy()
    for c in range(3):
        b = gaussian_filter(rgb[..., c].astype(np.float32) * m, sigma)
        out[..., c] = np.where(mask, b / np.maximum(w, 1e-4), out[..., c])
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def finalize_bake(name, rects, denoise=0.0):
    src = os.path.join(TEX, f'{name}.png')
    if not os.path.exists(src):
        print('lewati (tidak ada):', src)
        return
    im = np.asarray(Image.open(src).convert('RGBA')).copy()
    size = im.shape[0]
    stats = ''
    if rects is not None:
        cov = coverage_mask(size, rects)
        baked = im[..., 3] > 127
        if denoise > 0:
            im[..., :3] = masked_blur(im[..., :3], cov & baked, denoise * size / 2048)
        fill = ~cov | ~baked
        im[fill, :3] = GUTTER
        inside = cov & baked
        mean = im[inside, :3].mean(0) / 255
        stats = f'rata2 pulau {np.round(mean, 3)} (lum {mean @ [0.2126, 0.7152, 0.0722]:.3f}), cakupan {inside.mean() * 100:.1f}%'
        if rects and len(rects[0]) > 4:
            outer = coverage_mask(size, [r for r in rects if r[4] == 5], expand_px=-2) & baked
            mo = im[outer, :3].mean(0) / 255
            stats += f', muka luar {np.round(mo, 3)} (lum {mo @ [0.2126, 0.7152, 0.0722]:.3f})'
    else:
        mean = im[..., :3].reshape(-1, 3).mean(0) / 255
        stats = f'rata2 {np.round(mean, 3)} (lum {mean @ [0.2126, 0.7152, 0.0722]:.3f})'
    dst = os.path.join(TEX, f'{name}.webp')
    Image.fromarray(im[..., :3]).save(dst, 'WEBP', quality=90, method=6)
    os.makedirs(BAKES, exist_ok=True)
    shutil.move(src, os.path.join(BAKES, f'{name}.png'))
    print(f'{name}.webp {size}px {os.path.getsize(dst) / 1024:.0f} KB  {stats}')


def glb_attributes(path):
    with open(path, 'rb') as f:
        data = f.read()
    n = struct.unpack('<I', data[12:16])[0]
    js = json.loads(data[20:20 + n])
    out = []
    for m in js.get('meshes', []):
        for p in m['primitives']:
            draco = p.get('extensions', {}).get('KHR_draco_mesh_compression')
            out.append((sorted(p['attributes']), sorted(draco['attributes']) if draco else None))
    return out


def main():
    rects_path = os.path.join(RAW, 'igloo_uv_rects.json')
    rects = json.load(open(rects_path)) if os.path.exists(rects_path) else None
    for n in ['igloo_color', 'igloo_exploded_color']:
        finalize_bake(n, rects, denoise=0.8)
    finalize_bake('ground_color_igloo', None)
    ref = os.path.join(TEX, 'ground_color.webp')
    if os.path.exists(ref):
        m = np.asarray(Image.open(ref).convert('RGB')).reshape(-1, 3).mean(0) / 255
        print(f'pembanding ground_color.webp rata2 {np.round(m, 3)} (lum {m @ [0.2126, 0.7152, 0.0722]:.3f})')

    cli = os.path.join(ROOT, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js')
    src = os.path.join(RAW, 'igloo.glb')
    dst = os.path.join(GEO, 'igloo.glb')
    if os.path.exists(src):
        os.makedirs(GEO, exist_ok=True)
        subprocess.run(['node', cli, 'draco', src, dst, '--quantize-position', '14', '--quantize-texcoord', '12',
                        '--quantize-generic', '12'], check=True, cwd=ROOT, capture_output=True)
        print(f'igloo.glb {os.path.getsize(src) / 1024:.1f} KB -> {os.path.getsize(dst) / 1024:.1f} KB (Draco)')
        for attrs, draco in glb_attributes(dst):
            print('  atribut:', attrs, '| draco:', draco)


if __name__ == '__main__':
    main()
