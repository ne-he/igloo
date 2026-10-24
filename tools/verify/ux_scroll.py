"""Verifikasi petunjuk scroll (src/scenes/ui/ScrollCue.js, SectionIndex.js, ScrollGuide.js).

Pakai:  python tools/verify/ux_scroll.py [--url http://localhost:5179/] [--gpu] [--tag ux] [--skip-mobile] [--quick]
Butuh dev server jalan (sebaiknya tanpa HMR, supaya edit agent lain tidak me-reload halaman di tengah run).
Output: tools/verify/out/<tag>_*.png (layar penuh) dan <tag>_*_zoom.png (potongan cue / indeks diperbesar 2x).

Halaman dimuat seperti pengunjung biasa: TANPA __igloo.setScroll / enableScroll (dua-duanya dihitung "sudah
berinteraksi" dan mematikan peek). __igloo cuma dipakai untuk MEMBACA state, plus satu emit event bus untuk hook
fakta igloo.

Langkah (1024x768, mouse):
  1. intro jalan sendiri, cue SCROLL TO ENTER muncul sesudah intro UI, indeks section tampil. Screenshot + zoom.
  2. diam: idle peek. Posisi scroll direkam tiap ~60 ms: harus maju (> 0.15 unit), tidak masuk transisi,
     lalu kembali ke titik istirahat. Peek kedua jalan, peek ketiga tidak (maks 2) kecuali --quick.
  3. satu wheel mouse sungguhan: cue pudar, peek mati.
  4. klik 02 / 03 / 01 di indeks: scene berganti ke kristal / ruang link / igloo, item aktif ikut.
     Hook fakta saat di luar igloo tidak mengubah teks cue.
  5. kembali di igloo dan diam: cue muncul lagi.
  6. emit 'igloo_facts_complete': teks cue jadi ALL FOUND. NOW SCROLL dan berkedip. Screenshot.
Lalu 1440x900 (screenshot cue + indeks) dan 375x812 sentuh (SWIPE UP TO ENTER, hook fakta versi sentuh,
swipe sungguhan lewat CDP membuat cue pudar, tap 02 pindah ke kristal).
Selalu: kumpulkan error console + pageerror.
"""
import argparse
import json
import os
import sys
import time

from PIL import Image
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')

READY_JS = 'window.__igloo && document.getElementById("loader").classList.contains("hidden")'
GUIDE_JS = '__igloo.engine.ui.guide.debugState()'
EMIT_FACTS_JS = "import('/src/engine/Bus.js').then((m) => { m.bus.emit('igloo_facts_complete'); return true })"

RESULTS = []


def check(name, ok, info=''):
    RESULTS.append((name, bool(ok)))
    print(f'[{"OK" if ok else "GAGAL"}] {name}  {info}')
    return ok


def wait_ready(page):
    page.wait_for_function(READY_JS, timeout=120000)


def guide(page):
    return page.evaluate(GUIDE_JS)


def scroll_state(page):
    return page.evaluate('__igloo.state()')


def zoom(path, rect, name, pad=40, scale=2):
    """Potong kotak rect (piksel CSS) dari screenshot lalu perbesar, dpr = rasio piksel gambar / CSS."""
    img = Image.open(path)
    dpr = rect.get('dpr', 1)
    x0 = max(0, int((rect['x0'] - pad) * dpr))
    y0 = max(0, int((rect['y0'] - pad) * dpr))
    x1 = min(img.width, int((rect['x1'] + pad) * dpr))
    y1 = min(img.height, int((rect['y1'] + pad) * dpr))
    crop = img.crop((x0, y0, x1, y1))
    crop = crop.resize((int(crop.width * scale / dpr), int(crop.height * scale / dpr)), Image.LANCZOS)
    out = os.path.join(OUT, name)
    crop.save(out)
    return os.path.relpath(out)


def shot(page, tag, name, zooms=()):
    path = os.path.join(OUT, f'{tag}_{name}.png')
    page.screenshot(path=path)
    rects = page.evaluate('''() => {
      const ui = __igloo.engine.ui, c = ui.scrollCue.rect, b = ui.sectionIndex.boxRect
      return { cue: c, index: b, dpr: window.devicePixelRatio }
    }''')
    extra = []
    for z in zooms:
        r = rects.get(z)
        if r:
            extra.append(zoom(path, {**r, 'dpr': rects['dpr']}, f'{tag}_{name}_{z}_zoom.png'))
    return ' '.join([os.path.relpath(path)] + extra)


