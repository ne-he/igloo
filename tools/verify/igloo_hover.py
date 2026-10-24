"""Verifikasi fakta hover bata igloo (src/scenes/igloo/BrickFacts.js + src/scenes/ui/FactLabel.js + FactCounter.js).

Pakai:  python tools/verify/igloo_hover.py [--url http://localhost:5182/] [--gpu] [--tag hover]
        [--width 1024 --height 768] [--count 5] [--skip-touch] [--glimmer-seconds 15]
Butuh dev server jalan (sebaiknya tanpa HMR, supaya edit agent lain tidak me-reload halaman di tengah run).
Output: tools/verify/out/<tag>_*.png (layar penuh) dan <tag>_*_zoom.png (potongan label diperbesar 2x).

Langkah:
  1. intro: mouse di atas igloo selagi intro jalan -> tidak boleh ada label, tidak ada bata yang di-hover,
     dan tidak ada kilau biru selama intro (dicatat sampai intro selesai).
  2. titik istirahat: hover beberapa bata depan (fakta berbeda), tunggu reveal selesai, cek kartu: kepala
     "FACT 03/12" = nomor fakta bata itu, teks = fakta, bata terangkat (h2 naik), penghitung naik satu, screenshot.
  3. hover ulang bata yang sudah ketemu -> penghitung tidak naik. Screenshot penghitung di tengah jalan.
  4. mouse ke langit -> label pudar habis.
  5. kilau: kursor di langit sekian detik, catat bata yang berkilau. Harus bata berfakta yang belum ketemu,
     jarak antar awal kilau 3 sampai 5 s. Screenshot satu frame kilau.
  6. di luar titik istirahat (n 1.0) dan di scene kristal (n 3.35) -> hover tidak memunculkan label, penghitung
     sembunyi di scene kristal dan saat mode detail.
  7. FPS sambil hover (waktu nyata, sangat dipengaruhi agent lain yang ikut merender).
  8. semua fakta: bata berfakta sisanya dicari lewat pick() lalu di-hover satu per satu. Penghitung "ALL 12 FOUND",
     event bus 'igloo_facts_complete' tepat sekali (juga sesudah hover ulang), kilau berhenti. Screenshot.
  9. layar sentuh (konteks has_touch) di ukuran utama dan 375x812: tap bata -> kartu muncul di dalam layar,
     tap langit -> pudar.
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
  const e = __igloo.engine, s = e.scenes[0], f = s.facts, l = e.ui.factLabel, b = s.igloo.bricks, c = e.ui.factCounter
  const cur = f.current
  return {
    current: cur,
    fact: cur >= 0 ? f.factOf(cur) : null,
    number: cur >= 0 ? f.assignment[cur] + 1 : 0,
    hovered: b.hovered,
    lift: cur >= 0 ? b.bricks[cur].h2 : 0,
    show1: l.show1, show2: l.show2, line: l.line, factShow2: l.factShow2,
    visible: l.visible,
    text: l.text.text,
    header: l.header.text,
    box: l.layoutResult ? l.layoutResult.box : null,
    found: f.tracker.count,
    foundList: Array.from(f.tracker.found),
    counter: c.text.text, counterCount: c.count, counterVisible: c.visible, counterShow: c.show1,
    counterRect: c.layout ? c.layout.rect : null, counterComplete: c.complete,
    glimmer: [b.glimmer.index, b.glimmer.amount],
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


# Titik layar yang pick() memang mengenai bata berfakta itu sendiri (bata depan bisa tertutup sebagian tetangga):
# cari melingkar dari proyeksi tengah bata sampai kena. Juga daftar bata berfakta, fakta, dan nomornya.
FACT_POINTS_JS = """
(() => {
  const e = __igloo.engine, s = e.scenes[0], cam = s.camera, W = innerWidth, H = innerHeight, f = s.facts
  const out = []
  for (const i of f.factBricks) {
    const b = s.igloo.bricks.bricks[i]
    const c = b.position.clone().project(cam)
    let pt = null
    for (let r = 0; r <= 0.08 && !pt; r += 0.005) {
      for (let a = 0; a < 16 && !pt; a++) {
        const x = c.x + r * Math.cos(a * Math.PI / 8) * H / W, y = c.y + r * Math.sin(a * Math.PI / 8)
        if (f.pick({ x, y }) === i) pt = { x: (x * 0.5 + 0.5) * W, y: (0.5 - y * 0.5) * H }
      }
    }
    out.push({ i, fact: f.assignment[i], text: f.factOf(i), found: f.tracker.has(f.assignment[i]), pt,
               c: { x: (c.x * 0.5 + 0.5) * W, y: (0.5 - c.y * 0.5) * H } })
  }
  return out
})()
"""

# Pendengar bus di halaman (modul /src/engine/Bus.js yang sama dengan app, server dev Vite)
BUS_JS = """
(async () => {
  if (window.__factEvents) return true
  const { bus } = await import('/src/engine/Bus.js')
  window.__factEvents = { found: [], complete: 0 }
  bus.on('igloo_fact_found', (e) => window.__factEvents.found.push([e.fact, e.count, e.total]))
  bus.on('igloo_facts_complete', () => window.__factEvents.complete++)
  return true
})()
"""

# Rekam kilau tiap frame selama ms milidetik: [detik, bata, kekuatan, jumlah fakta yang sudah ketemu]
GLIMMER_LOG_JS = """
(ms) => new Promise((resolve) => {
  const s = __igloo.engine.scenes[0], g = s.igloo.bricks.glimmer, f = s.facts, out = [], t0 = performance.now()
  const step = () => {
    const t = performance.now() - t0
    out.push([t / 1000, g.index, g.amount, f.tracker.count])
    if (t < ms) requestAnimationFrame(step); else resolve(out)
  }
  requestAnimationFrame(step)
})
"""


def zoom_rect(path, rect, name, tag, pad=40, scale=2):
    """Potongan screenshot di sekitar kotak piksel (x0, y0, x1, y1), diperbesar."""
    img = Image.open(path)
    x0 = max(0, int(rect['x0']) - pad)
    y0 = max(0, int(rect['y0']) - pad)
    x1 = min(img.width, int(rect['x1']) + pad)
    y1 = min(img.height, int(rect['y1']) + pad)
    crop = img.crop((x0, y0, x1, y1))
    crop = crop.resize((crop.width * scale, crop.height * scale), Image.LANCZOS)
    out = os.path.join(OUT, f'{tag}_{name}_zoom.png')
    crop.save(out)
    return os.path.relpath(out)


def hover_fact(page, args, pt, fact, timeout=6000):
    """Kursor dari langit ke titik bata berfakta, tunggu sampai fakta itu terhitung ditemukan."""
    page.mouse.move(args.width * 0.9, args.height * 0.1, steps=3)
    page.wait_for_function('__igloo.engine.scenes[0].facts.current === -1', timeout=15000)
    page.mouse.move(pt['x'], pt['y'], steps=5)
    try:
        page.wait_for_function(f'__igloo.engine.scenes[0].facts.tracker.has({fact})', timeout=timeout)
        return True
    except Exception:
        return False


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
    total = page.evaluate('__igloo.engine.scenes[0].facts.tracker.total')
    st0 = state(page)
    good0 = st0['found'] == 0 and not st0['counterVisible']
    print(f'sebelum fakta pertama: ditemukan {st0["found"]}, penghitung tampil {st0["counterVisible"]} {"OK" if good0 else "GAGAL"}')
    report['ok'] &= good0
    for t in targets:
        # mulai dari langit tiap kali: label sebelumnya harus pudar dulu, jadi yang ditunggu pasti label baru
        page.mouse.move(args.width * 0.9, args.height * 0.1, steps=4)
        page.wait_for_function('__igloo.engine.ui.factLabel.show1 === 0 && __igloo.engine.scenes[0].facts.current === -1', timeout=15000)
        st_prev = state(page)
        prev = st_prev['found']
        retried = False
        for attempt in range(2):
            if attempt:
                # bata bergeser sejak target dipilih (napas, dorongan mouse, kilau): titik baru lalu hover ulang
                fresh = next((x for x in page.evaluate(FACT_POINTS_JS) if x['i'] == t['i']), None)
                if not fresh or not fresh['pt']:
                    break
                retried = True
                page.mouse.move(args.width * 0.9, args.height * 0.1, steps=4)
                page.wait_for_function('__igloo.engine.ui.factLabel.show1 === 0 && __igloo.engine.scenes[0].facts.current === -1', timeout=15000)
                t = {**t, 'x': fresh['pt']['x'], 'y': fresh['pt']['y']}
            page.mouse.move(t['x'], t['y'], steps=6)
            try:
                page.wait_for_function(f'__igloo.engine.scenes[0].facts.current === {t["i"]} && __igloo.engine.ui.factLabel.factShow2 >= 1 '
                                       '&& __igloo.engine.ui.factLabel.line >= 1', timeout=6000)
                break
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
        want_header = f'FACT {st["number"]:02d}/{total:02d}'
        # kartu: kepala nomor fakta, teks fakta. Penghitung: fakta bata ini terhitung, naik tepat satu per fakta baru
        # (event bus berurutan 1, 2, 3, ... tanpa fakta dobel), teks penghitung sama dengan jumlahnya.
        card_ok = st['header'] == want_header and st['factShow2'] >= 1
        ev = page.evaluate('window.__factEvents')
        counts = [c for _, c, _ in ev['found']]
        fact_idx = st['number'] - 1
        # fakta ini bisa sudah terhitung lebih dulu kalau hover sebelumnya sempat kena bata ini: tidak boleh naik lagi
        if fact_idx in st_prev['foundList']:
            grew = st['found'] == prev
        else:
            grew = st['found'] == prev + 1 or (retried and st['found'] > prev)
        count_ok = (grew and fact_idx in st['foundList'] and counts == list(range(1, st['found'] + 1))
                    and len({f for f, _, _ in ev['found']}) == len(counts) and st['counter'] == f'FOUND {st["found"]}/{total}')
        good = (st['current'] >= 0 and st['text'] == st['fact'] and st['show1'] >= 1 and st['hovered'] == st['current']
                and switches <= 1 and card_ok and count_ok)
        report['hover'].append({'target': t['i'], 'want': t['fact'], **{k: st[k] for k in ('current', 'fact', 'text', 'lift', 'show1')},
                                'switches': switches, 'ok': good})
        print(f'hover bata {t["i"]:2d} ({t["fact"]}) -> current {st["current"]:2d} kartu "{st["header"]}" / "{st["text"]}" '
              f'(mau "{want_header}") lift {st["lift"]:.2f} show1 {st["show1"]:.2f} ganti selama diam {switches}x '
              f'penghitung "{st["counter"]}" {"OK" if good else "GAGAL"}{"" if same else " (kena bata tetangga)"}'
              f'{" (hover ulang, bata sempat bergeser)" if retried else ""}  {path}')
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


def repeat_and_mid(page, args, targets, report):
    """Hover ulang bata yang sudah ketemu: penghitung tidak naik. Screenshot penghitung di tengah jalan."""
    before = state(page)
    page.mouse.move(args.width * 0.9, args.height * 0.1, steps=3)
    page.wait_for_function('__igloo.engine.scenes[0].facts.current === -1', timeout=15000)
    # bata yang faktanya sudah ketemu, titik dihitung tepat sebelum hover
    done = [x for x in page.evaluate(FACT_POINTS_JS) if x['found'] and x['pt']]
    if not done:
        print('hover ulang: tidak ada bata berfakta yang sudah ketemu dan terlihat, GAGAL')
        report['repeat'] = False
        report['ok'] = False
        return
    t = done[0]
    page.mouse.move(t['pt']['x'], t['pt']['y'], steps=6)
    try:
        page.wait_for_function(f'__igloo.engine.scenes[0].facts.current === {t["i"]} && __igloo.engine.ui.factLabel.factShow2 >= 1',
                               timeout=6000)
    except Exception:
        pass
    page.wait_for_timeout(600)
    st = state(page)
    ev = page.evaluate('window.__factEvents')
    good = st['found'] == before['found'] and st['counter'] == before['counter'] and st['current'] == t['i'] \
        and len(ev['found']) == before['found']
    print(f'hover ulang bata {t["i"]} ({t["text"]}) -> current {st["current"]}, ditemukan {before["found"]} -> {st["found"]}, '
          f'penghitung "{st["counter"]}", event igloo_fact_found {len(ev["found"])}x {"OK" if good else "GAGAL"}')
    report['repeat'] = good
    report['ok'] &= good
    # penghitung di tengah jalan, kartu dilepas dulu supaya pojok kanan atas bersih
    page.mouse.move(args.width * 0.9, args.height * 0.1, steps=3)
    page.wait_for_function('__igloo.engine.ui.factLabel.show1 === 0', timeout=15000)
    page.wait_for_timeout(300)
    st = state(page)
    path = shot(page, 'counter_mid', None, args.tag)
    z = zoom_rect(os.path.join(OUT, f'{args.tag}_counter_mid.png'), st['counterRect'], 'counter_mid', args.tag, scale=3)
    print(f'penghitung tengah jalan: "{st["counter"]}" tampil {st["counterVisible"]}  {path}  {z}')


def glimmer_check(page, args, report):
    """Kursor di langit: catat kilau tiap frame. Harus bata berfakta yang belum ketemu, jarak awal kilau 3 sampai 5 s."""
    page.mouse.move(args.width * 0.9, args.height * 0.1, steps=3)
    page.wait_for_timeout(300)
    facts = page.evaluate(FACT_POINTS_JS)
    unfound = {f['i'] for f in facts if not f['found']}
    log = page.evaluate(GLIMMER_LOG_JS, args.glimmer_seconds * 1000)
    starts = []
    prev = -1
    peaks = {}
    for t, idx, amt, _ in log:
        if idx >= 0 and idx != prev:
            starts.append((t, idx))
        if idx >= 0:
            peaks[len(starts) - 1] = max(peaks.get(len(starts) - 1, 0), amt)
        prev = idx
    bricks = [i for _, i in starts]
    gaps = [round(b[0] - a[0], 2) for a, b in zip(starts, starts[1:])]
    only_unfound = all(i in unfound for i in bricks)
    gaps_ok = all(2.9 <= g <= 5.2 for g in gaps)
    # kilau pertama bisa sudah jalan saat rekaman mulai, yang terakhir bisa terpotong: puncaknya tidak dinilai
    partial_first = bool(log) and log[0][1] >= 0
    peak_ok = all(v > 0.8 for k, v in peaks.items() if k < len(starts) - 1 and not (k == 0 and partial_first))
    good = len(starts) >= 2 and only_unfound and gaps_ok and peak_ok
    print(f'kilau {args.glimmer_seconds} s: {len(starts)} kilau di bata {bricks} (belum ketemu: {sorted(unfound)}), '
          f'jarak antar awal {gaps} s, puncak {[round(v, 2) for v in peaks.values()]} {"OK" if good else "GAGAL"}')
    report['glimmer'] = {'starts': [[round(t, 2), i] for t, i in starts], 'ok': good}
    report['ok'] &= good
    # satu frame kilau di puncak. Screenshot Playwright bisa makan 0.5 s (lebih lama dari puncak kilau), jadi jadwal
    # kilau ditahan di tempat selama foto (update() dibayangi sementara), sesudahnya dilepas lagi
    try:
        page.wait_for_function('__igloo.engine.scenes[0].igloo.bricks.glimmer.amount > 0.9', timeout=8000, polling='raf')
        g = page.evaluate("""(() => { const s = __igloo.engine.scenes[0], gl = s.facts.glimmer
          gl.update = function () { return this }
          const b = s.igloo.bricks.bricks[gl.index], c = b.position.clone().project(s.camera)
          return { index: gl.index, amount: gl.amount, x: (c.x * 0.5 + 0.5) * innerWidth, y: (0.5 - c.y * 0.5) * innerHeight } })()""")
        page.wait_for_timeout(100)
        path = shot(page, 'glimmer', None, args.tag)
        page.evaluate('delete __igloo.engine.scenes[0].facts.glimmer.update')
        z = zoom_rect(os.path.join(OUT, f'{args.tag}_glimmer.png'), {'x0': g['x'] - 90, 'y0': g['y'] - 70, 'x1': g['x'] + 90, 'y1': g['y'] + 70},
                      'glimmer', args.tag, pad=0)
        print(f'screenshot kilau: bata {g["index"]} kekuatan {g["amount"]:.2f} (ditahan selama foto)  {path}  {z}')
    except Exception as e:
        page.evaluate('delete __igloo.engine.scenes[0].facts.glimmer.update')
        print(f'screenshot kilau GAGAL: {e}')
        report['ok'] = False


def all_found(page, args, report):
    """Cari semua bata berfakta lewat pick(), hover yang belum ketemu satu per satu, cek keadaan selesai."""
    page.evaluate('__igloo.setScroll(0.658)')
    page.mouse.move(args.width * 0.9, args.height * 0.1)
    page.wait_for_timeout(600)
    total = page.evaluate('__igloo.engine.scenes[0].facts.tracker.total')
    seq = []
    for attempt in range(3):
        facts = page.evaluate(FACT_POINTS_JS)
        todo = [f for f in facts if not f['found']]
        if not todo:
            break
        for f in todo:
            # posisi diambil ulang tepat sebelum hover (bata bernapas, kamera parallax)
            fresh = next(x for x in page.evaluate(FACT_POINTS_JS) if x['i'] == f['i'])
            if not fresh['pt']:
                print(f'  bata {f["i"]} ({f["text"]}) tidak bisa dikenai sinar dari kamera, dicoba lagi nanti')
                continue
            ok = hover_fact(page, args, fresh['pt'], f['fact'])
            st = state(page)
            seq.append(st['found'])
            print(f'  hover bata {f["i"]:2d} fakta {f["fact"] + 1:2d} ({f["text"]}) -> {"ketemu" if ok else "BELUM"}, '
                  f'penghitung "{st["counter"]}"')
            if st['found'] == total:
                # sorot selesai masih jalan (2.4 s): foto sesudah scramble mendarat, teks masih biru es
                page.wait_for_function('__igloo.engine.ui.factCounter.show2 >= 1', timeout=5000)
                st = state(page)
                path = shot(page, 'complete', None, args.tag)
                z = zoom_rect(os.path.join(OUT, f'{args.tag}_complete.png'), st['counterRect'], 'complete', args.tag, scale=3)
                print(f'  semua ketemu, sorot: "{st["counter"]}"  {path}  {z}')
    page.mouse.move(args.width * 0.9, args.height * 0.1, steps=3)
    page.wait_for_timeout(2500)
    st = state(page)
    ev = page.evaluate('window.__factEvents')
    counts = [c for _, c, _ in ev['found']]
    once = counts == list(range(1, total + 1)) and len({f for f, _, _ in ev['found']}) == total
    complete_text = page.evaluate(f"__igloo.engine.ui.factCounter.strings.complete.replace('{{total}}', '{total}')")
    good = st['found'] == total and st['counterComplete'] and st['counter'] == complete_text and ev['complete'] == 1 and once
    print(f'semua fakta: ditemukan {st["found"]}/{total}, penghitung "{st["counter"]}" tampil {st["counterVisible"]}, '
          f'urutan hitung event {counts}, igloo_facts_complete {ev["complete"]}x {"OK" if good else "GAGAL"}')
    # hover ulang satu bata: event selesai tetap sekali
    facts = page.evaluate(FACT_POINTS_JS)
    again = next((f for f in facts if f['pt']), None)
    if again:
        page.mouse.move(again['pt']['x'], again['pt']['y'], steps=5)
        page.wait_for_timeout(1500)
    ev2 = page.evaluate('window.__factEvents')
    good2 = ev2['complete'] == 1 and len(ev2['found']) == total
    print(f'hover ulang sesudah selesai -> igloo_facts_complete {ev2["complete"]}x, igloo_fact_found {len(ev2["found"])}x '
          f'{"OK" if good2 else "GAGAL"}')
    # kilau berhenti
    page.mouse.move(args.width * 0.9, args.height * 0.1, steps=3)
    log = page.evaluate(GLIMMER_LOG_JS, 6000)
    glims = sorted({i for _, i, _, _ in log if i >= 0})
    good3 = not glims
    print(f'kilau 6 s sesudah semua ketemu: bata {glims} {"OK" if good3 else "GAGAL"}')
    report['all_found'] = good and good2 and good3
    report['ok'] &= good and good2 and good3


def no_label_elsewhere(page, args, targets, report):
    t = targets[len(targets) // 2] if targets else {'x': args.width / 2, 'y': args.height / 2}
    for n, label in ((1.0, 'luar titik istirahat igloo'), (3.35, 'scene kristal')):
        page.evaluate(f'__igloo.setScroll({n})')
        page.mouse.move(args.width * 0.9, args.height * 0.1)
        page.wait_for_timeout(300)
        page.mouse.move(t['x'], t['y'], steps=6)
        page.wait_for_timeout(1200)
        st = state(page)
        # penghitung: tetap tampil di scene igloo (n 1.0), sembunyi di scene kristal
        counter_ok = st['counterVisible'] == (n < 2)
        good = st['current'] == -1 and not st['visible'] and counter_ok
        print(f'n={n} ({label}) progress igloo {st["progress"]:.3f} aktif {st["active"]} -> current {st["current"]} '
              f'visible {st["visible"]} penghitung tampil {st["counterVisible"]} {"OK" if good else "GAGAL"}  '
              f'{shot(page, f"n{n:.2f}", st, args.tag)}')
        report['elsewhere'].append(good)
        report['ok'] &= good
    page.evaluate('__igloo.setScroll(0.658)')
    page.mouse.move(args.width * 0.9, args.height * 0.1)
    page.wait_for_timeout(800)
    back = state(page)['counterVisible']
    # mode detail (sintetis: detail sungguhan hanya bisa dibuka dari scene kristal, di sana penghitung sudah sembunyi)
    page.evaluate('__igloo.engine.ui.setDetailMode(true)')
    page.wait_for_timeout(700)
    in_detail = state(page)['counterVisible']
    page.evaluate('__igloo.engine.ui.setDetailMode(false)')
    page.wait_for_timeout(800)
    after = state(page)['counterVisible']
    good = back and not in_detail and after
    print(f'penghitung: kembali ke igloo tampil {back}, mode detail tampil {in_detail}, sesudah detail tampil {after} '
          f'{"OK" if good else "GAGAL"}')
    report['elsewhere'].append(good)
    report['ok'] &= good


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
    # kilau dicatat tiap frame sampai intro selesai (tidak boleh ada sama sekali)
    page.evaluate("""(() => { const b = __igloo.engine.scenes[0].igloo.bricks, out = window.__introGlimmer = { n: 0, max: 0, idx: [] }
      const step = () => { if (!__igloo.intro.running) return; out.n++; out.max = Math.max(out.max, b.glimmer.amount)
        if (b.glimmer.index >= 0) out.idx.push(b.glimmer.index); requestAnimationFrame(step) }
      requestAnimationFrame(step) })()""")
    for k in range(10):
        page.mouse.move(args.width * (0.45 + 0.01 * k), args.height * (0.55 - 0.01 * k), steps=2)
        page.wait_for_timeout(120)
    st = state(page)
    good = st['current'] == -1 and not st['visible'] and st['hovered'] == -1
    print(f'intro jalan ({st["intro"]}) -> current {st["current"]} visible {st["visible"]} {"OK" if good else "GAGAL"}  '
          f'{shot(page, "intro", st, args.tag)}')
    page.wait_for_function('!__igloo.intro.running', timeout=60000)
    ig = page.evaluate('window.__introGlimmer')
    good_g = ig['max'] == 0 and not ig['idx']
    print(f'kilau selama intro: {ig["n"]} frame, kekuatan maks {ig["max"]:.2f}, bata {sorted(set(ig["idx"]))} '
          f'{"OK" if good_g else "GAGAL"}')
    report['intro'] = good and good_g
    report['ok'] &= good and good_g


def touch_check(browser, args, url, errors, report, width=None, height=None, name='touch'):
    width = width or args.width
    height = height or args.height
    ctx = browser.new_context(viewport={'width': width, 'height': height}, has_touch=True)
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
        page.wait_for_function('__igloo.engine.ui.factLabel.factShow2 >= 1', timeout=15000)
    except Exception:
        pass
    page.wait_for_timeout(250)
    st = state(page)
    b = st['box'] or {'x0': -1, 'y0': -1, 'x1': 1e9, 'y1': 1e9}
    inside = b['x0'] >= 0 and b['y0'] >= 0 and b['x1'] <= width and b['y1'] <= height
    avoid = page.evaluate('__igloo.engine.ui.factLabel.avoid.concat(__igloo.engine.ui.factLabel.avoidExtra)')
    hits = [r for r in avoid if b['x0'] < r['x1'] and b['x1'] > r['x0'] and b['y0'] < r['y1'] and b['y1'] > r['y0']]
    good = st['current'] >= 0 and st['text'] == st['fact'] and st['visible'] and inside
    path = shot(page, name, st, args.tag)
    cz = zoom_rect(os.path.join(OUT, f'{args.tag}_{name}.png'), st['counterRect'], f'{name}_counter', args.tag) if st['counterRect'] else '-'
    print(f'{width}x{height} tap bata {t["i"]} ({t["fact"]}) -> kartu "{st["header"]}" / "{st["text"]}" kotak '
          f'({b["x0"]:.0f},{b["y0"]:.0f})-({b["x1"]:.0f},{b["y1"]:.0f}) di dalam layar {inside}, menabrak blok UI {len(hits)}, '
          f'penghitung "{st["counter"]}" tampil {st["counterVisible"]} {"OK" if good else "GAGAL"}  {path}  {cz}')
    page.touchscreen.tap(width * 0.9, height * 0.1)
    page.wait_for_timeout(1000)
    st2 = state(page)
    good2 = st2['current'] == -1 and not st2['visible']
    print(f'tap langit -> current {st2["current"]} visible {st2["visible"]} {"OK" if good2 else "GAGAL"}')
    report[name] = good and good2
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
    ap.add_argument('--glimmer-seconds', type=float, default=15)
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
        page.evaluate(BUS_JS)
        targets = hover_rest(page, args, report)
        repeat_and_mid(page, args, targets, report)
        glimmer_check(page, args, report)
        no_label_elsewhere(page, args, targets, report)
        fps_hover(page, args, targets, report)
        all_found(page, args, report)
        if not args.skip_touch:
            touch_check(browser, args, args.url, errors, report)
            touch_check(browser, args, args.url, errors, report, 375, 812, 'mobile_touch')
        browser.close()
    print('ringkasan', json.dumps({k: v for k, v in report.items() if k not in ('hover', 'found_seq')}))
    print('console errors:', errors if errors else 'nol')
    sys.exit(0 if report['ok'] and not errors else 1)


if __name__ == '__main__':
    main()
