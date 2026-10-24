"""Verifikasi UX kristal (review pengunjung Okt 2026): label terbaca, tombol [ OPEN ], ajakan klik saat diam.

Pakai:  python tools/verify/ux_crystals.py [--url http://localhost:5179] [--gpu] [--fps]
Butuh dev server jalan. Hasil di tools/verify/out/ (ux_crystals_*.png).

Fase:
  A. Desktop 1024x768, kristal 2 (n 3.35), scroll aktif, mouse diam di area kosong:
     1. ajakan pertama sekitar 3 s sesudah diam, foto cincin di tengah animasi dan teks CLICK THE ICE,
     2. ajakan berikutnya paling cepat tiap 8 s, maks 3 per kunjungan (tidak ada yang ke-4 dalam 11 s),
     3. scroll roda terus-menerus: tidak ada ajakan selama scroll, kristal 3 dapat jatah baru sesudah diam,
        scroll di tengah ajakan langsung menghentikannya,
     4. hover kristal: cursor pointer, kilau kristal, tombol tersorot. Lepas: semuanya kembali,
     5. hover tombol [ OPEN ]: cursor pointer + sorot, klik tombol membuka /portfolio/projects,
     6. sesudah satu kristal dibuka: tidak ada ajakan lagi di sesi itu.
  B. Ponsel 375x812 (sentuh): teks TAP THE ICE, tap tombol [ OPEN ] membuka detail.
  C. prefers-reduced-motion: teks saja, tanpa cincin, tanpa kilau, tanpa scramble.
  D. --fps: FPS kristal 1280x800 dengan bagian label baru tampil vs disembunyikan (bergantian 3 kali).
Klien HMR Vite di-stub (agent lain boleh menyimpan file selama tes jalan).
"""
import argparse
import json
import os
import sys

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'out')

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

STATE_JS = '''(() => {
  const e = __igloo.engine, s = e.scenes[1]
  return {
    hovered: s.hovered, cursor: e.renderer.domElement.style.cursor,
    glow: s.crystals.map((c) => c.material.frost.uIceGlow.value),
    hot: s.crystals.map((c) => c.labels.hot),
    log: s.nudgeLog, count: s.nudger.count, opened: s.nudger.opened,
    nudgeOn: s.crystals.map((c) => c.labels.nudge.on),
    nudgeShow: s.crystals.map((c) => c.labels.nudge.show1),
    nudgeText: s.crystals.map((c) => c.labels.nudgeText.main.text),
    scramble: s.crystals.map((c) => c.labels.nudgeText.main.uniforms.uScramble.value),
    ring: s.crystals.map((c) => c.env.ring),
    ripple: s.crystals.map((c) => c.ripple.visible),
    nudgeT: s.crystals.map((c) => c.nudgeT),
    btn: s.crystals.map((c, i) => s.buttonRectPx(i)),
    emPx: s.crystals.map((c) => c.labels.metrics.emPx),
    time: e.ticker.time, path: location.pathname, detail: e.detailController ? e.detailController.state : null,
    n: e.scroll.state.n, centering: !!e.scroll.centering,
  }
})()'''

# tahan amplop ajakan (dt 0) supaya frame tengah animasi bisa difoto walau screenshot GPU lambat
HOLD_JS = '''() => {
  const s = __igloo.engine.scenes[1]
  if (s.__holdInstalled) return
  s.__holdInstalled = true
  const orig = s._updateNudge.bind(s)
  s._updateNudge = (dt, t) => orig(window.__holdNudge ? 0 : dt, t)
}'''

# bagian label baru (pelat, bayangan, bingkai, isi tombol, cincin) disembunyikan / ditampilkan, untuk banding FPS
TOGGLE_JS = '''(on) => {
  const s = __igloo.engine.scenes[1]
  for (const c of s.crystals) {
    const l = c.labels
    const objs = [...Object.values(l.plates), l.fill, l.lineShadow, l.frame, l.frameShadow, c.ripple, ...l.texts.map((t) => t.shadow)]
    for (const o of objs) o.material.visible = on
  }
}'''

RESULTS = []
SHOTS = {}


def check(name, ok, info=''):
    RESULTS.append((name, bool(ok)))
    print(f'[{"OK" if ok else "GAGAL"}] {name}  {info}')


def ready(page):
    page.wait_for_function('window.__igloo && document.getElementById("loader").classList.contains("hidden")', timeout=90000)


def state(page):
    return page.evaluate(STATE_JS)


def shot(page, name):
    path = os.path.join(OUT, f'ux_crystals_{name}.png')
    page.screenshot(path=path)
    SHOTS[name] = path
    print(f'  foto {os.path.relpath(path, ROOT)}')
    return path