def wait_guide(page, cond_js, timeout=30000):
    page.wait_for_function(f'(() => {{ const g = __igloo.engine.ui.guide.debugState(); return {cond_js} }})()', timeout=timeout)


def record_peek(page, tag, want_count, timeout_s=30):
    """Rekam posisi scroll sampai peek ke-want_count selesai. Screenshot sekali di dekat puncak."""
    samples = []
    peak_shot = None
    t0 = time.time()
    done_at = None
    while time.time() - t0 < timeout_s:
        st = page.evaluate('''(() => { const g = __igloo.engine.ui.guide.debugState(), s = __igloo.state()
          return { t: g.time, n: s.n, next: !!s.next, count: g.peekCount, motion: g.motion, cue: g.cueVisible,
                   pulse: __igloo.engine.ui.scrollCue.pulseT, start: g.start } })()''')
        samples.append(st)
        if peak_shot is None and st['motion'] == 'peek' and st['n'] - st['start'] > 0.2:
            peak_shot = shot(page, tag, f'peek{want_count}_peak', ('cue',))
        if st['count'] >= want_count and st['motion'] is None:
            done_at = done_at or time.time()
            if time.time() - done_at > 0.3:
                break
        page.wait_for_timeout(60)
    return samples, peak_shot


def check_peek(samples, k, peak_shot):
    mine = [s for s in samples if s['count'] == k]
    if not mine:
        return check(f'peek {k} terjadi', False, 'tidak ada sampel')
    start = mine[0]['start']
    during = [s for s in mine if s['motion'] == 'peek']
    peak = max((s['n'] for s in during), default=start)
    low = min((s['n'] for s in during), default=start)
    final = mine[-1]['n']
    pulsed = max((s['pulse'] for s in during), default=0)
    any_transition = any(s['next'] for s in mine)
    t_first = during[0]['t'] if during else None
    t_last = during[-1]['t'] if during else None
    curve = ' '.join(f'{s["t"]:.2f}:{s["n"]:.3f}' for s in during[:: max(1, len(during) // 12)])
    check(f'peek {k}: maju lalu kembali ke titik istirahat', peak - start > 0.15 and abs(final - start) < 2e-3,
          f'start {start:.4f} puncak {peak:.4f} (+{peak - start:.3f}) terendah {low:.4f} akhir {final:.4f} '
          f'durasi {((t_last or 0) - (t_first or 0)):.2f}s')
    check(f'peek {k}: tidak masuk transisi ke kristal', not any_transition and peak < 1.35, f'n maks {peak:.3f} (transisi mulai 1.35)')
    check(f'peek {k}: cue berdenyut selama peek', pulsed > 0.3, f'pulse maks {pulsed:.2f}')
    print(f'   kurva n (detik engine:n): {curve}')
    if peak_shot:
        print(f'   screenshot puncak: {peak_shot}')


def index_center(page, i):
    return page.evaluate(f'''(() => {{ const h = __igloo.engine.ui.sectionIndex.lay.hits[{i}]
      const it = __igloo.engine.ui.sectionIndex.lay.items[{i}]
      return {{ x: it.x + it.width / 2, y: (h.y0 + h.y1) / 2 }} }})()''')


def jump_and_check(page, tag, i, key, n_want, tap=False):
    c = index_center(page, i)
    if tap:
        page.touchscreen.tap(c['x'], c['y'])
    else:
        page.mouse.move(c['x'], c['y'], steps=4)
        page.wait_for_timeout(150)
        cursor = page.evaluate('__igloo.engine.renderer.domElement.style.cursor')
        check(f'hover item {i + 1:02d}: cursor pointer', cursor == 'pointer', f'cursor "{cursor}"')
        page.mouse.click(c['x'], c['y'])
    try:
        page.wait_for_function('__igloo.engine.ui.guide.motion === "jump"', timeout=3000)
    except Exception:
        pass
    wait_guide(page, 'g.motion === null', timeout=15000)
    page.wait_for_timeout(700)
    st = scroll_state(page)
    g = guide(page)
    ok = st['current']['key'] == key and not st['next'] and abs(st['n'] - n_want) < 0.01 and g['active'] == i
    path = shot(page, tag, f'jump{i + 1:02d}', ('index',))
    check(f'{"tap" if tap else "klik"} {i + 1:02d} -> {key}', ok,
          f'n {st["n"]:.3f} (harap {n_want}) scene {st["current"]["key"]} aktif {g["active"]}  {path}')
    return st


def desktop(browser, args, errors, w=1024, h=768, tag=None, full=True):
    tag = tag or f'{args.tag}_{w}'
    ctx = browser.new_context(viewport={'width': w, 'height': h})
    page = ctx.new_page()
    page.set_default_timeout(120000)
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(args.url)
    wait_ready(page)
    # mouse di langit kanan atas: tidak menyentuh bata, kristal, atau UI
    page.mouse.move(w * 0.85, h * 0.12)
    intro = page.evaluate('__igloo.intro.running')
    g = guide(page)
    check(f'{w}x{h}: cue belum tampil selama intro', intro and not g['cueVisible'], f'intro {intro} cue {g["cueVisible"]}')
    wait_guide(page, 'g.cueVisible && g.cueShow >= 1', timeout=40000)
    page.wait_for_timeout(900)  # garis selesai tumbuh, segmen sedang berjalan
    g = guide(page)
    fps = page.evaluate('__igloo.state().fps')
    idx = page.evaluate('__igloo.engine.ui.sectionIndex.visible && __igloo.engine.ui.sectionIndex.show.value')
    path = shot(page, tag, 'cue', ('cue', 'index'))
    check(f'{w}x{h}: cue SCROLL TO ENTER + indeks tampil sesudah intro UI', g['cueText'] == 'SCROLL TO ENTER' and idx and g['active'] == 0,
          f'teks "{g["cueText"]}" indeks {idx} aktif {g["active"]} fps {fps:.1f}  {path}')
    a11y = page.evaluate('''Array.from(document.querySelectorAll('#a11y [data-section]')).map((b) => b.textContent + (b.getAttribute('aria-current') ? '*' : ''))''')
    hint = page.evaluate('''Array.from(document.querySelectorAll('#a11y section[data-ui] p')).map((p) => p.textContent)''')
    check(f'{w}x{h}: a11y: 3 tombol section + hint lama tetap ada', len(a11y) == 3 and 'Scroll down to discover.' in hint,
          f'{a11y} {hint}')
    if not full:
        ctx.close()
        return

    # 2. idle peek (tanpa menyentuh apa pun)
    samples, peak = record_peek(page, tag, 1, timeout_s=30)
    check_peek(samples, 1, peak)
    if not args.quick:
        samples2, peak2 = record_peek(page, tag, 2, timeout_s=30)
        check_peek(samples2, 2, peak2)
        page.wait_for_timeout(13000)
        g = guide(page)
        check('peek paling banyak 2 kali', g['peekCount'] == 2, f'peekCount {g["peekCount"]}')

    # 3. satu wheel sungguhan
    page.mouse.move(w * 0.5, h * 0.45)
    n0 = scroll_state(page)['n']
    page.mouse.wheel(0, 300)
    try:
        wait_guide(page, '!g.cueVisible && g.cueShow === 0', timeout=4000)
    except Exception:
        pass
    g = guide(page)
    # scroll di-damping (lerp 0.075 / 0.15): tunggu sampai berhenti sebelum mengukur jaraknya
    try:
        page.wait_for_function('__igloo.state().velocity === 0', timeout=6000)
    except Exception:
        pass
    n1 = scroll_state(page)['n']
    path = shot(page, tag, 'after_wheel')
    check('wheel sungguhan: cue pudar, peek mati, scroll maju', not g['cueVisible'] and g['cueShow'] == 0 and g['peekCancelled'] and n1 > n0 + 0.1,
          f'n {n0:.3f} -> {n1:.3f} cueShow {g["cueShow"]:.2f}  {path}')
    page.wait_for_timeout(1500)

    # 4. indeks section
    jump_and_check(page, tag, 1, 'crystals', 2.35)
    page.evaluate(EMIT_FACTS_JS)
    page.wait_for_timeout(300)
    g = guide(page)
    check('hook fakta di luar igloo: teks cue tetap', g['cueText'] == 'SCROLL TO ENTER' and not g['cueVisible'], f'"{g["cueText"]}"')
    jump_and_check(page, tag, 2, 'entry', 9.29)
    jump_and_check(page, tag, 0, 'igloo', 0.658)

    # 5. kembali ke posisi awal + diam -> cue muncul lagi
    page.mouse.move(w * 0.85, h * 0.12)
    try:
        wait_guide(page, 'g.cueVisible && g.cueShow >= 1', timeout=9000)
        back = True
    except Exception:
        back = False
    check('kembali ke igloo lalu diam: cue muncul lagi', back, json.dumps({k: guide(page)[k] for k in ('cueVisible', 'dismissed', 'n')}))

    # 6. semua fakta ketemu
    page.evaluate(EMIT_FACTS_JS)
    page.wait_for_timeout(250)
    mid = shot(page, tag, 'facts_blink', ('cue',))
    page.wait_for_timeout(1200)
    g = guide(page)
    path = shot(page, tag, 'facts', ('cue',))
    check('igloo_facts_complete: ALL FOUND. NOW SCROLL', g['cueText'] == 'ALL FOUND. NOW SCROLL' and g['cueVisible'],
          f'"{g["cueText"]}"  {mid}  {path}')
    fps = page.evaluate('__igloo.state().fps')
    print(f'FPS akhir {w}x{h}: {fps:.1f}')
    ctx.close()


def cdp_swipe_up(page, x, y0, y1, steps=10):
    s = page.context.new_cdp_session(page)
    s.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y0}]})
    for k in range(1, steps + 1):
        y = y0 + (y1 - y0) * k / steps
        s.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x, 'y': y}]})
        page.wait_for_timeout(16)
    s.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    s.detach()


