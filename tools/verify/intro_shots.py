"""Verifikasi timeline intro igloo (blueprint 6.5).

Pakai:  python tools/verify/intro_shots.py --url http://localhost:5191/ [--gpu] [--tag intro]
Butuh dev server jalan. Output: tools/verify/out/<tag>_t<detik>.png dan intro_sheet.png (contact sheet).

1. Real time: intro jalan sendiri setelah loader hilang. Dicek scroll terkunci sampai detik 5 dan UI muncul di 4.5.
2. Seek: __igloo.intro.seek(t) membekukan intro di detik t (kamera di-snap, waktu shader dibekukan), lalu screenshot.
3. Akhir: progress(1), semua kontrol intro harus kembali ke nilai default (sama dengan tanpa intro).
4. Skip: /?nointro dan deep link /portfolio/x harus langsung ke state akhir dengan scroll terbuka.
"""
import argparse
import json
import os
import sys

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright, Error as PWError

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'out')
TIMES = [0.3, 1.0, 1.6, 2.5, 4.0, 6.0]

READY = 'window.__igloo && document.getElementById("loader").classList.contains("hidden")'

# Nilai semua kontrol intro, dibandingkan dengan default (state tanpa intro).
DUMP_JS = '''(() => { const e = __igloo.engine, c = e.intro.c, v = (u) => [].concat(u).map((o) => +o.value.toFixed(4))
  return { progress: v(c.progress), progress2: v(c.progress2), mountainAlpha: v(c.mountainAlpha), skyProgress: v(c.skyProgress),
    gradientAlpha: v(c.gradientAlpha), iglooMaterialize: v(c.iglooMaterialize), breath: v(c.breath),
    outlineMaterialize: v(c.outlineMaterialize), outlineAlpha: v(c.outlineAlpha), cageProgress: v(c.cageProgress),
    cageAlpha: v(c.cageAlpha), digitsProgress: v(c.digitsProgress), digitsAlpha: v(c.digitsAlpha),
    snowAlpha: v(c.snowAlpha), smokeAlpha: v(c.smokeAlpha), touchAmount: v(c.touchAmount), introWeight: v(c.introWeight),
    bloom: +e.bloom.intensity.toFixed(4), iglooVisible: c.igloo.visible, cageVisible: c.cage.visible,
    digitsVisible: c.digits.visible, scrollEnabled: e.scroll.enabled, running: e.intro.running,
    uiStarted: e.ui.introStarted, n: +e.scroll.state.n.toFixed(4) } })()'''

EXPECT_FINAL = {
    'progress': [1], 'progress2': [1], 'mountainAlpha': [1], 'skyProgress': [1], 'gradientAlpha': [1],
    'iglooMaterialize': [1], 'breath': [1], 'outlineMaterialize': [1], 'outlineAlpha': [0], 'cageProgress': [1],
    'cageAlpha': [0], 'digitsProgress': [1], 'digitsAlpha': [0], 'snowAlpha': [1], 'smokeAlpha': [1, 1],
    'touchAmount': [1], 'introWeight': [1], 'bloom': 1, 'iglooVisible': True, 'cageVisible': False,
    'digitsVisible': False,
}


def frames(page, n):
    page.evaluate(f'new Promise(r => {{ let k = {n}; const f = () => (--k <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f) }})')


def check_final(label, dump):
    bad = {k: (dump[k], v) for k, v in EXPECT_FINAL.items() if dump[k] != v}
    print(f'{label}: {"OK, semua kontrol di nilai default" if not bad else "BEDA " + json.dumps(bad)}')
    return not bad