def new_page(browser, errors, url, **ctx):
    context = browser.new_context(**ctx)
    page = context.new_page()
    page.route('**/@vite/client', lambda route: route.fulfill(status=200, content_type='application/javascript', body=VITE_CLIENT_STUB))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(url.rstrip('/') + '/?nointro')
    ready(page)
    page.evaluate('__igloo.adaptive(false)')
    page.evaluate(HOLD_JS)
    return page


def wait_engine(page, seconds):
    """Tunggu sekian detik WAKTU ENGINE (gsap lagSmoothing bisa menahan waktu saat GPU sibuk)."""
    t0 = page.evaluate('__igloo.engine.ticker.time')
    page.wait_for_function(f'__igloo.engine.ticker.time >= {t0 + seconds}', timeout=int(seconds * 4000) + 10000, polling=100)


def wait_log(page, n, timeout=20000):
    page.wait_for_function(f'__igloo.engine.scenes[1].nudgeLog.length >= {n}', timeout=timeout, polling=50)
    return state(page)


def hold_at(page, idx, t, settle_ms=0):
    """Tunggu ajakan kristal idx sampai detik t animasinya, lalu tahan."""
    page.wait_for_function(f'__igloo.engine.scenes[1].crystals[{idx}].nudgeT >= {t}', timeout=10000, polling=16)
    page.evaluate('window.__holdNudge = true')
    if settle_ms:
        page.wait_for_timeout(settle_ms)
    return state(page)


def release(page):
    page.evaluate('window.__holdNudge = false')


def wait_hot(page, idx, on, timeout=4000):
    """Tunggu sorot kristal idx naik (on) / turun. GPU dipakai agent lain bisa membuat frame lambat, jadi polling."""
    cond = f's.labels.hot > 0.9 && s.material.frost.uIceGlow.value > 0.5' if on else 's.labels.hot < 0.1 && s.material.frost.uIceGlow.value < 0.1'
    try:
        page.wait_for_function(f'(() => {{ const s = __igloo.engine.scenes[1].crystals[{idx}]; return {cond} }})()', timeout=timeout, polling=50)
    except Exception:
        pass
    return state(page)


def centered(page, n, timeout=15000):
    page.wait_for_function(f'(() => {{ const s = __igloo.engine.scroll; return !s.centering && Math.abs(s.state.n - {n}) < 0.003 }})()',
                           timeout=timeout, polling=50)


PARK = (880, 300)  # area kosong: bukan kristal, bukan label, bukan UI


