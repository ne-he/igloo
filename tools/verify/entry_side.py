"""Side-by-side scene entry vs rujukan (blueprint 10.1 titik 9 dan 10).

Pakai:  python tools/verify/entry_side.py [--tag m7a] [--out tools/verify/out/m7a_side.png]
Butuh screenshot dari verify.py --shots 5.65,6.5,7.5,8.5,9.5 --tag <tag>.
Baris: ref 12 vs n 5.65 (progress 0.2), ref 13 vs n 6.5 (0.33), ref 14 vs n 9.5 (0.79), lalu strip 5 shot kecil.
Tiap panel diberi label dan statistik luminans (p10 / median / p90) supaya beda eksposur kelihatan angka.
"""
import argparse
import os

import numpy as np
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
REF = os.path.join(ROOT, '_ref_screenshots')
OUT = os.path.join(HERE, 'out')
PAIRS = [('12_rings_portal_masuk.jpg', 5.65), ('13_rings_portal_depan.jpg', 6.5), ('14_room_partikel_pudgy.jpg', 9.5)]
STRIP = [5.65, 6.5, 7.5, 8.5, 9.5]
W, H = 560, 420


def stats(im):
    a = np.asarray(im.convert('L'), dtype=float) / 255
    return 'lum p10/50/90 %.2f/%.2f/%.2f' % tuple(np.percentile(a, [10, 50, 90]))


def panel(path, label):
    im = Image.open(path).convert('RGB').resize((W, H), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    txt = f'{label}  {stats(im)}'
    d.rectangle([0, H - 22, W, H], fill=(0, 0, 0))
    d.text((6, H - 18), txt, fill=(255, 255, 255))
    return im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tag', default='m7a')
    ap.add_argument('--out', default=None)
    args = ap.parse_args()
    sw, sh = (2 * W) // len(STRIP), (2 * W) // len(STRIP) * 3 // 4
    canvas = Image.new('RGB', (2 * W, len(PAIRS) * H + sh), (20, 20, 20))
    for row, (ref, n) in enumerate(PAIRS):
        canvas.paste(panel(os.path.join(REF, ref), f'ref {ref[:2]}'), (0, row * H))
        canvas.paste(panel(os.path.join(OUT, f'{args.tag}_n{n:.3f}.png'), f'kita n={n}'), (W, row * H))
    for i, n in enumerate(STRIP):
        p = os.path.join(OUT, f'{args.tag}_n{n:.3f}.png')
        if os.path.exists(p):
            im = Image.open(p).convert('RGB').resize((sw, sh), Image.LANCZOS)
            ImageDraw.Draw(im).text((4, 4), f'n={n}', fill=(0, 0, 0))
            canvas.paste(im, (i * sw, len(PAIRS) * H))
    out = args.out or os.path.join(OUT, f'{args.tag}_side.png')
    canvas.save(out)
    print('side-by-side:', os.path.relpath(out, ROOT))


if __name__ == '__main__':
    main()
