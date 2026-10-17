"""Verifikasi M6: detail view, router, deep link, Escape, back/forward (GPU asli, waktu nyata).

Pakai:  python tools/verify/detail_shots.py [--url http://localhost:5195]
Butuh dev server jalan. Hasil di tools/verify/out/ (m6_*.png, m6_side.png).

Langkah:
  1. Home (?nointro), scroll ke kristal 2 (n 3.35), hover kristal: cursor harus 'pointer'.
  2. Klik kristal (page.mouse.click, event pointer asli): URL jadi /portfolio/ask-nemi,
     frame di 0.5 / 1.5 / 3 s sesudah klik (state dp/dp2 dicatat bersama tiap frame).
  3. Detail terbuka: scene scroll tidak di-update (counter update kristal tidak naik), FPS.
  4. Sapuan mouse di atas panel (jejak + scramble), chip link (window.open di-stub, tidak buka tab).
  5. Scroll panel di viewport pendek (scrollMax > 0).
  6. Back browser menutup detail (frame tengah tutup ~ ref 09), scroll aktif lagi sesudah 1 s.
  7. Forward membuka lagi, Escape menutup.
  8. Back saat transisi buka: navigasi ditunda, akhirnya tertutup di '/'.
  9. Rute proyek ditolak saat scene kristal tidak terlihat (scroll di igloo).
 10. Deep link /portfolio/verdict-analyst langsung: detail terbuka, intro dilewati, lalu Escape.
 11. Side-by-side vs ref 08 dan 09 -> tools/verify/out/m6_side.png
Agent lain bisa menyimpan file saat tes jalan: klien HMR Vite di-stub (tidak ada reload), dan tiap fase
diulang (maks 3 kali) kalau halaman tetap ter-reload / konteks eksekusi hilang.
"""
import argparse
import json
import os
import sys
import time

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright, Error as PWError

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'out')
REF = os.path.join(ROOT, '_ref_screenshots')
GPU = ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu']

VITE_CLIENT_STUB = '''
const hot = () => ({ data: {}, accept() {}, acceptExports() {}, dispose() {}, prune() {}, invalidate() {}, decline() {}, on() {}, off() {}, send() {} })
export const createHotContext = hot
export const injectQuery = (url) => url
export function updateStyle(id, css) {
  let el = document.querySelector(`style[data-vite-dev-id="${id}"]`)
  if (!el) { el = document.createElement('style'); el.setAttribute('data-vite-dev-id', id); document.head.appendChild(el) }
  el.textContent = css
}
export function removeStyle() {}
export class ErrorOverlay extends HTMLElement {}
'''

RESULTS = []


def check(name, ok, info=''):
    RESULTS.append((name, bool(ok)))
    print(f'[{"OK" if ok else "GAGAL"}] {name}  {info}')


def ready(page):
    page.wait_for_function('window.__igloo && document.getElementById("loader").classList.contains("hidden")', timeout=90000)


def state(page):
    return page.evaluate('__igloo.detail.state()')


def wait_state(page, cond_js, timeout=8000):
    page.wait_for_function(f'(() => {{ const s = __igloo.detail.state(); return {cond_js} }})()', timeout=timeout)


def shot(page, name):
    path = os.path.join(OUT, f'm6_{name}.png')
    page.screenshot(path=path)
    return path


def new_page(browser, errors, w=1024, h=768):
    page = browser.new_page(viewport={'width': w, 'height': h})
    page.route('**/@vite/client', lambda route: route.fulfill(status=200, content_type='application/javascript', body=VITE_CLIENT_STUB))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    return page


def retry(fn, label, tries=3):
    for i in range(tries):
        try:
            return fn()
        except PWError as e:
            msg = str(e)
            reload = 'context was destroyed' in msg or 'navigat' in msg.lower() or 'Target closed' in msg
            if not reload or i == tries - 1:
                raise
            print(f'  ({label}: halaman ter-reload, ulang {i + 2}/{tries})')


def goto_home(page, url):
    page.goto(url.rstrip('/') + '/?nointro')
    ready(page)
    page.evaluate('__igloo.adaptive(false); __igloo.setScroll(3.35)')
    page.wait_for_timeout(1500)


