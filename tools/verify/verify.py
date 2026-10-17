"""Verifikasi headless projek igloo study (blueprint bagian 10).

Pakai:  python tools/verify/verify.py [--url http://localhost:5179] [--shots 0.658,1.85,3.35] [--autocenter]
        [--gpu] [--nofloat] [--simulate-reload] [--stress-ms 600]
Butuh dev server jalan. Screenshot disimpan di tools/verify/out/ (di-ignore git).

- shots: setScroll(n) lewat window.__igloo, freeze waktu, screenshot 1024x768 (resolusi sama dengan ref).
- autocenter: cek auto-center berjalan dengan waktu nyata (tidak bisa dicek di pane yang tersembunyi).
- selalu: kumpulkan error console + info renderer.
- tahan reload (M8): Vite melakukan full reload kalau ada file yang berubah di tengah run. Tiap langkah
  (satu shot, satu kasus autocenter) yang terkena reload menunggu halaman siap lagi lalu diulang SEKALI.
  --simulate-reload memicu satu reload di tengah shot pertama untuk membuktikan jalur ini.
- --nofloat: sembunyikan EXT_color_buffer_float/half_float (init script) untuk menguji fallback RT UnsignedByte.
"""
import argparse
import json
import os
import sys
import time

from playwright.sync_api import sync_playwright, Error as PlaywrightError

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')

# Matikan ekstensi render float sebelum script halaman jalan (uji fallback rtType.js)
NOFLOAT_JS = """
(() => {
  const hide = new Set(['EXT_color_buffer_float', 'EXT_color_buffer_half_float'])
  for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
    if (!C) continue
    const get = C.prototype.getExtension
    C.prototype.getExtension = function (name) { return hide.has(name) ? null : get.call(this, name) }
    const list = C.prototype.getSupportedExtensions
    C.prototype.getSupportedExtensions = function () { return (list.call(this) || []).filter((n) => !hide.has(n)) }
  }
})()
"""


def wait_ready(page):
    page.wait_for_function('window.__igloo && document.getElementById("loader").classList.contains("hidden")', timeout=60000)


class Navs:
    """Hitung navigasi frame utama (full reload Vite = navigasi baru)."""

    def __init__(self, page):
        self.count = 0
        page.on('framenavigated', lambda f: self._on(f, page))

    def _on(self, frame, page):
        if frame == page.main_frame:
            self.count += 1


RELOAD_HINTS = ('context was destroyed', 'navigat', 'Target closed', 'Cannot find context', '__igloo is not defined')


def step(page, navs, label, fn):
    """Jalankan satu langkah. Kalau halaman reload selama langkah (exception atau hitungan navigasi berubah),
    tunggu siap lagi lalu ulang sekali. Langkah kedua yang gagal dilempar apa adanya."""
    for attempt in (1, 2):
        before = navs.count
        try:
            result = fn()
            if navs.count == before:
                return result
            reason = 'navigasi terdeteksi'
        except PlaywrightError as e:
            msg = str(e)
            if attempt == 2 or (navs.count == before and not any(h in msg for h in RELOAD_HINTS)):
                raise
            reason = msg.splitlines()[0][:90]
        if attempt == 2:
            raise RuntimeError(f'{label}: halaman reload lagi saat diulang')
        print(f'[reload] {label}: {reason}. Tunggu siap, ulang sekali.')
        wait_ready(page)
        prepare(page)


def prepare(page):
    page.evaluate('__igloo.enableScroll(false); __igloo.adaptive(false)')


def shots(page, navs, ns, tag, simulate_reload=False):
    prepare(page)
    for i, n in enumerate(ns):
        def one(n=n, i=i):
            page.evaluate(f'__igloo.setScroll({n})')
            page.evaluate('__igloo.freeze(10)')
            if simulate_reload and i == 0 and navs.count == 1:
                page.evaluate('setTimeout(() => location.reload(), 0)')
            page.wait_for_timeout(400)
            path = os.path.join(OUT, f'{tag}_n{n:.3f}.png')
            page.screenshot(path=path)
            st = page.evaluate('__igloo.state()')
            return path, st
        path, st = step(page, navs, f'shot {n:.3f}', one)
        print(f'shot n={n:.3f} -> {st["current"]["key"]} p={st["current"]["progress"]:.3f} '
              f'next={st["next"]["key"] if st["next"] else "-"} tr={st["transition"]:.3f}  {os.path.relpath(path)}')
    page.evaluate('__igloo.unfreeze()')


