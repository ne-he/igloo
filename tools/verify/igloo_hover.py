"""Verifikasi fakta hover bata igloo (src/scenes/igloo/BrickFacts.js + src/scenes/ui/FactLabel.js).

Pakai:  python tools/verify/igloo_hover.py [--url http://localhost:5182/] [--gpu] [--tag hover]
        [--width 1024 --height 768] [--count 5] [--skip-touch]
Butuh dev server jalan (sebaiknya tanpa HMR, supaya edit agent lain tidak me-reload halaman di tengah run).
Output: tools/verify/out/<tag>_*.png (layar penuh) dan <tag>_*_zoom.png (potongan label diperbesar 2x).

Langkah:
  1. intro: mouse di atas igloo selagi intro jalan -> tidak boleh ada label, tidak ada bata yang di-hover.
  2. titik istirahat: hover beberapa bata depan (fakta berbeda), tunggu reveal selesai, cek teks label = fakta
     bata yang di-hover, bata itu terangkat (h2 naik), screenshot.
  3. mouse ke langit -> label pudar habis.
  4. di luar titik istirahat (n 1.0) dan di scene kristal (n 3.35) -> hover tidak memunculkan label.
  5. FPS sambil hover (waktu nyata, sangat dipengaruhi agent lain yang ikut merender).
  6. layar sentuh (konteks has_touch): tap bata -> label muncul, tap langit -> label pudar.
Selalu: kumpulkan error console + pageerror.
"""
import argparse
import json
import os
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')

READY_JS = 'window.__igloo && document.getElementById("loader").classList.contains("hidden")'

STATE_JS = """
(() => {
  const e = __igloo.engine, s = e.scenes[0], f = s.facts, l = e.ui.factLabel, b = s.igloo.bricks
  const cur = f.current
  return {
    current: cur,
    fact: cur >= 0 ? f.factOf(cur) : null,
    hovered: b.hovered,
    lift: cur >= 0 ? b.bricks[cur].h2 : 0,
    show1: l.show1, show2: l.show2, line: l.line,
    visible: l.visible,
    text: l.text.text,
    box: l.layoutResult ? l.layoutResult.box : null,
    intro: !!e.intro?.running,
    progress: s.progress,
    active: s.active,
    fps: e.ticker.avgFps,
  }
})()
"""

# Bata yang tengahnya kena sinar dari kamera (bata depan yang terlihat), dengan posisi layar dan faktanya.
TARGETS_JS = """
(() => {
  const e = __igloo.engine, s = e.scenes[0], cam = s.camera, W = innerWidth, H = innerHeight
  const out = []
  for (const b of s.igloo.bricks.bricks) {
    const p = b.position.clone().project(cam)
    const hit = s.facts.pick({ x: p.x, y: p.y })
    out.push({ i: b.index, x: (p.x * 0.5 + 0.5) * W, y: (0.5 - p.y * 0.5) * H, cy: b.centroid.y, fact: s.facts.factOf(b.index), hit })
  }
  return out
})()
"""

A11Y_JS = """
Array.from(document.querySelectorAll('#a11y section[data-igloo-facts] li')).map((li) => li.textContent)
"""


def wait_ready(page):
    page.wait_for_function(READY_JS, timeout=120000)


def state(page):
    return page.evaluate(STATE_JS)


def shot(page, name, st=None, tag='hover'):
    path = os.path.join(OUT, f'{tag}_{name}.png')
    page.screenshot(path=path)
    box = (st or {}).get('box')
    if box and st.get('visible'):
        img = Image.open(path)
        pad = 70
        x0 = max(0, int(box['x0']) - pad)
        y0 = max(0, int(box['y0']) - pad)
        x1 = min(img.width, int(box['x1']) + pad)
        y1 = min(img.height, int(box['y1']) + pad + 60)
        crop = img.crop((x0, y0, x1, y1))
        crop = crop.resize((crop.width * 2, crop.height * 2), Image.LANCZOS)
        crop.save(os.path.join(OUT, f'{tag}_{name}_zoom.png'))
    return os.path.relpath(path)


def pick_targets(page, count):
    """Bata depan yang tengahnya memang bata itu sendiri, fakta berbeda, tersebar kiri ke kanan."""
    all_ = page.evaluate(TARGETS_JS)
    W = page.viewport_size['width']
    H = page.viewport_size['height']
    # cuma bata yang punya fakta (24 Okt 2026: tiap fakta di satu bata saja, bata lain tanpa label)
    ok = [t for t in all_ if t['fact'] and t['hit'] == t['i'] and 40 < t['x'] < W - 40 and 40 < t['y'] < H - 40]
    ok.sort(key=lambda t: t['x'])
    chosen = []
    used = set()
    # sebar: ambil satu per irisan horizontal, utamakan fakta yang belum dipakai
    for k in range(count):
        lo = len(ok) * k // count
        hi = len(ok) * (k + 1) // count
        for t in sorted(ok[lo:hi], key=lambda t: -t['cy']):
            if t['fact'] not in used:
                chosen.append(t)
                used.add(t['fact'])
                break
    return chosen, len(ok)