def phase_desktop(browser, url, errors):
    page = new_page(browser, errors, url, viewport={'width': 1024, 'height': 768})
    page.mouse.move(*PARK)
    page.evaluate('__igloo.setScroll(3.35); __igloo.enableScroll(true)')
    e0 = page.evaluate('__igloo.engine.ticker.time')
    st = state(page)
    page.wait_for_timeout(300)
    st = state(page)
    check('ukuran label desktop sekitar 16 px (kristal di tengah)', 15 <= st['emPx'][1] <= 17.5, f"emPx={st['emPx'][1]:.1f}")

    # A1: ajakan pertama
    st = wait_log(page, 1, 15000)
    first = st['log'][0]
    check('ajakan pertama sekitar 3 s sesudah kristal diam di tengah', 2.8 <= first['time'] - e0 <= 3.8 and first['index'] == 1,
          f"jeda={first['time'] - e0:.2f}s indeks={first['index']}")
    check('mouse: bukan teks sentuh, bukan reduced', not first['touch'] and not first['reduced'])
    st = hold_at(page, 1, 0.55)
    check('tengah ajakan: cincin menjalar + kristal berkilau', 0 < st['ring'][1] < 1 and st['ripple'][1] and st['glow'][1] > 0.3,
          f"ring={st['ring'][1]:.2f} ripple={st['ripple'][1]} glow={st['glow'][1]:.2f}")
    shot(page, 'nudge_ring')
    release(page)
    st = hold_at(page, 1, 1.5, 900)
    check('teks CLICK THE ICE tampil penuh di dekat tombol', st['nudgeText'][1] == 'CLICK THE ICE' and st['nudgeShow'][1] > 0.95,
          f"teks={st['nudgeText'][1]!r} show={st['nudgeShow'][1]:.2f}")
    shot(page, 'nudge_text')
    release(page)

    # A2: jarak dan batas
    st = wait_log(page, 3, 30000)
    gaps = [st['log'][i + 1]['time'] - st['log'][i]['time'] for i in range(2)]
    check('ajakan berikutnya paling cepat tiap ~8 s', all(7.9 <= g <= 9.5 for g in gaps), f'jarak={[round(g, 2) for g in gaps]}')
    wait_engine(page, 11)
    st = state(page)
    check('maks 3 ajakan per kunjungan kristal', len(st['log']) == 3 and st['count'] == 3, f"log={len(st['log'])} count={st['count']}")

    # A3: scroll roda terus-menerus ke kristal 3
    n0 = len(st['log'])
    seen_on = False
    for i in range(42):
        page.mouse.wheel(0, 32)
        page.wait_for_timeout(120)
        if i % 6 == 0:
            s = state(page)
            seen_on |= any(s['nudgeOn']) or any(s['ripple'])
    st = state(page)
    check('tidak ada ajakan selama scroll', len(st['log']) == n0 and not seen_on, f"log={len(st['log'])} n={st['n']:.3f}")
    stop_t = st['time']
    st = wait_log(page, n0 + 1, 25000)
    last = st['log'][-1]
    check('kristal 3 dapat jatah baru sesudah auto-center + diam', last['index'] == 2 and last['count'] == 1,
          f"indeks={last['index']} count={last['count']} jeda dari scroll berhenti={last['time'] - stop_t:.2f}s")
    page.wait_for_function('__igloo.engine.scenes[1].crystals[2].nudgeT >= 0.5', timeout=10000, polling=16)
    page.mouse.wheel(0, -40)
    page.wait_for_timeout(200)
    st = state(page)
    check('scroll di tengah ajakan langsung menghentikannya', not st['nudgeOn'][2] and st['ring'][2] == -1 and not st['ripple'][2],
          f"on={st['nudgeOn'][2]} ring={st['ring'][2]}")

    # A4: hover kristal
    centered(page, 4.35)
    page.mouse.move(512, 384, steps=6)
    st = wait_hot(page, 2, True)
    check('hover kristal: cursor pointer, kristal berkilau, tombol tersorot',
          st['hovered'] == 2 and st['cursor'] == 'pointer' and st['glow'][2] > 0.5 and st['hot'][2] > 0.5,
          f"hovered={st['hovered']} cursor={st['cursor']!r} glow={st['glow'][2]:.2f} hot={st['hot'][2]:.2f}")
    shot(page, 'hover_crystal')
    page.mouse.move(*PARK, steps=6)
    st = wait_hot(page, 2, False)
    check('lepas hover: cursor normal, kilau dan sorot turun', st['hovered'] == -1 and st['cursor'] == '' and st['glow'][2] < 0.1 and st['hot'][2] < 0.1,
          f"hovered={st['hovered']} cursor={st['cursor']!r} glow={st['glow'][2]:.2f}")

    # A5: hover + klik tombol
    b = st['btn'][2]
    check('kotak tombol [ OPEN ] kristal 3 ada di layar', b is not None and 0 <= b['x0'] < b['x1'] <= 1024 and 0 <= b['y0'] < b['y1'] <= 768, json.dumps(b))
    cx, cy = (b['x0'] + b['x1']) / 2, (b['y0'] + b['y1']) / 2
    page.mouse.move(cx, cy, steps=6)
    page.wait_for_timeout(300)
    # kamera parallax ikut mouse: bidik ulang ke kotak tombol terbaru sebelum dicek
    b = state(page)['btn'][2]
    cx, cy = (b['x0'] + b['x1']) / 2, (b['y0'] + b['y1']) / 2
    page.mouse.move(cx, cy, steps=2)
    st = wait_hot(page, 2, True)
    check('hover tombol: cursor pointer + tombol tersorot + kristal berkilau',
          st['hovered'] == 2 and st['cursor'] == 'pointer' and st['hot'][2] > 0.9 and st['glow'][2] > 0.5,
          f"hovered={st['hovered']} cursor={st['cursor']!r} hot={st['hot'][2]:.2f}")
    shot(page, 'hover_button')
    page.mouse.click(cx, cy)
    page.wait_for_function("location.pathname === '/portfolio/projects'", timeout=4000)
    st = state(page)
    check('klik [ OPEN ] membuka /portfolio/projects seperti klik kristal', st['path'] == '/portfolio/projects' and st['opened'],
          f"path={st['path']} detail={st['detail']}")
    page.wait_for_function("__igloo.detail.state().state === 'open'", timeout=10000)
    page.keyboard.press('Escape')
    page.wait_for_function("__igloo.detail.state().state === 'closed'", timeout=6000)

    # A6: sesudah dibuka, tidak ada ajakan lagi
    page.mouse.move(*PARK, steps=4)
    n1 = len(state(page)['log'])
    page.evaluate('__igloo.setScroll(3.35)')
    wait_engine(page, 7)
    st = state(page)
    check('sesudah satu kristal dibuka: ajakan berhenti untuk sisa sesi', len(st['log']) == n1 and not any(st['nudgeOn']),
          f"log={len(st['log'])} (sebelum {n1})")
    page.context.close()


