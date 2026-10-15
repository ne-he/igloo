"""Finalisasi aset entry setelah build_entry.py: denoise + isi gutter + WebP/PNG untuk bake, Draco untuk glb.

Pakai (dari root projek):  python tools/blender/finalize_entry.py
- Bake warna (ring_a_color, ring_b_color 1024, floor_color 2048): sample rendah (CPU dibagi), jadi noise
  dibersihkan blur gaussian bertopeng (hanya di piksel yang ter-bake, sigma 0.7 px per 1024), lalu piksel di luar
  pulau + margin diisi rata-rata warna pulau supaya mipmap jauh tidak bocor hitam. WebP kualitas 90.
- Masker glow cincin (ring_a_glow, ring_b_glow 256): data, jadi PNG grayscale lossless, gutter = 0.
- Draco lewat gltf-transform: posisi 14 bit, texcoord 12 bit, generic 12 bit (atribut _centr/_rand/_glow dst).
- Cetak ukuran tiap aset dan total public/assets (batas keras 12 MB).
PNG master tetap di tools/blender/out/bakes/ (tidak masuk public, tidak masuk git).
"""
import json
import os
import struct
import subprocess

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ASSETS = os.path.join(ROOT, 'public', 'assets')
TEX = os.path.join(ASSETS, 'textures')
GEO = os.path.join(ASSETS, 'geometries')
RAW = os.path.join(ROOT, 'tools', 'blender', 'out')
BAKES = os.path.join(RAW, 'bakes')
COLOR = ['ring_a_color', 'ring_b_color', 'floor_color']
GLOW = ['ring_a_glow', 'ring_b_glow']
GEOS = ['ring_a', 'ring_b', 'floor']


def masked_blur(rgb, mask, sigma):
    m = mask.astype(np.float32)
    w = gaussian_filter(m, sigma)
    out = rgb.astype(np.float32).copy()
    for c in range(rgb.shape[-1]):
        b = gaussian_filter(rgb[..., c].astype(np.float32) * m, sigma)
        out[..., c] = np.where(mask, b / np.maximum(w, 1e-4), out[..., c])
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)


def finalize_color(name):
    src = os.path.join(BAKES, f'{name}.png')
    if not os.path.exists(src):
        print('lewati (tidak ada):', src)
        return 0
    im = np.asarray(Image.open(src).convert('RGBA')).copy()
    size = im.shape[0]
    cov = im[..., 3] > 127
    im[..., :3] = masked_blur(im[..., :3], cov, 0.7 * size / 1024)
    mean = im[cov, :3].mean(0)
    im[~cov, :3] = mean.round().astype(np.uint8)
    dst = os.path.join(TEX, f'{name}.webp')
    Image.fromarray(im[..., :3]).save(dst, 'WEBP', quality=90, method=6)
    m = mean / 255
    print(f'{name}.webp {size}px {os.path.getsize(dst) / 1024:.0f} KB  rata2 pulau {np.round(m, 3)} '
          f'(lum {m @ [0.2126, 0.7152, 0.0722]:.3f}), cakupan {cov.mean() * 100:.1f}%')
    return os.path.getsize(dst)


def finalize_glow(name):
    src = os.path.join(BAKES, f'{name}.png')
    if not os.path.exists(src):
        print('lewati (tidak ada):', src)
        return 0
    im = np.asarray(Image.open(src).convert('RGBA'))
    cov = im[..., 3] > 127
    g = np.where(cov, im[..., 0], 0).astype(np.uint8)
    dst = os.path.join(TEX, f'{name}.png')
    Image.fromarray(g, 'L').save(dst, optimize=True)
    print(f'{name}.png {g.shape[0]}px {os.path.getsize(dst) / 1024:.1f} KB  rata2 {g[cov].mean() / 255:.3f}, '
          f'maks {g.max() / 255:.2f}')
    return os.path.getsize(dst)


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


def dir_size(path):
    return sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(path) for f in fs)


def main():
    os.makedirs(GEO, exist_ok=True)
    total = 0
    for n in COLOR:
        total += finalize_color(n)
    for n in GLOW:
        total += finalize_glow(n)
    cli = os.path.join(ROOT, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js')
    for n in GEOS:
        src = os.path.join(RAW, f'{n}.glb')
        dst = os.path.join(GEO, f'{n}.glb')
        if not os.path.exists(src):
            print('lewati (tidak ada):', src)
            continue
        subprocess.run(['node', cli, 'draco', src, dst, '--quantize-position', '14', '--quantize-texcoord', '12',
                        '--quantize-generic', '12'], check=True, cwd=ROOT, capture_output=True)
        total += os.path.getsize(dst)
        print(f'{n}.glb {os.path.getsize(src) / 1024:.1f} KB -> {os.path.getsize(dst) / 1024:.1f} KB (Draco)')
        for attrs, draco in glb_attributes(dst):
            print('  atribut:', attrs, '| draco:', draco)
    clouds = os.path.join(TEX, 'clouds_noise.png')
    if os.path.exists(clouds):
        total += os.path.getsize(clouds)
    print(f'aset entry total {total / 1024:.0f} KB, public/assets total {dir_size(ASSETS) / 1024 / 1024:.2f} MB')


if __name__ == '__main__':
    main()