def hover_rest(page, args, report):
    page.evaluate('__igloo.setScroll(0.658)')
    page.mouse.move(args.width * 0.9, args.height * 0.12)
    page.wait_for_timeout(800)
    facts_all = [t['fact'] for t in page.evaluate(TARGETS_JS) if t['fact']]
    unique = len(facts_all) == len(set(facts_all))
    print(f"fakta per bata: {len(facts_all)} bata berfakta, {len(set(facts_all))} unik -> {'OK' if unique else 'GAGAL (ada dobel)'}")
    if not unique:
        report['ok'] = False
    targets, n_front = pick_targets(page, args.count)
    print(f'bata depan yang bisa di-hover: {n_front}, dipilih {len(targets)}')
    for t in targets:
        # mulai dari langit tiap kali: label sebelumnya harus pudar dulu, jadi yang ditunggu pasti label baru
        page.mouse.move(args.width * 0.9, args.height * 0.1, steps=4)
        page.wait_for_function('__igloo.engine.ui.factLabel.show1 === 0 && __igloo.engine.scenes[0].facts.current === -1', timeout=15000)
        page.mouse.move(t['x'], t['y'], steps=6)
        try:
            page.wait_for_function('__igloo.engine.scenes[0].facts.current >= 0 && __igloo.engine.ui.factLabel.show2 >= 1 '
                                   '&& __igloo.engine.ui.factLabel.line >= 1', timeout=15000)
        except Exception:
            pass
        page.wait_for_timeout(150)
        st = state(page)
        path = shot(page, f'brick{t["i"]:02d}', st, args.tag)
        # kursor diam 2.4 s di atas bata (bata tetap bergoyang karena dorongan mouse): label tidak boleh gonta-ganti
        seq = page.evaluate('''new Promise((r) => { const f = __igloo.engine.scenes[0].facts, out = []
          const id = setInterval(() => { out.push(f.current); if (out.length >= 24) { clearInterval(id); r(out) } }, 100) })''')
        switches = sum(1 for a, b in zip(seq, seq[1:]) if a != b)
        same = st['current'] == t['i']
        good = (st['current'] >= 0 and st['text'] == st['fact'] and st['show1'] >= 1 and st['hovered'] == st['current']
                and switches <= 1)
        report['hover'].append({'target': t['i'], 'want': t['fact'], **{k: st[k] for k in ('current', 'fact', 'text', 'lift', 'show1')},
                                'switches': switches, 'ok': good})
        print(f'hover bata {t["i"]:2d} ({t["fact"]}) -> current {st["current"]:2d} label "{st["text"]}" '
              f'lift {st["lift"]:.2f} show1 {st["show1"]:.2f} ganti selama diam {switches}x '
              f'{"OK" if good else "GAGAL"}{"" if same else " (kena bata tetangga)"}  {path}')
        report['ok'] &= good

    # lepas: mouse ke langit, label harus pudar habis
    page.mouse.move(args.width * 0.9, args.height * 0.1, steps=4)
    page.wait_for_timeout(1200)
    st = state(page)
    good = st['current'] == -1 and st['show1'] == 0 and not st['visible'] and st['hovered'] == -1
    print(f'lepas ke langit -> current {st["current"]} show1 {st["show1"]:.2f} visible {st["visible"]} {"OK" if good else "GAGAL"}  '
          f'{shot(page, "leave", st, args.tag)}')
    report['leave'] = good
    report['ok'] &= good
    return targets


