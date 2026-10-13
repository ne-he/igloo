"""Finalisasi aset kristal setelah build_crystals.py: bake PNG master -> WebP, glb mentah -> glb Draco.

Pakai (dari root projek):  python tools/blender/finalize_crystals.py
- PNG master tetap di tools/blender/out/bakes/ (tidak masuk public, tidak masuk git).
- Bake warna objek dalam: WebP 90. Normal dan roughness kristal juga WebP (lossy) karena isinya grain
  kristalin yang tidak bisa dikompres lossless dengan wajar. Normal 2048 di kualitas 80 (sekitar 0.7 MB per peta,
  92 = 1.2 MB tanpa beda yang terlihat setelah jitter refraksi), total peta kristal sekitar 2.9 MB.
- Draco lewat gltf-transform: posisi 14 bit, texcoord 12 bit (cukup untuk 2048), normal 10 bit.
"""
import os
import subprocess

from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
TEX = os.path.join(ROOT, 'public', 'assets', 'textures')
GEO = os.path.join(ROOT, 'public', 'assets', 'geometries')
RAW = os.path.join(ROOT, 'tools', 'blender', 'out')
BAKES = os.path.join(RAW, 'bakes')

JOBS = []
for n in (1, 2, 3):
    JOBS += [(f'crystal{n}_normal', 80), (f'crystal{n}_roughness', 88), (f'inner{n}_color', 90), (f'inner{n}_dark_color', 90)]
GEO_NAMES = [f'crystal{n}' for n in (1, 2, 3)] + [f'inner{n}' for n in (1, 2, 3)]


def main():
    os.makedirs(GEO, exist_ok=True)
    total = 0
    for name, q in JOBS:
        src = os.path.join(BAKES, f'{name}.png')
        if not os.path.exists(src):
            print('lewati (tidak ada):', src)
            continue
        dst = os.path.join(TEX, f'{name}.webp')
        Image.open(src).convert('RGB').save(dst, 'WEBP', quality=q, method=6)
        total += os.path.getsize(dst)
        print(f'{name}.webp {os.path.getsize(dst) / 1024:.0f} KB')
    cli = os.path.join(ROOT, 'node_modules', '@gltf-transform', 'cli', 'bin', 'cli.js')
    for n in GEO_NAMES:
        src = os.path.join(RAW, f'{n}.glb')
        dst = os.path.join(GEO, f'{n}.glb')
        subprocess.run(['node', cli, 'draco', src, dst, '--quantize-position', '14', '--quantize-texcoord', '12',
                        '--quantize-normal', '10'], check=True, cwd=ROOT, capture_output=True)
        total += os.path.getsize(dst)
        print(f'{n}.glb {os.path.getsize(src) / 1024:.1f} KB -> {os.path.getsize(dst) / 1024:.1f} KB (Draco)')
    print(f'total {total / 1024 / 1024:.2f} MB')


if __name__ == '__main__':
    main()