def phase_open(page, url, frames):
    goto_home(page, url)
    # hover: sapu ke tengah kristal 2
    page.mouse.move(380, 330)
    page.mouse.move(512, 384, steps=8)
    page.wait_for_timeout(400)
    s = state(page)
    check('hover kristal -> cursor pointer', s['hovered'] == 1 and s['cursor'] == 'pointer', f"hovered={s['hovered']} cursor={s['cursor']!r}")
    page.evaluate('__igloo.engine.scenes[1]._updates = 0; { const sc = __igloo.engine.scenes[1]; const up = sc.update.bind(sc); sc.update = (f) => { sc._updates++; up(f) } }; 0')
    page.evaluate('window.__t0 = performance.now()')
    page.mouse.click(512, 384)
    rows = []
    for t in (0.5, 1.5, 3.0):
        page.wait_for_function(f'performance.now() - window.__t0 >= {t * 1000}', timeout=10000, polling=4)
        # tween dibekukan selama screenshot (Playwright butuh ~1 s per foto di GPU), lalu dilanjutkan
        el = page.evaluate('window.__p0 = performance.now(); __igloo.pauseTweens(true); (window.__p0 - window.__t0) / 1000')
        s = state(page)
        frames[t] = shot(page, f'open_{t}s')
        # waktu beku tidak dihitung: jam tes ikut digeser
        page.evaluate('__igloo.pauseTweens(false); window.__t0 += performance.now() - window.__p0; 0')
        rows.append((t, el, s))
        print(f'  frame t={t}s (nyata {el:.2f}s) state={s["state"]} dp={s["dp"]:.3f} dp2={s["dp2"]:.3f} path={s["path"]}')
    check('URL jadi /portfolio/ask-nemi', page.evaluate('location.pathname') == '/portfolio/ask-nemi')
    check('frame 0.5 s: masih opening, navigasi diblokir', rows[0][2]['state'] == 'opening' and rows[0][2]['blocked'])
    check('frame 1.5 s: transisi detail berjalan', 0 < rows[1][2]['dp'] <= 1, f"dp={rows[1][2]['dp']:.3f}")
    wait_state(page, "s.state === 'open'", 6000)
    s = state(page)
    check('detail terbuka penuh (dp = dp2 = 1), scroll terkunci', s['dp'] == 1 and s['dp2'] == 1 and not s['scrollEnabled'])
    page.evaluate('__igloo.engine.scenes[1]._updates = 0')
    page.wait_for_timeout(1000)
    n = page.evaluate('__igloo.engine.scenes[1]._updates')
    check('detail penuh: scene kristal tidak di-update/dirender', n == 0, f'update dalam 1 s = {n}')
    page.wait_for_timeout(2500)
    fps = page.evaluate('__igloo.state().fps')
    print(f'  FPS detail terbuka (1024x768, GPU asli): {fps:.1f}')
    return fps


def phase_panel(page):
    # sapuan mouse cepat di atas teks panel: jejak partikel + scramble huruf
    page.mouse.move(260, 200)
    # helper half float diimport sebelum sapuan (import pertama lambat, jejak keburu meluruh)
    page.evaluate("async () => { window.__DU = (await import('/node_modules/.vite/deps/three.js')).DataUtils }")
    # sapuan kontinu 0.7 s dengan event pointermove per frame di dalam halaman: page.mouse.move terlalu
    # lambat saat GPU sibuk (jeda > 150 ms = sim reset), jadi kecepatan sim tidak pernah naik
    page.evaluate('''() => new Promise((done) => {
      const el = __igloo.engine.renderer.domElement, t0 = performance.now()
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 700)
        const x = 260 + 480 * k, y = 200 + 90 * Math.sin(k * Math.PI * 3)
        el.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerType: 'mouse', bubbles: true }))
        if (k < 1) requestAnimationFrame(step); else done()
      }
      step()
    })''')
    page.wait_for_timeout(30)
    # baca sim dulu, lalu tahan peluruhan (decay 1) selama screenshot yang lambat supaya jejak masih terlihat
    js = '''() => {
      const DataUtils = window.__DU
      const e = __igloo.engine, sim = e.detail.sim, rt = sim.read, w = rt.width, h = rt.height
      const buf = new Uint16Array(w * h * 4)
      e.renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf)
      let on = 0, max = 0
      for (let i = 0; i < w * h; i++) { const v = DataUtils.fromHalfFloat(buf[i * 4]); if (v > 0.05) on++; if (v > max) max = v }
      return { w, h, on, max }
    }'''
    sim = page.evaluate(js)
    page.evaluate('__igloo.engine.detail.sim.material.uniforms.uDecay.value = 1')
    trail = shot(page, 'trail')
    page.evaluate('__igloo.engine.detail.sim.material.uniforms.uDecay.value = 0.975')
    check('jejak mouse tercatat di sim resolusi/5', sim['on'] > 50 and sim['max'] > 0.3, json.dumps(sim))
    # chip link: window.open di-stub, catat url
    page.evaluate('window.__opened = []; window.open = (u, t, f) => { window.__opened.push([u, t]); return null }; 0')
    tg = page.evaluate('__igloo.detail.targets()')
    chip = tg['chips'][1]
    page.mouse.move(chip['x'], chip['y'], steps=4)
    page.wait_for_timeout(200)
    cur = state(page)['cursor']
    page.mouse.click(chip['x'], chip['y'])
    opened = page.evaluate('window.__opened')
    check('chip kedua [GH] buka tab baru (_blank)', len(opened) == 1 and opened[0][1] == '_blank' and 'github.com/ne-he/' in opened[0][0],
          f'opened={opened} cursor={cur!r}')
    return trail


