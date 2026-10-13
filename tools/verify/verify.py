"""Verifikasi headless projek igloo study (blueprint bagian 10).

Pakai:  python tools/verify/verify.py [--url http://localhost:5179] [--shots 0.658,1.85,3.35] [--autocenter]
Butuh dev server jalan. Screenshot disimpan di tools/verify/out/ (di-ignore git).

- shots: setScroll(n) lewat window.__igloo, freeze waktu, screenshot 1024x768 (resolusi sama dengan ref).
- autocenter: cek auto-center berjalan dengan waktu nyata (tidak bisa dicek di pane yang tersembunyi).
- selalu: kumpulkan error console + info renderer.
"""
import argparse
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')


def wait_ready(page):
    page.wait_for_function('window.__igloo && document.getElementById("loader").classList.contains("hidden")', timeout=60000)


def shots(page, ns, tag):
    page.evaluate('__igloo.enableScroll(false); __igloo.adaptive(false)')
    for n in ns:
        page.evaluate(f'__igloo.setScroll({n})')
        page.evaluate('__igloo.freeze(10)')
        page.wait_for_timeout(400)
        path = os.path.join(OUT, f'{tag}_n{n:.3f}.png')
        page.screenshot(path=path)
        st = page.evaluate('__igloo.state()')
        print(f'shot n={n:.3f} -> {st["current"]["key"]} p={st["current"]["progress"]:.3f} '
              f'next={st["next"]["key"] if st["next"] else "-"} tr={st["transition"]:.3f}  {os.path.relpath(path)}')
    page.evaluate('__igloo.unfreeze()')


def autocenter(page):
    cases = [(1.6, 0.658, 'transisi -> mundur ke istirahat igloo'),
             (1.9, 2.35, 'transisi -> maju ke kristal 1'),
             (3.1, 3.35, 'di kristal -> pusat terdekat'),
             (5.0, 5.65, 'transisi -> entry progress 0.2')]
    ok = True
    for start, expect, label in cases:
        page.evaluate(f'__igloo.setScroll({start}); __igloo.enableScroll(true); '
                      '__igloo.engine.scroll.lastInputTime = __igloo.engine.ticker.time * 1000')
        t0 = time.time()
        while time.time() - t0 < 9:
            page.wait_for_timeout(250)
            st = page.evaluate('__igloo.state()')
            if not st['centering'] and abs(st['n'] - expect) < 0.01 and time.time() - t0 > 1.5:
                break
        st = page.evaluate('__igloo.state()')
        good = abs(st['n'] - expect) < 0.01
        ok &= good
        print(f'autocenter {start} -> {st["n"]:.3f} (harap {expect}) {"OK" if good else "GAGAL"}  {label}  [{time.time() - t0:.1f}s]')
    page.evaluate('__igloo.enableScroll(false)')
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://localhost:5179/')
    ap.add_argument('--shots', default='')
    ap.add_argument('--tag', default='m0')
    ap.add_argument('--autocenter', action='store_true')
    ap.add_argument('--width', type=int, default=1024)
    ap.add_argument('--height', type=int, default=768)
    ap.add_argument('--gpu', action='store_true', help='pakai GPU asli (D3D11), jauh lebih cepat dari SwiftShader')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    errors = []
    with sync_playwright() as p:
        if args.gpu:
            flags = ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu']
        else:
            flags = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
        browser = p.chromium.launch(args=flags)
        page = browser.new_page(viewport={'width': args.width, 'height': args.height})
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(args.url)
        wait_ready(page)
        ok = True
        if args.shots:
            shots(page, [float(x) for x in args.shots.split(',')], args.tag)
        if args.autocenter:
            ok &= autocenter(page)
        info = page.evaluate('__igloo.info()')
        print('renderer.info', json.dumps(info))
        browser.close()
    print('console errors:', errors if errors else 'nol')
    sys.exit(0 if ok and not errors else 1)


if __name__ == '__main__':
    main()
