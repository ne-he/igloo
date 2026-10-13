"""Bandingkan statistik warna render kita dengan screenshot referensi (M0.5 palette test).

Pakai:  python tools/verify/palette.py [--n 0.658] [--ref 03_hero_igloo_assembled] [--grade '{"contrast":1.2}']
        [--pointer 0.9,-0.9] [--side]   (--side: simpan <tag>_side.png, kita kiri, ref kanan)
Render diambil di 800x600 (ukuran screenshot referensi). Output: tabel metrik kita vs ref + selisih.
Metrik: rata-rata RGB, luminance p5/p50/p95, pojok kanan atas, pojok kiri bawah, pita atas, pita bawah, saturasi.
"""
import argparse
import json
import os

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'out')


def stats(path):
    im = np.asarray(Image.open(path).convert('RGB')).astype(float)
    h, w, _ = im.shape
    lum = 0.2126 * im[..., 0] + 0.7152 * im[..., 1] + 0.0722 * im[..., 2]
    m = lambda a: a.reshape(-1, 3).mean(0)
    return {
        'rata2': m(im),
        'lum p5/p50/p95': np.percentile(lum, [5, 50, 95]),
        'kanan atas': m(im[: h // 6, w * 4 // 5:]),
        'kiri bawah': m(im[h * 5 // 6:, : w // 5]),
        'pita atas': m(im[h // 10: h // 4]),
        'pita bawah': m(im[h * 3 // 4:]),
        'saturasi': np.array([(im.max(2) - im.min(2)).mean()]),
    }


def score(ours, ref):
    """Rata-rata selisih absolut semua metrik (makin kecil makin mirip)."""
    return float(np.mean([np.abs(ours[k] - ref[k]).mean() for k in ours]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://localhost:5179/')
    ap.add_argument('--n', type=float, default=0.658)
    ap.add_argument('--ref', default='03_hero_igloo_assembled')
    ap.add_argument('--grade', default='', help='JSON satu grade, atau beberapa dipisah | untuk sapuan')
    ap.add_argument('--tag', default='palette')
    ap.add_argument('--pointer', default='0,0', help='posisi pointer -1..1 (ref 03: mouse di luar igloo, 0.9,-0.9)')
    ap.add_argument('--side', action='store_true')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    ref = stats(os.path.join(ROOT, '_ref_screenshots', f'{args.ref}.jpg'))
    grades = [g for g in args.grade.split('|') if g.strip()] or ['']
    results = []
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        page = b.new_page(viewport={'width': 800, 'height': 600})
        page.set_default_timeout(150000)  # SwiftShader di mesin yang sibuk bisa lambat
        page.goto(args.url)
        page.wait_for_function('window.__igloo && document.getElementById("loader").classList.contains("hidden")', timeout=60000)
        page.evaluate('__igloo.enableScroll(false); __igloo.adaptive(false)')
        px, py = args.pointer.split(',')
        page.evaluate(f'__igloo.setScroll({args.n}); __igloo.setPointer({px}, {py}); __igloo.freeze(10)')
        for i, g in enumerate(grades):
            if g:
                page.evaluate(f'__igloo.engine.scenes[0].setGrade({g})')
            page.wait_for_timeout(2000)
            shot = os.path.join(OUT, f'{args.tag}_{i}_n{args.n:.3f}.png')
            page.screenshot(path=shot)
            results.append((score(stats(shot), ref), g, shot))
        b.close()
    results.sort(key=lambda r: r[0])
    if len(results) > 1:
        print('sapuan grade (skor = rata-rata selisih, makin kecil makin mirip):')
        for s, g, _ in results:
            print(f'  {s:6.1f}  {g}')
    best_score, best_grade, shot = results[0]
    print(f'terbaik: skor {best_score:.1f}  grade {best_grade or "(default)"}')
    ours = stats(shot)
    print(f'{"metrik":16s} {"kita":>24s} {"ref":>24s} {"selisih":>20s}')
    for k in ours:
        a, r = ours[k], ref[k]
        fmt = lambda v: '(' + ','.join(f'{x:.0f}' for x in v) + ')'
        print(f'{k:16s} {fmt(a):>24s} {fmt(r):>24s} {fmt(a - r):>20s}')
    print('screenshot:', os.path.relpath(shot, ROOT))
    if args.side:
        side = Image.new('RGB', (1600, 600))
        side.paste(Image.open(shot).convert('RGB').resize((800, 600)), (0, 0))
        side.paste(Image.open(os.path.join(ROOT, '_ref_screenshots', f'{args.ref}.jpg')).convert('RGB').resize((800, 600)), (800, 0))
        sp = os.path.join(OUT, f'{args.tag}_side.png')
        side.save(sp)
        print('side-by-side:', os.path.relpath(sp, ROOT))


if __name__ == '__main__':
    main()