def autocenter(page, navs):
    cases = [(1.6, 0.658, 'transisi -> mundur ke istirahat igloo'),
             (1.9, 2.35, 'transisi -> maju ke kristal 1'),
             (3.1, 3.35, 'di kristal -> pusat terdekat'),
             (5.0, 5.65, 'transisi -> entry progress 0.2')]
    # Batas waktu dihitung dalam WAKTU ENGINE (gsap.ticker), bukan jam dinding. gsap lagSmoothing menahan
    # waktu saat ada frame > 500 ms (GPU sibuk, SwiftShader, agent lain merender), jadi idle 1.4 s + tween
    # bisa makan jauh lebih lama di jam dinding. Batas lama "9 s dinding" membuat kasus 1.6 -> 0.658
    # (idle 1.4 + tween 3.38 s) kadang berhenti di n sekitar 0.72 padahal tween masih berjalan benar.
    ok = True
    for start, expect, label in cases:
        def one(start=start, expect=expect):
            page.evaluate('__igloo.unfreeze()')
            plan = page.evaluate(f'__igloo.setScroll({start}); __igloo.enableScroll(true); '
                                 '__igloo.engine.scroll.lastInputTime = __igloo.engine.ticker.time * 1000; '
                                 f'__igloo.engine.scroll.planAutoCenter({start})')
            budget = 1.4 + (plan['duration'] if plan else 0) + 1.5  # idle + tween + margin, detik engine
            e0 = page.evaluate('__igloo.engine.ticker.time')
            t0 = time.time()
            while time.time() - t0 < 45:
                page.wait_for_timeout(250)
                st = page.evaluate('[__igloo.state(), __igloo.engine.ticker.time]')
                st, et = st[0], st[1] - e0
                if not st['centering'] and abs(st['n'] - expect) < 0.01 and et > 1.5:
                    break
                if et > budget:
                    break
            et = page.evaluate('__igloo.engine.ticker.time') - e0
            return page.evaluate('__igloo.state()'), time.time() - t0, et
        st, dt, et = step(page, navs, f'autocenter {start}', one)
        good = abs(st['n'] - expect) < 0.01
        ok &= good
        print(f'autocenter {start} -> {st["n"]:.3f} (harap {expect}) {"OK" if good else "GAGAL"}  {label}  '
              f'[{dt:.1f}s dinding, {et:.1f}s engine]')
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
    ap.add_argument('--nofloat', action='store_true', help='uji fallback tanpa render target float')
    ap.add_argument('--simulate-reload', action='store_true', help='picu satu reload di tengah shot pertama')
    ap.add_argument('--stress-ms', type=int, default=0, help='sisipkan macet main thread N ms tiap 900 ms (uji batas waktu engine)')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    errors = []
    warnings = []
    with sync_playwright() as p:
        if args.gpu:
            flags = ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu']
        else:
            flags = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
        browser = p.chromium.launch(args=flags)
        page = browser.new_page(viewport={'width': args.width, 'height': args.height})
        if args.nofloat:
            page.add_init_script(NOFLOAT_JS)
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else (warnings.append(m.text) if m.type == 'warning' else None))
        page.on('pageerror', lambda e: errors.append(str(e)))
        navs = Navs(page)
        page.goto(args.url)
        wait_ready(page)
        if args.stress_ms:
            page.evaluate(f'setInterval(() => {{ const t = performance.now(); while (performance.now() - t < {args.stress_ms}) {{}} }}, 900)')
        ok = True
        if args.shots:
            shots(page, navs, [float(x) for x in args.shots.split(',')], args.tag, args.simulate_reload)
        if args.autocenter:
            ok &= autocenter(page, navs)
        info = page.evaluate('__igloo.info()')
        print('renderer.info', json.dumps(info))
        if args.nofloat or args.simulate_reload:
            print('render', json.dumps(page.evaluate('__igloo.render()')))
        if navs.count > 1:
            print(f'halaman dimuat {navs.count} kali (reload ditangani)')
        browser.close()
    if args.nofloat:
        print(f'console warnings ({len(warnings)}):', warnings[:8])
    print('console errors:', errors if errors else 'nol')
    sys.exit(0 if ok and not errors else 1)


if __name__ == '__main__':
    main()
