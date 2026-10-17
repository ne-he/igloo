"""Verifikasi partikel volume + carousel link ruang entry (M7b), GPU asli (Chromium headless, ANGLE D3D11).

Pakai:  python tools/verify/entry_particles.py [--url http://localhost:5196] [--n 9.5] [--q 0]
Butuh dev server jalan. Alur:
  1. catat GPU, kualitas partikel, statistik pre-sim (compile + 60 langkah)
  2. FPS di ruang 1280x800 (mouse diam), adaptive DPR mati
  3. kotak Visit diklik (request ke luar localhost dicegat, cuma url popup yang dicatat)
  4. ganti link 2x pakai panah kanan: frame saat pecah (+0.15 s), +1.2 s, +3 s
  5. sapuan mouse menembus bentuk: frame saat dan sesudah, FPS selama sapuan
  6. klik setengah kiri + swipe kanan (cek dua jalur ganti link lain), lalu side-by-side dengan ref 14
Output: tools/verify/out/m7b_p_*.png dan tools/verify/out/m7b_side.png. Exit 1 kalau ada error console.
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'out')
REF14 = os.path.join(ROOT, '_ref_screenshots', '14_room_partikel_pudgy.jpg')
ENTRY = '__igloo.engine.scenes.find((s) => s.key === "entry")'

FPS_JS = '''(secs) => new Promise((res) => {
  let frames = 0; const t0 = performance.now();
  const tick = () => { frames++; if (performance.now() - t0 < secs * 1000) requestAnimationFrame(tick);
    else res(frames / ((performance.now() - t0) / 1000)); };
  requestAnimationFrame(tick);
})'''

# FPS dengan sinkron GPU: tiap frame baca 1 piksel dari canvas sesudah engine merender (callback rAF kita
# terdaftar sesudah gsap.ticker), jadi CPU menunggu GPU selesai. Batas bawah yang jujur untuk biaya per frame;
# rAF biasa di headless tanpa vsync bisa jalan lebih cepat dari GPU karena frame dibuang.
FPS_SYNC_JS = '''(secs) => new Promise((res) => {
  const gl = __igloo.engine.renderer.getContext(); const px = new Uint8Array(4);
  let frames = 0; const t0 = performance.now();
  const tick = () => { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    frames++; if (performance.now() - t0 < secs * 1000) requestAnimationFrame(tick);
    else res(frames / ((performance.now() - t0) / 1000)); };
  requestAnimationFrame(tick);
})'''


def lum(path, box=None):
    im = Image.open(path).convert('L')
    if box:
        im = im.crop(box)
    a = np.asarray(im, dtype=float) / 255
    return 'p10/50/90 %.2f/%.2f/%.2f' % tuple(np.percentile(a, [10, 50, 90]))


def side_by_side(frames, out):
    W, H = 520, 390
    cols = 3
    tiles = [(REF14, 'ref 14')] + frames
    rows = (len(tiles) + cols - 1) // cols
    canvas = Image.new('RGB', (cols * W, rows * H), (20, 20, 20))
    for i, (path, label) in enumerate(tiles):
        im = Image.open(path).convert('RGB').resize((W, H), Image.LANCZOS)
        d = ImageDraw.Draw(im)
        d.rectangle([0, H - 22, W, H], fill=(0, 0, 0))
        d.text((6, H - 18), f'{label}  lum {lum(path)}', fill=(255, 255, 255))
        canvas.paste(im, ((i % cols) * W, (i // cols) * H))
    canvas.save(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://localhost:5196/')
    ap.add_argument('--n', type=float, default=9.5, help='titik scroll ruang (entry progress 0.755)')
    ap.add_argument('--q', default='', help='paksa langkah fallback (dev: ?pq=)')
    ap.add_argument('--width', type=int, default=1280)
    ap.add_argument('--height', type=int, default=800)
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    url = args.url + (f'?pq={args.q}' if args.q != '' else '')
    errors, warnings, popups = [], [], []
    frames = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu',
                                          '--disable-gpu-vsync', '--disable-frame-rate-limit'])
        ctx = browser.new_context(viewport={'width': args.width, 'height': args.height})
        # jangan benar-benar membuka situs luar dari tombol Visit
        ctx.route(lambda u: not u.startswith('http://localhost'), lambda r: r.fulfill(status=200, body='blocked by verify'))
        page = ctx.new_page()
        ctx.on('page', lambda pg: popups.append(pg))  # sesudah halaman utama, jadi cuma popup yang tercatat
        page.on('console', lambda m: (errors if m.type == 'error' else warnings if m.type == 'warning' else []).append(m.text))
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(url)
        page.wait_for_function('window.__igloo && document.getElementById("loader").classList.contains("hidden")',
                               timeout=90000)
        gpu = page.evaluate('''() => { const gl = __igloo.engine.renderer.getContext();
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); }''')
        info = page.evaluate(f'() => {{ const s = {ENTRY}; return {{ q: s.quality, stats: s.particles.stats, '
                             f'float: s.particles.type === 1015, size: s.particles.size }} }}')
        print('GPU:', gpu)
        print('kualitas:', json.dumps(info['q']), ' tekstur sim', info['size'], 'float' if info['float'] else 'half')
        st = info['stats']
        print(f"pre-sim: compileAsync {st.get('compileAsyncMs', 0):.0f} ms, init + langkah pertama (kompilasi draw "
              f"pertama) {st['presimCompileMs']:.0f} ms, total presim {st['presimMs']:.0f} ms, "
              f"{st['presimStepsMs']:.2f} ms per langkah")

        page.evaluate('__igloo.enableScroll(false); __igloo.adaptive(false)')
        page.evaluate(f'__igloo.setScroll({args.n})')
        page.mouse.move(args.width * 0.9, args.height * 0.15)  # mouse diam di pojok
        page.wait_for_timeout(2500)
        state = page.evaluate('__igloo.state()')
        print(f"ruang: n={args.n} p={state['current']['progress']:.3f} dpr {state['dpr']:.2f}")

        def shot(name, label):
            path = os.path.join(OUT, f'm7b_p_{name}.png')
            page.screenshot(path=path)
            frames.append((path, label))
            return path

        fps_idle = page.evaluate(FPS_JS, 4)
        fps_sync = page.evaluate(FPS_SYNC_JS, 4)
        print(f'FPS ruang diam {args.width}x{args.height}: rAF {fps_idle:.1f}, tersinkron GPU {fps_sync:.1f}')
        shot('0_github', 'link 0 GitHub (diam)')

        # ---- Visit ----
        rect = page.evaluate(f'() => {ENTRY}.linksUI.visitRect')
        page.mouse.click((rect['x0'] + rect['x1']) / 2, (rect['y0'] + rect['y1']) / 2)
        page.wait_for_timeout(800)
        popup_urls = [pg.url for pg in popups]
        print('Visit -> popup:', popup_urls or 'TIDAK ADA')
        for pg in popups:
            pg.close()
        idx = page.evaluate(f'() => {ENTRY}.linkIndex')
        print('index sesudah klik Visit (harus tetap 0):', idx)

        # ---- ganti link 2x dengan panah kanan ----
        # screenshot sendiri makan ratusan ms, jadi tunggu per titik waktu sejak tombol ditekan (jam halaman),
        # dan label memakai waktu yang benar-benar terukur
        page.evaluate("window.addEventListener('keydown', () => { window.__switchAt = performance.now() })")
        since = '(performance.now() - window.__switchAt) / 1000'
        for k, name in [(1, 'linkedin'), (2, 'email')]:
            page.keyboard.press('ArrowRight')
            for tag, at in [('burst', 0.15), ('1s', 1.0), ('3s', 3.0)]:
                page.wait_for_function(f'{since} >= {at}')
                t = page.evaluate(since)
                shot(f'{k}_{name}_{tag}', f'{name} +{t:.2f} s')
            print(f'panah kanan {k}: index', page.evaluate(f'() => {ENTRY}.linkIndex'),
                  'floor additional', round(page.evaluate(f'() => {ENTRY}.floorTime.additional'), 2))

        # ---- sapuan mouse menembus bentuk ----
        cx, cy = args.width / 2, args.height * 0.42
        page.mouse.move(cx - args.width * 0.25, cy)
        page.wait_for_timeout(200)
        fps_sweep = page.evaluate(f'''() => {{ window.__fpsP = ({FPS_JS})(1.0); return 1 }}''')
        for i in range(24):
            t = i / 23
            page.mouse.move(cx - args.width * 0.25 + t * args.width * 0.5, cy + np.sin(t * 6.28) * 40)
            page.wait_for_timeout(16)
        fps_sweep = page.evaluate('window.__fpsP')
        shot('sweep_during', 'sapuan mouse (saat)')
        page.wait_for_timeout(700)
        shot('sweep_after', 'sapuan +0.7 s')
        page.wait_for_timeout(2500)
        shot('sweep_settle', 'sapuan +3 s (kembali)')
        print(f'FPS selama sapuan mouse: {fps_sweep:.1f}')

        # ---- jalur ganti lain: klik setengah kiri, swipe ----
        before = page.evaluate(f'() => {ENTRY}.linkIndex')
        page.mouse.click(args.width * 0.2, args.height * 0.5)
        page.wait_for_timeout(300)
        after_click = page.evaluate(f'() => {ENTRY}.linkIndex')
        page.mouse.move(args.width * 0.7, args.height * 0.5)
        page.mouse.down()
        # 4 langkah 100 px tanpa jeda: jeda antar event cuma overhead Playwright (belasan ms), jauh di atas 1000 px/s.
        # Dengan jeda 16 ms laju terukur di headless sempat jatuh ke sekitar 900 px/s (di bawah ambang, benar ditolak).
        for i in range(4):
            page.mouse.move(args.width * 0.75 - (i + 1) * 100, args.height * 0.5)
        page.mouse.up()
        page.wait_for_timeout(300)
        after_swipe = page.evaluate(f'() => {ENTRY}.linkIndex')
        print(f'klik kiri: {before} -> {after_click} (harus -1), swipe kiri 400 px: {after_click} -> {after_swipe} (harus +1)')
        lost = page.evaluate('__igloo.engine.renderer.getContext().isContextLost()')
        print('context lost:', lost)
        browser.close()

    side = os.path.join(OUT, 'm7b_side.png')
    pick = [f for f in frames if any(k in f[0] for k in ('0_github', '1_linkedin_3s', '2_email_3s', '1_linkedin_burst',
                                                         'sweep_during'))]
    side_by_side(pick, side)
    print('side-by-side:', os.path.relpath(side, ROOT))
    print('console warning:', warnings if warnings else 'nol')
    print('console error:', errors if errors else 'nol')
    sys.exit(1 if errors else 0)


if __name__ == '__main__':
    main()