def phase_touch(browser, url, errors):
    page = new_page(browser, errors, url, viewport={'width': 375, 'height': 812}, has_touch=True, is_mobile=True, device_scale_factor=2)
    page.touchscreen.tap(330, 300)
    page.evaluate('__igloo.setScroll(3.35); __igloo.enableScroll(true)')
    st = state(page)
    page.wait_for_timeout(300)
    st = state(page)
    check('ukuran label ponsel minimal 14 px (kristal di tengah)', st['emPx'][1] >= 14, f"emPx={st['emPx'][1]:.1f}")
    st = wait_log(page, 1, 15000)
    st = hold_at(page, 1, 1.5, 900)
    check('sentuh: teks ajakan TAP THE ICE (dicek saat teks tampil penuh)', st['log'][-1]['touch'] and st['nudgeText'][1] == 'TAP THE ICE'
          and st['nudgeShow'][1] > 0.95, f"teks={st['nudgeText'][1]!r} show={st['nudgeShow'][1]:.2f}")
    shot(page, 'nudge_touch')
    release(page)
    b = state(page)['btn'][1]
    check('kotak tombol ponsel di dalam layar', b is not None and 0 <= b['x0'] and b['x1'] <= 375, json.dumps(b))
    page.touchscreen.tap((b['x0'] + b['x1']) / 2, (b['y0'] + b['y1']) / 2)
    page.wait_for_function("location.pathname === '/portfolio/journey'", timeout=4000)
    check('tap [ OPEN ] membuka /portfolio/journey', True)
    page.context.close()


def phase_reduced(browser, url, errors):
    page = new_page(browser, errors, url, viewport={'width': 1024, 'height': 768}, reduced_motion='reduce')
    page.mouse.move(*PARK)
    page.evaluate('__igloo.setScroll(3.35); __igloo.enableScroll(true)')
    st = wait_log(page, 1, 15000)
    ring = False
    glow = 0
    scr = []
    for _ in range(14):
        s = state(page)
        ring |= s['ring'][1] >= 0 or s['ripple'][1]
        glow = max(glow, s['glow'][1])
        scr.append(s['scramble'][1])
        page.wait_for_timeout(100)
    check('reduced motion: teks saja, tanpa cincin, tanpa kilau, tanpa scramble',
          st['log'][-1]['reduced'] and not ring and glow < 0.01 and all(v == 0 for v in scr),
          f"reduced={st['log'][-1]['reduced']} ring={ring} glow={glow:.3f} scramble={sorted(set(scr))}")
    st = hold_at(page, 1, 1.2, 900)
    check('reduced motion: teks CLICK THE ICE tetap tampil', st['nudgeShow'][1] > 0.95)
    shot(page, 'nudge_reduced')
    release(page)
    page.context.close()


def phase_fps(browser, url, errors):
    page = new_page(browser, errors, url, viewport={'width': 1280, 'height': 800})
    page.mouse.move(1150, 300)
    page.evaluate('__igloo.setScroll(3.35)')
    on, off = [], []
    for _ in range(3):
        for flag, bucket in ((True, on), (False, off)):
            page.evaluate(TOGGLE_JS, flag)
            wait_engine(page, 4.5)
            bucket.append(page.evaluate('__igloo.state().fps'))
    page.evaluate(TOGGLE_JS, True)
    avg = lambda v: sum(v) / len(v)
    print(f'  FPS 1280x800 kristal 2 diam: label baru tampil {[round(v, 1) for v in on]} rata {avg(on):.1f}, '
          f'disembunyikan {[round(v, 1) for v in off]} rata {avg(off):.1f}')
    check('FPS kristal hampir tidak berubah (selisih < 10%)', avg(on) >= 0.9 * avg(off), f'{avg(on):.1f} vs {avg(off):.1f}')
    page.context.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://localhost:5179/')
    ap.add_argument('--gpu', action='store_true', help='pakai GPU asli (D3D11), jauh lebih cepat dari SwiftShader')
    ap.add_argument('--fps', action='store_true', help='ukur FPS dengan / tanpa bagian label baru')
    ap.add_argument('--only', default='', help='jalankan fase tertentu saja, mis. "A,C"')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    if args.gpu:
        flags = ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu']
    else:
        flags = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    only = set(args.only.upper().split(',')) if args.only else {'A', 'B', 'C', 'D'}
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=flags)
        if 'A' in only:
            phase_desktop(browser, args.url, errors)
        if 'B' in only:
            phase_touch(browser, args.url, errors)
        if 'C' in only:
            phase_reduced(browser, args.url, errors)
        if 'D' in only and args.fps:
            phase_fps(browser, args.url, errors)
        browser.close()
    print('console errors:', errors if errors else 'nol')
    failed = [n for n, ok in RESULTS if not ok]
    print(f'{len(RESULTS) - len(failed)}/{len(RESULTS)} cek lolos')
    sys.exit(0 if not failed and not errors else 1)


if __name__ == '__main__':
    main()