def mobile(browser, args, errors):
    w, h = 375, 812
    tag = f'{args.tag}_{w}'
    ctx = browser.new_context(viewport={'width': w, 'height': h}, has_touch=True, is_mobile=True, device_scale_factor=2)
    page = ctx.new_page()
    page.set_default_timeout(120000)
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(args.url)
    wait_ready(page)
    wait_guide(page, 'g.cueVisible && g.cueShow >= 1', timeout=40000)
    page.wait_for_timeout(900)
    g = guide(page)
    path = shot(page, tag, 'cue', ('cue', 'index'))
    labels = page.evaluate('__igloo.engine.ui.sectionIndex.items.map((t) => t.text)')
    check('375x812 sentuh: SWIPE UP TO ENTER, indeks ringkas', g['cueText'] == 'SWIPE UP TO ENTER' and g['touch'] and labels == ['01', '02', '03'],
          f'"{g["cueText"]}" indeks {labels}  {path}')
    # hook fakta versi sentuh (masih di igloo, belum scroll)
    page.evaluate(EMIT_FACTS_JS)
    page.wait_for_timeout(1400)
    g = guide(page)
    path = shot(page, tag, 'facts', ('cue',))
    check('375x812: igloo_facts_complete -> ALL FOUND. NOW SWIPE UP', g['cueText'] == 'ALL FOUND. NOW SWIPE UP' and g['cueVisible'],
          f'"{g["cueText"]}"  {path}')
    # swipe ke atas sungguhan (event sentuh CDP): cue pudar, scroll maju
    n0 = scroll_state(page)['n']
    cdp_swipe_up(page, w * 0.5, h * 0.7, h * 0.55)
    try:
        wait_guide(page, '!g.cueVisible && g.cueShow === 0', timeout=4000)
    except Exception:
        pass
    g = guide(page)
    try:
        page.wait_for_function('__igloo.state().velocity === 0', timeout=6000)
    except Exception:
        pass
    n1 = scroll_state(page)['n']
    check('375x812: swipe ke atas: cue pudar, scroll maju', not g['cueVisible'] and n1 > n0 + 0.05,
          f'n {n0:.3f} -> {n1:.3f} cueShow {g["cueShow"]:.2f}')
    page.wait_for_timeout(1500)
    jump_and_check(page, tag, 1, 'crystals', 2.35, tap=True)
    ctx.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://localhost:5179/')
    ap.add_argument('--tag', default='ux')
    ap.add_argument('--gpu', action='store_true', help='pakai GPU asli (D3D11), jauh lebih cepat dari SwiftShader')
    ap.add_argument('--skip-mobile', action='store_true')
    ap.add_argument('--quick', action='store_true', help='lewati peek kedua dan cek batas 2 peek (hemat sekitar 30 s)')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    errors = []
    with sync_playwright() as p:
        if args.gpu:
            flags = ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu']
        else:
            flags = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
        browser = p.chromium.launch(args=flags)
        desktop(browser, args, errors)
        desktop(browser, args, errors, 1440, 900, full=False)
        if not args.skip_mobile:
            mobile(browser, args, errors)
        browser.close()
    print('console errors:', errors if errors else 'nol')
    failed = [n for n, ok in RESULTS if not ok]
    print(f'{len(RESULTS) - len(failed)}/{len(RESULTS)} cek lolos')
    sys.exit(0 if not failed and not errors else 1)


if __name__ == '__main__':
    main()
