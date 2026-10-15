"""Ukur FPS scene entry dengan GPU asli (Chromium headless, ANGLE D3D11).

Pakai:  python tools/verify/entry_perf.py [--url http://localhost:5194] [--width 1280 --height 800] [--secs 4]
        [--points 0.658,3.35]   (pembanding scene lain)
Butuh dev server jalan. Per titik scroll: setScroll(n), adaptive DPR dimatikan (DPR tetap), tunggu warm-up 1 s,
lalu hitung frame lewat requestAnimationFrame selama --secs detik. Juga mencatat avgFps ticker engine
dan error console. Waktu TIDAK dibekukan (asap dan glitch tetap bergerak).
"""
import argparse
import sys

from playwright.sync_api import sync_playwright

POINTS = [5.65, 6.5, 7.5, 8.5, 9.29, 9.5]  # 9.29 = istirahat ruang (progress 0.76)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://localhost:5194/')
    ap.add_argument('--width', type=int, default=1280)
    ap.add_argument('--height', type=int, default=800)
    ap.add_argument('--secs', type=float, default=4)
    ap.add_argument('--points', default='', help='daftar n dipisah koma (default titik entry)')
    args = ap.parse_args()
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu',
                                          '--disable-gpu-vsync', '--disable-frame-rate-limit'])
        page = browser.new_page(viewport={'width': args.width, 'height': args.height})
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(args.url)
        page.wait_for_function('window.__igloo && document.getElementById("loader").classList.contains("hidden")',
                               timeout=60000)
        gpu = page.evaluate('''() => {
            const gl = __igloo.engine.renderer.getContext();
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        }''')
        print('GPU:', gpu)
        page.evaluate('__igloo.enableScroll(false); __igloo.adaptive(false)')
        for n in ([float(x) for x in args.points.split(',')] if args.points else POINTS):
            page.evaluate(f'__igloo.setScroll({n})')
            page.wait_for_timeout(1000)
            fps = page.evaluate('''(secs) => new Promise((res) => {
                let frames = 0; const t0 = performance.now();
                const tick = () => { frames++; if (performance.now() - t0 < secs * 1000) requestAnimationFrame(tick);
                  else res(frames / ((performance.now() - t0) / 1000)); };
                requestAnimationFrame(tick);
            })''', args.secs)
            st = page.evaluate('__igloo.state()')
            print(f'n={n:.2f} {st["current"]["key"]} p={st["current"]["progress"]:.3f}  rAF {fps:.1f} fps  ticker {st["fps"]:.1f}  '
                  f'dpr {st["dpr"]:.2f}')
        browser.close()
    print('console errors:', errors if errors else 'nol')
    sys.exit(1 if errors else 0)


if __name__ == '__main__':
    main()