def phase_panel_scroll(page):
    page.set_viewport_size({'width': 1024, 'height': 420})
    page.wait_for_timeout(500)
    s0 = state(page)
    page.mouse.move(512, 250)
    page.mouse.wheel(0, 400)
    page.wait_for_timeout(1200)
    s1 = state(page)
    shot(page, 'panel_scroll')
    check('panel scroll sendiri (lerp) saat konten lebih tinggi dari layar',
          s0['panelScrollMax'] > 0 and abs(s1['panelScroll'] - min(400, s1['panelScrollMax'])) < 2,
          f"max={s1['panelScrollMax']:.0f} scroll={s1['panelScroll']:.1f}")
    page.set_viewport_size({'width': 1024, 'height': 768})
    page.wait_for_timeout(500)


def phase_back_forward(page, frames):
    page.mouse.move(900, 700)
    page.evaluate('window.__t0 = performance.now()')
    page.go_back()
    page.wait_for_function('performance.now() - window.__t0 >= 450', timeout=5000, polling=4)
    page.evaluate('window.__p0 = performance.now(); __igloo.pauseTweens(true)')
    s = state(page)
    frames['close'] = shot(page, 'close_mid')
    page.evaluate('__igloo.pauseTweens(false); window.__t0 += performance.now() - window.__p0; 0')
    print(f"  frame tutup t~0.45s state={s['state']} dp={s['dp']:.3f} path={s['path']}")
    check('back browser -> closing, path /', s['state'] == 'closing' and s['path'] == '/')
    page.wait_for_function('performance.now() - window.__t0 >= 1100', timeout=5000)
    check('scroll aktif lagi sesudah 1 s', state(page)['scrollEnabled'])
    wait_state(page, "s.state === 'closed' && s.dp === 0", 5000)
    frames['closed'] = shot(page, 'closed')
    check('detail tertutup penuh (dp 0)', True)
    page.go_forward()
    wait_state(page, "s.state === 'open'", 8000)
    check('forward membuka lagi ask-nemi', state(page)['slug'] == 'ask-nemi' and page.evaluate('location.pathname') == '/portfolio/ask-nemi')
    page.keyboard.press('Escape')
    wait_state(page, "s.state === 'closed'", 5000)
    check('Escape menutup, path /', page.evaluate('location.pathname') == '/')


def phase_block(page):
    page.wait_for_timeout(2000)  # auto-center kristal sesudah scroll dibuka lagi
    page.evaluate('__igloo.setScroll(3.35)')
    page.wait_for_timeout(600)
    page.mouse.move(400, 300)
    page.mouse.move(512, 384, steps=8)
    page.wait_for_timeout(300)
    page.mouse.click(512, 384)
    page.wait_for_timeout(250)
    s = state(page)
    page.go_back()  # di tengah transisi buka
    page.wait_for_timeout(200)
    s2 = state(page)
    check('back saat transisi ditunda (state tetap opening)', s['state'] == 'opening' and s2['state'] == 'opening', f"{s['state']} -> {s2['state']}")
    wait_state(page, "s.state === 'closed'", 9000)
    check('back tertunda dijalankan sesudah unblock: tertutup di /', page.evaluate('location.pathname') == '/')