def realtime(page):
    """Intro asli: catat kunci scroll dan UI sepanjang 6 detik pertama."""
    ok = True
    log = []
    t0 = page.evaluate('__igloo.intro.time')
    while True:
        st = page.evaluate('({ t: __igloo.intro.time, s: __igloo.engine.scroll.enabled, ui: __igloo.engine.ui.introStarted,'
                           ' n: __igloo.engine.scroll.state.n })')
        log.append(st)
        if st['t'] >= 6.0 or len(log) > 200:
            break
        page.wait_for_timeout(250)
    for st in log:
        # toleransi satu sampel (250 ms) di sekitar batas
        if st['t'] < 4.9 and st['s']:
            ok = False
        if st['t'] < 4.4 and st['ui']:
            ok = False
    first_scroll = next((s['t'] for s in log if s['s']), None)
    first_ui = next((s['t'] for s in log if s['ui']), None)
    print(f'real time: mulai di t={t0:.2f}, scroll terbuka pertama terlihat t={first_scroll}, UI mulai terlihat t={first_ui}, '
          f'n saat intro={log[0]["n"]:.3f}  {"OK" if ok and first_scroll and first_ui else "GAGAL"}')
    return ok and first_scroll is not None and first_ui is not None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://localhost:5191/')
    ap.add_argument('--tag', default='intro')
    ap.add_argument('--width', type=int, default=1024)
    ap.add_argument('--height', type=int, default=768)
    ap.add_argument('--gpu', action='store_true', help='pakai GPU asli (D3D11)')
    ap.add_argument('--times', default='', help='daftar detik lain, mis. 2.0,2.2,3.0 (default 6 titik standar)')
    ap.add_argument('--sheet', default='intro_sheet.png')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    base = args.url.rstrip('/')
    times = [float(x) for x in args.times.split(',')] if args.times else TIMES

    errors = []
    paths = []
    ok = True
    with sync_playwright() as p:
        if args.gpu:
            flags = ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu']
        else:
            flags = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
        browser = p.chromium.launch(args=flags)
        page = browser.new_page(viewport={'width': args.width, 'height': args.height})
        page.set_default_timeout(240000)
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))

        # 1. real time
        for attempt in range(3):
            try:
                page.goto(base + '/')
                page.wait_for_function(READY, timeout=180000)
                good = realtime(page)
                page.wait_for_function('!__igloo.intro.running', timeout=20000)
                good &= check_final('akhir intro real time', page.evaluate(DUMP_JS))
                break
            except PWError as e:
                print(f'  real time terputus (dev server reload?), ulangi: {str(e).splitlines()[0]}')
                good = False
        ok &= good

        # 2. seek. Dev server bisa full reload kalau file lain berubah (agent lain), jadi tiap shot dicek
        # penanda window.__shotMark: kalau hilang, tunggu siap lagi lalu ulangi shot itu.
        def arm():
            page.wait_for_function(READY, timeout=180000)
            page.wait_for_function('__igloo.engine.intro', timeout=60000)
            page.evaluate('window.__shotMark = 1; __igloo.adaptive(false); __igloo.setPointer(0, 0)')

        arm()
        for t in times:
            path = os.path.join(OUT, f'{args.tag}_t{t:.1f}.png')
            for attempt in range(5):
                try:
                    page.evaluate(f'__igloo.intro.seek({t}); __igloo.freeze({10 + t})')
                    frames(page, 4)
                    page.evaluate(f'__igloo.intro.seek({t})')  # snap ulang setelah pointer/mouse settle
                    frames(page, 4)
                    page.screenshot(path=path)
                    d = page.evaluate(DUMP_JS)
                    if page.evaluate('window.__shotMark === 1') and abs(page.evaluate('__igloo.intro.time') - t) < 1e-3:
                        break
                except PWError:
                    pass
                print(f'  t={t:.1f}: halaman reload di tengah shot, ulangi')
                arm()
            print(f't={t:.1f}: igloo={d["iglooVisible"]} mat={d["iglooMaterialize"][0]} lembah={d["progress2"][0]} '
                  f'digits={d["digitsVisible"]}/{d["digitsAlpha"][0]} cage={d["cageVisible"]}/{d["cageAlpha"][0]} '
                  f'w={d["introWeight"][0]} ui={d["uiStarted"]}  {os.path.relpath(path, ROOT)}')
            paths.append((t, path))

        # 3. akhir lewat progress(1)
        page.evaluate('__igloo.intro.progress(1)')
        frames(page, 2)
        ok &= check_final('progress(1)', page.evaluate(DUMP_JS))
        page.evaluate('__igloo.unfreeze()')

        # 4. skip
        for url in (base + '/?nointro', base + '/portfolio/x'):
            page.goto(url)
            page.wait_for_function(READY, timeout=180000)
            d = page.evaluate(DUMP_JS)
            good = check_final(f'skip {url}', d) and d['scrollEnabled'] and not d['running']
            print(f'  scroll terbuka={d["scrollEnabled"]} running={d["running"]}  {"OK" if good else "GAGAL"}')
            ok &= good
        browser.close()

    # contact sheet 3 x 2
    tw, th = 512, 384
    sheet = Image.new('RGB', (tw * 3, th * 2), (40, 40, 48))
    for i, (t, path) in enumerate(paths):
        im = Image.open(path).convert('RGB').resize((tw, th))
        d = ImageDraw.Draw(im)
        d.rectangle((0, 0, 70, 18), fill=(0, 0, 0))
        d.text((6, 3), f't = {t:.1f} s', fill=(255, 255, 0))
        sheet.paste(im, ((i % 3) * tw, (i // 3) * th))
    sp = os.path.join(OUT, args.sheet)
    sheet.save(sp)
    print('contact sheet', os.path.relpath(sp, ROOT))
    print('console errors:', errors if errors else 'nol')
    sys.exit(0 if ok and not errors else 1)


if __name__ == '__main__':
    main()
