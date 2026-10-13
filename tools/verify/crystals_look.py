"""Tuning tampilan kristal (M5b): screenshot GPU dengan potongan JS yang dijalankan sebelum jepret.

Pakai:  python tools/verify/crystals_look.py --n 3.35 --tag look_a --js "__igloo.engine.scenes[1].ice.uIceBright.value = 1.2"
Bisa beberapa varian sekaligus: --variant nama=JS (diulang). Hasil: tools/verify/out/crystals_<tag>_<nama>.png
Satu halaman dipakai untuk semua varian (tanpa reload), JS varian dijalankan berurutan di atas JS dasar.
"""
import argparse
import os

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
GPU = ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://localhost:5192/')
    ap.add_argument('--n', type=float, default=3.35)
    ap.add_argument('--tag', default='look')
    ap.add_argument('--js', default='')
    ap.add_argument('--variant', action='append', default=[])
    ap.add_argument('--width', type=int, default=1024)
    ap.add_argument('--height', type=int, default=768)
    ap.add_argument('--crop', default='', help='x,y,w,h potong hasil (piksel)')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    errors = []
    variants = [v.split('=', 1) for v in args.variant] or [['base', '']]
    with sync_playwright() as p:
        browser = p.chromium.launch(args=GPU)
        page = browser.new_page(viewport={'width': args.width, 'height': args.height})
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(args.url)
        page.wait_for_function('window.__igloo && document.getElementById("loader").classList.contains("hidden")', timeout=60000)
        page.evaluate('__igloo.enableScroll(false); __igloo.adaptive(false)')
        page.evaluate(f'__igloo.setScroll({args.n})')
        if args.js:
            page.evaluate(args.js)
        for name, js in variants:
            if js:
                page.evaluate(js)
            page.evaluate('__igloo.freeze(10)')
            page.wait_for_timeout(1200)
            path = os.path.join(OUT, f'crystals_{args.tag}_{name}.png')
            clip = None
            if args.crop:
                x, y, w, h = [int(v) for v in args.crop.split(',')]
                clip = {'x': x, 'y': y, 'width': w, 'height': h}
            page.screenshot(path=path, clip=clip)
            print('->', os.path.relpath(path))
        browser.close()
    print('console errors:', errors if errors else 'nol')


if __name__ == '__main__':
    main()
