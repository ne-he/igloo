"""Kecilkan normal map kristal untuk web (audit 11 Nov 2026): 2048 -> 1536, WebP q84.
Tiga file ini dulu 2,1 MB dari 7,8 MB muatan awal. Di layar kristal cuma mengisi sekitar 500 px, jadi 1536 cukup (1024 mulai menghapus retakan halus di bola dalam kristal 3).
Sumber 2048 asli tersimpan di branch git `v2-before-audit` (public/assets/textures/crystalN_normal.webp).

Pakai:  python tools/textures/shrink_normals.py [--size 1536] [--quality 84] [--ref v2-before-audit]
"""
import argparse, io, os, subprocess
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--size', type=int, default=1536)
    ap.add_argument('--quality', type=int, default=84)
    ap.add_argument('--ref', default='v2-before-audit', help='ref git tempat file 2048 asli berada')
    a = ap.parse_args()
    for n in (1, 2, 3):
        rel = f'public/assets/textures/crystal{n}_normal.webp'
        src = subprocess.run(['git', 'show', f'{a.ref}:{rel}'], cwd=ROOT, capture_output=True, check=True).stdout
        im = Image.open(io.BytesIO(src)).convert('RGB')
        out = os.path.join(ROOT, rel)
        im.resize((a.size, a.size), Image.LANCZOS).save(out, 'WEBP', quality=a.quality, method=6)
        print(f'{rel}: {len(src) / 1e6:.2f} MB {im.size[0]} px -> {os.path.getsize(out) / 1e6:.2f} MB {a.size} px')

if __name__ == '__main__':
    main()
