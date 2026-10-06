"""Finalisasi aset lembah setelah build_valley.py: bake PNG -> WebP, glb mentah -> glb Draco.

Pakai (dari root projek):  python tools/blender/finalize.py
- Bake PNG master dipindah ke tools/blender/out/bakes/ (tidak masuk git, ukurannya besar).
- WebP kualitas 90 untuk bake warna (lossy aman untuk bake, BUKAN untuk tekstur data/MSDF).
- Draco lewat gltf-transform, kuantisasi sama dengan aset referensi: posisi 14 bit, generic 12 bit.
"""
import os
import shutil
import subprocess

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TEX = os.path.join(ROOT, 'public', 'assets', 'textures')
GEO = os.path.join(ROOT, 'public', 'assets', 'geometries')
RAW = os.path.join(ROOT, 'tools', 'blender', 'out')
BAKES = os.path.join(RAW, 'bakes')

BAKE_NAMES = ['ground_color', 'ground_glow', 'mountain_color']
GEO_NAMES = ['ground', 'mountain']


def main():
    os.makedirs(GEO, exist_ok=True)
    os.makedirs(BAKES, exist_ok=True)
    for n in BAKE_NAMES:
        src = os.path.join(TEX, f'{n}.png')
        if not os.path.exists(src):
            print('lewati (tidak ada):', src)
            continue
        dst = os.path.join(TEX, f'{n}.webp')
        Image.open(src).convert('RGB').save(dst, 'WEBP', quality=90, method=6)
        shutil.move(src, os.path.join(BAKES, f'{n}.png'))
        print(f'{n}.webp {os.path.getsize(dst) / 1024:.0f} KB')
    cli = os.path.join(ROOT, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js')
    for n in GEO_NAMES:
        src = os.path.join(RAW, f'{n}.glb')
        dst = os.path.join(GEO, f'{n}.glb')
        subprocess.run(['node', cli, 'draco', src, dst, '--quantize-position', '14', '--quantize-generic', '12'],
                       check=True, cwd=ROOT, capture_output=True)
        print(f'{n}.glb {os.path.getsize(src) / 1024:.1f} KB -> {os.path.getsize(dst) / 1024:.1f} KB (Draco)')


if __name__ == '__main__':
    main()