def phase_reject(page):
    page.wait_for_timeout(1500)
    page.evaluate('__igloo.setScroll(0.658)')
    page.wait_for_timeout(300)
    ok = page.evaluate("__igloo.engine.router.go('/portfolio/iceberg')")
    check('rute proyek ditolak saat scene kristal tidak terlihat', ok is False and page.evaluate('location.pathname') == '/')


def phase_deeplink(browser, url, errors, frames):
    page = new_page(browser, errors)
    page.goto(url.rstrip('/') + '/portfolio/verdict-analyst')
    ready(page)
    page.wait_for_timeout(2000)
    s = state(page)
    intro = page.evaluate('__igloo.intro.running')
    frames['deep'] = shot(page, 'deeplink')
    check('deep link /portfolio/verdict-analyst terbuka langsung, intro dilewati',
          s['state'] == 'open' and s['slug'] == 'verdict-analyst' and s['dp'] == 1 and not intro, json.dumps(s))
    tg = page.evaluate('__igloo.detail.targets()')
    page.mouse.move(tg['close']['x'], tg['close']['y'], steps=3)
    page.wait_for_timeout(200)
    check('hover Close -> cursor pointer', state(page)['cursor'] == 'pointer')
    page.mouse.move(600, 650, steps=3)
    page.keyboard.press('Escape')
    wait_state(page, "s.state === 'closed'", 5000)
    check('Escape di deep link menutup, path /', page.evaluate('location.pathname') == '/')
    # tombol Close lewat klik
    page.wait_for_timeout(1500)
    page.evaluate('__igloo.setScroll(4.35)')
    page.wait_for_timeout(500)
    page.evaluate('__igloo.detail.open(2)')
    wait_state(page, "s.state === 'open'", 8000)
    tg = page.evaluate('__igloo.detail.targets()')
    page.mouse.click(tg['close']['x'], tg['close']['y'])
    wait_state(page, "s.state === 'closed'", 5000)
    check('klik tombol Close menutup', page.evaluate('location.pathname') == '/')
    page.close()


def side_by_side(frames):
    W, H = 512, 384
    rows = [
        ('ref 08 detail', os.path.join(REF, '08_detail_panel.jpg'), 'kita: detail terbuka (3 s)', frames.get(3.0)),
        ('ref 09 transisi tutup', os.path.join(REF, '09_close_detail_dither_smoke.jpg'), 'kita: tengah tutup (~0.45 s)', frames.get('close')),
        ('kita: buka 0.5 s', frames.get(0.5), 'kita: buka 1.5 s', frames.get(1.5)),
        ('kita: deep link verdict-analyst', frames.get('deep'), 'kita: jejak mouse + scramble', frames.get('trail')),
    ]
    sheet = Image.new('RGB', (W * 2, (H + 18) * len(rows)), (20, 20, 24))
    d = ImageDraw.Draw(sheet)
    for r, (la, pa, lb, pb) in enumerate(rows):
        for c, (lab, path) in enumerate(((la, pa), (lb, pb))):
            x, y = c * W, r * (H + 18)
            d.text((x + 6, y + 3), lab, fill=(230, 230, 230))
            if path and os.path.exists(path):
                sheet.paste(Image.open(path).convert('RGB').resize((W, H)), (x, y + 18))
    path = os.path.join(OUT, 'm6_side.png')
    sheet.save(path)
    print('side-by-side ->', os.path.relpath(path, ROOT))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://localhost:5195/')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    errors = []
    frames = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(args=GPU)
        page = new_page(browser, errors)
        fps = retry(lambda: phase_open(page, args.url, frames), 'buka')
        frames['trail'] = retry(lambda: phase_panel(page), 'panel')
        retry(lambda: phase_panel_scroll(page), 'scroll panel')
        retry(lambda: phase_back_forward(page, frames), 'back/forward')
        retry(lambda: phase_block(page), 'blok navigasi')
        retry(lambda: phase_reject(page), 'tolak rute')
        page.close()
        retry(lambda: phase_deeplink(browser, args.url, errors, frames), 'deep link')
        browser.close()
    side_by_side(frames)
    # peringatan dari import three kedua di script sim (bukan dari app) diabaikan
    errors = [e for e in errors if 'Multiple instances of Three.js' not in e]
    print('console errors:', errors if errors else 'nol')
    failed = [n for n, ok in RESULTS if not ok]
    print(f'{len(RESULTS) - len(failed)}/{len(RESULTS)} cek lolos, FPS detail {fps:.1f}')
    sys.exit(0 if not failed and not errors else 1)


if __name__ == '__main__':
    main()