def no_label_elsewhere(page, args, targets, report):
    t = targets[len(targets) // 2] if targets else {'x': args.width / 2, 'y': args.height / 2}
    for n, label in ((1.0, 'luar titik istirahat igloo'), (3.35, 'scene kristal')):
        page.evaluate(f'__igloo.setScroll({n})')
        page.mouse.move(args.width * 0.9, args.height * 0.1)
        page.wait_for_timeout(300)
        page.mouse.move(t['x'], t['y'], steps=6)
        page.wait_for_timeout(1200)
        st = state(page)
        good = st['current'] == -1 and not st['visible']
        print(f'n={n} ({label}) progress igloo {st["progress"]:.3f} aktif {st["active"]} -> current {st["current"]} '
              f'visible {st["visible"]} {"OK" if good else "GAGAL"}  {shot(page, f"n{n:.2f}", st, args.tag)}')
        report['elsewhere'].append(good)
        report['ok'] &= good
    page.evaluate('__igloo.setScroll(0.658)')


def fps_hover(page, args, targets, report):
    if not targets:
        return
    page.mouse.move(args.width * 0.9, args.height * 0.1)
    page.wait_for_timeout(500)
    t = targets[0]
    # ayun kecil di atas bata selama 4 s, avgFps = rata-rata 8 sampel x 0.5 s
    for k in range(16):
        page.mouse.move(t['x'] + (k % 4 - 1.5) * 3, t['y'] + (k % 3 - 1) * 3, steps=3)
        page.wait_for_timeout(250)
    st = state(page)
    report['fps'] = round(st['fps'], 1)
    print(f'FPS sambil hover: {st["fps"]:.1f} (label "{st["text"]}", visible {st["visible"]})')


def intro_check(page, args, report):
    """Halaman baru dimuat dengan intro: hover di tengah igloo selagi intro jalan."""
    running = page.evaluate('__igloo.intro.running')
    if not running:
        print('intro sudah selesai sebelum dicek (halaman lambat), langkah intro dilewati')
        report['intro'] = None
        return
    for k in range(10):
        page.mouse.move(args.width * (0.45 + 0.01 * k), args.height * (0.55 - 0.01 * k), steps=2)
        page.wait_for_timeout(120)
    st = state(page)
    good = st['current'] == -1 and not st['visible'] and st['hovered'] == -1
    print(f'intro jalan ({st["intro"]}) -> current {st["current"]} visible {st["visible"]} {"OK" if good else "GAGAL"}  '
          f'{shot(page, "intro", st, args.tag)}')
    report['intro'] = good
    report['ok'] &= good


def touch_check(browser, args, url, errors, report):
    ctx = browser.new_context(viewport={'width': args.width, 'height': args.height}, has_touch=True)
    page = ctx.new_page()
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    sep = '&' if '?' in url else '?'
    page.goto(url + sep + 'nointro')
    wait_ready(page)
    page.evaluate('__igloo.enableScroll(false); __igloo.adaptive(false); __igloo.setScroll(0.658)')
    page.wait_for_function('__igloo.engine.ui.introStarted', timeout=20000)
    page.wait_for_timeout(600)
    targets, _ = pick_targets(page, 3)
    if not targets:
        print('sentuh: tidak ada bata depan, GAGAL')
        report['touch'] = False
        report['ok'] = False
        ctx.close()
        return
    t = targets[1] if len(targets) > 1 else targets[0]
    page.touchscreen.tap(t['x'], t['y'])
    try:
        page.wait_for_function('__igloo.engine.ui.factLabel.show2 >= 1', timeout=15000)
    except Exception:
        pass
    st = state(page)
    good = st['current'] >= 0 and st['text'] == st['fact'] and st['visible']
    print(f'tap bata {t["i"]} ({t["fact"]}) -> current {st["current"]} label "{st["text"]}" {"OK" if good else "GAGAL"}  '
          f'{shot(page, "touch", st, args.tag)}')
    page.touchscreen.tap(args.width * 0.9, args.height * 0.1)
    page.wait_for_timeout(1000)
    st2 = state(page)
    good2 = st2['current'] == -1 and not st2['visible']
    print(f'tap langit -> current {st2["current"]} visible {st2["visible"]} {"OK" if good2 else "GAGAL"}')
    report['touch'] = good and good2
    report['ok'] &= good and good2
    ctx.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://localhost:5182/')
    ap.add_argument('--tag', default='hover')
    ap.add_argument('--width', type=int, default=1024)
    ap.add_argument('--height', type=int, default=768)
    ap.add_argument('--count', type=int, default=5)
    ap.add_argument('--gpu', action='store_true', help='pakai GPU asli (D3D11), jauh lebih cepat dari SwiftShader')
    ap.add_argument('--skip-touch', action='store_true')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    errors = []
    report = {'ok': True, 'hover': [], 'elsewhere': []}
    with sync_playwright() as p:
        if args.gpu:
            flags = ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu']
        else:
            flags = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
        browser = p.chromium.launch(args=flags)
        page = browser.new_page(viewport={'width': args.width, 'height': args.height})
        page.set_default_timeout(120000)
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(args.url)
        wait_ready(page)
        intro_check(page, args, report)
        # tunggu intro selesai sendiri (bukan dipaksa), lalu UI muncul
        page.wait_for_function('!__igloo.intro.running && __igloo.engine.ui.introStarted', timeout=60000)
        page.evaluate('__igloo.enableScroll(false); __igloo.adaptive(false)')
        facts = page.evaluate(A11Y_JS)
        report['a11y'] = len(facts)
        print(f'a11y: {len(facts)} fakta di #a11y section[data-igloo-facts]')
        targets = hover_rest(page, args, report)
        no_label_elsewhere(page, args, targets, report)
        fps_hover(page, args, targets, report)
        if not args.skip_touch:
            touch_check(browser, args, args.url, errors, report)
        browser.close()
    print('ringkasan', json.dumps({k: v for k, v in report.items() if k != 'hover'}))
    print('console errors:', errors if errors else 'nol')
    sys.exit(0 if report['ok'] and not errors else 1)


if __name__ == '__main__':
    main()
