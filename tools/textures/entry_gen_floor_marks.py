"""Bangkitkan tekstur tanda lantai ruang link (M7a). Dipakai HANYA sebagai input bake Blender, tidak dikirim ke web.

Pakai:  python tools/textures/entry_gen_floor_marks.py [--size N]
Output: tools/blender/out/floor_marks.png (grayscale, 1 = ukiran). Proyeksi atas: piksel tengah = pusat lantai,
lebar gambar = diameter lantai 3.6 (koordinat lokal lantai, sebelum skala runtime 0.73). Baris atas gambar = +y Blender.
Desain sendiri: lingkar putus-putus dan penanda kardinal di podium, garis konsentris + tick halus di cincin 1,
tick skala radial + blok glyph + busur pembatas di tiap ubin iterasi 2 (12 ubin) dan 3 (18 ubin).
Pembagian ubin harus sama dengan build_floor() di tools/blender/build_entry.py.
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'tools', 'blender', 'out')
FLOOR_R = 1.8
TILES = ((12, 1.05, 1.38), (18, 1.43, 1.8))


def main():
    S = int(sys.argv[sys.argv.index('--size') + 1]) if '--size' in sys.argv else 2048
    im = Image.new('L', (S, S), 0)
    d = ImageDraw.Draw(im)
    c = S / 2
    k = S / (2 * FLOOR_R)
    w = max(1, int(S / 900))

    def xy(r, a):
        return c + r * k * math.cos(a), c - r * k * math.sin(a)

    def circle(rr, width):
        d.ellipse([c - rr * k, c - rr * k, c + rr * k, c + rr * k], outline=255, width=width)

    # podium: lingkar putus-putus + 4 penanda diagonal
    for i in range(0, 72, 2):
        a0, a1 = i * 2 * math.pi / 72, (i + 0.7) * 2 * math.pi / 72
        d.line([xy(0.3, a0), xy(0.3, a1)], fill=255, width=w)
    for i in range(4):
        a = i * math.pi / 2 + math.pi / 4
        d.line([xy(0.18, a), xy(0.26, a)], fill=255, width=w * 2)
    # cincin 1: dua garis konsentris + tick tiap 5 derajat (panjang tiap 30 derajat)
    for rr in (0.66, 0.94):
        circle(rr, w)
    for i in range(72):
        a = i * 2 * math.pi / 72
        d.line([xy(0.66, a), xy(0.66 + (0.05 if i % 6 == 0 else 0.025), a)], fill=255, width=w)
    rs = np.random.default_rng(7)
    for count, r0, r1 in TILES:
        span = 2 * math.pi / count
        for t in range(count):
            a0 = t * span
            # tick skala di tepi luar ubin
            for s in range(1, 8):
                a = a0 + span * s / 8
                ln = 0.07 if s == 4 else 0.035
                d.line([xy(r1 - 0.03, a), xy(r1 - 0.03 - ln, a)], fill=255, width=w)
            # blok glyph: 3-5 persegi panjang kecil sejajar busur (rasa kode panel)
            rr = r0 + 0.06
            a = a0 + span * 0.18
            for g in range(int(rs.integers(3, 6))):
                da = rs.uniform(0.01, 0.035) * (1.4 / rr)
                ra = rr + rs.uniform(0, 0.08)
                hh = rs.uniform(0.012, 0.03)
                d.polygon([xy(ra, a), xy(ra, a + da), xy(ra + hh, a + da), xy(ra + hh, a)], fill=255)
                a += da + 0.012
            # busur pembatas tipis di sisi dalam ubin
            rr = r0 + 0.03
            d.arc([c - rr * k, c - rr * k, c + rr * k, c + rr * k],
                  -math.degrees(a0 + span * 0.92), -math.degrees(a0 + span * 0.55), fill=255, width=w)
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'floor_marks.png')
    im.save(path, optimize=True)
    print(f'floor_marks.png {S}px cakupan ukiran {np.asarray(im).mean() / 255 * 100:.1f}%')


if __name__ == '__main__':
    main()
