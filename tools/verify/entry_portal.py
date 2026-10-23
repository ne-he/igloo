"""Cek kamera entry lewat tengah cincin portal di berbagai kecepatan scroll (GPU asli, Chromium headless).

Pakai:  python tools/verify/entry_portal.py [--url http://localhost:5183/] [--modes slow,normal,fast,burst]
        [--pointers center,corner] [--json out.json]
Butuh dev server jalan. Tiap kombinasi mode x pointer:
  1. lompat ke kristal terakhir (n 4.35, scene entry belum terlihat), pointer diset lewat __igloo.setPointer
  2. event wheel sintetis dikirim dari dalam halaman dengan jadwal tetap (setInterval), sampai progress entry
     mentah lewat 0.5, lalu dilepas (auto-center ikut jalan seperti user sungguhan)
  3. tiap frame (callback rAF sesudah engine merender) dicatat posisi dunia kamera entry, sampai kamera turun
     melewati y -7.2
  4. saat y kamera memotong y tiap cincin (-1.65 / -4.15 / -6.65), x dan z diinterpolasi linear antar frame.
     Offset lateral = jarak ke poros cincin (x 0, z 0). Lubang cincin r 0.27, near plane 0.1.
Mode: slow = 1 notch (deltaY 100) tiap 250 ms, normal = tiap 100 ms, fast = deltaY 300 tiap 16 ms (wheel bebas /
trackpad), burst = 8 event deltaY 250 berjarak 8 ms lalu jeda 120 ms (sentakan beruntun).
Pointer: center = (0, 0) tanpa parallax, corner = (1, 1) parallax maksimum.
--shots: sesudah tabel, satu run slow dan satu run fast (pointer tengah) dengan capture canvas di dalam halaman
saat kamera 0.5 di atas tiap cincin -> tools/verify/out/entry_portal_slow.png dan entry_portal_fast.png.
Exit 1 kalau ada error console atau offset di atas --limit.
"""
import argparse
import base64
import json
import math
import os
import sys

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

RING_Y = [-1.65, -4.15, -6.65]
MODES = {
    'slow': {'dy': 100, 'interval': 250, 'burst': 1, 'pause': 0},
    'normal': {'dy': 100, 'interval': 100, 'burst': 1, 'pause': 0},
    'fast': {'dy': 300, 'interval': 16, 'burst': 1, 'pause': 0},
    'burst': {'dy': 250, 'interval': 8, 'burst': 8, 'pause': 120},
}
POINTERS = {'center': (0, 0), 'corner': (1, 1)}
START_N = 4.35  # kristal terakhir, tepat sebelum entry mulai terlihat

RUN_JS = '''async (cfg) => {
  const e = __igloo.engine
  const entry = e.scenes.find((s) => s.key === 'entry')
  const rec = []
  const shots = []
  let done = false
  const cam = entry.camera
  const ringY = [-1.65, -4.15, -6.65]
  let lastY = null
  const tick = () => {
    if (entry.active) {
      const p = cam.position
      const b = cam.basePosition
      rec.push([performance.now(), entry.progress, p.x, p.y, p.z, b.x, b.y, b.z])
      // capture: frame saat kamera melewati 0.5 di atas tiap cincin. Callback rAF ini jalan sesudah engine
      // merender di frame yang sama, jadi isi canvas masih utuh untuk toDataURL.
      if (cfg.capture && lastY !== null) {
        ringY.forEach((ry, i) => {
          if (lastY > ry + 0.5 && p.y <= ry + 0.5) {
            shots.push({ ring: i, y: p.y - ry, x: p.x, z: p.z, img: e.renderer.domElement.toDataURL('image/jpeg', 0.85) })
          }
        })
      }
      lastY = p.y
    }
    if (!done) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  const el = e.input.el
  const r = el.getBoundingClientRect()
  const send = () => el.dispatchEvent(new WheelEvent('wheel', {
    deltaY: cfg.dy, deltaMode: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
    bubbles: true, cancelable: true,
  }))
  const t0 = performance.now()
  const past = () => entry.active && entry.progress > cfg.stopP
  await new Promise((res) => {
    let k = 0
    const loop = () => {
      if (past() || performance.now() - t0 > cfg.maxMs) return res()
      send()
      k++
      const wait = cfg.burst > 1 && k % cfg.burst === 0 ? cfg.pause : cfg.interval
      setTimeout(loop, wait)
    }
    loop()
  })
  const tStop = performance.now()
  await new Promise((res) => {
    const chk = () => {
      if (cam.position.y < -7.2 || performance.now() - tStop > 15000) res()
      else setTimeout(chk, 50)
    }
    chk()
  })
  done = true
  return { rec, scrollMs: tStop - t0, shots }
}'''


def portal_shots(page, out, mode='fast'):
    """Satu run (pointer tengah) dengan capture di dalam halaman: frame saat kamera 0.5 di atas tiap cincin."""
    page.evaluate('__igloo.enableScroll(false)')
    page.evaluate(f'__igloo.setScroll({START_N})')
    page.evaluate('__igloo.setPointer(0, 0)')
    page.wait_for_timeout(1200)
    page.evaluate('__igloo.enableScroll(true)')
    cfg = dict(MODES[mode], stopP=0.5, maxMs=40000, capture=True)
    res = page.evaluate(RUN_JS, cfg)
    page.evaluate('__igloo.enableScroll(false)')
    tiles = []
    for sh in res['shots']:
        path = os.path.join(out, f"entry_portal_{mode}_ring{sh['ring'] + 1}.jpg")
        with open(path, 'wb') as f:
            f.write(base64.b64decode(sh['img'].split(',', 1)[1]))
        im = Image.open(path).convert('RGB').resize((480, 300))
        d = ImageDraw.Draw(im)
        d.rectangle([0, 278, 480, 300], fill=(0, 0, 0))
        d.text((6, 282), f"{mode}: cincin {sh['ring'] + 1}, kamera {sh['y']:+.2f} di atasnya, x {sh['x']:+.3f} "
                         f"z {sh['z']:+.3f}", fill=(255, 255, 255))
        tiles.append(im)
    if tiles:
        strip = Image.new('RGB', (480 * len(tiles), 300))
        for i, im in enumerate(tiles):
            strip.paste(im, (480 * i, 0))
        strip.save(os.path.join(out, f'entry_portal_{mode}.png'))
    return [sh['ring'] for sh in res['shots']]


def crossings(rec):
    """Interpolasi (x, z) kamera saat y memotong y cincin dari atas. Juga posisi jalur (base) di frame itu."""
    out = []
    for ry in RING_Y:
        hit = None
        for a, b in zip(rec, rec[1:]):
            if a[3] > ry >= b[3]:
                t = (a[3] - ry) / (a[3] - b[3])
                x = a[2] + (b[2] - a[2]) * t
                z = a[4] + (b[4] - a[4]) * t
                # jalur timeline (tanpa damping kamera) di frame yang sama: jarak lateral-nya sendiri
                bx = a[5] + (b[5] - a[5]) * t
                bz = a[7] + (b[7] - a[7]) * t
                p = a[1] + (b[1] - a[1]) * t
                hit = {'x': x, 'z': z, 'offset': math.hypot(x, z), 'path': math.hypot(bx, bz), 'p': p,
                       'path_y': a[6] + (b[6] - a[6]) * t}
                break
        out.append(hit)
    return out


def speed(rec):
    """Laju progress entry maksimum (per detik), dihaluskan 5 frame."""
    best = 0
    for a, b in zip(rec, rec[5:]):
        dt = (b[0] - a[0]) / 1000
        if dt > 0:
            best = max(best, (b[1] - a[1]) / dt)
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://localhost:5183/')
    ap.add_argument('--modes', default='slow,normal,fast,burst')
    ap.add_argument('--pointers', default='center,corner')
    ap.add_argument('--stop', type=float, default=0.5, help='lepas wheel saat progress entry mentah lewat angka ini')
    ap.add_argument('--limit', type=float, default=0.0, help='offset maksimum yang diterima (0 = tidak dicek)')
    ap.add_argument('--json', default='')
    ap.add_argument('--width', type=int, default=1280)
    ap.add_argument('--height', type=int, default=800)
    ap.add_argument('--shots', action='store_true', help='rangkai frame scroll cepat menjelang tiap cincin')
    args = ap.parse_args()
    errors = []
    results = []
    with sync_playwright() as p:
        # tanpa --disable-frame-rate-limit: ritme frame mendekati 60 Hz seperti browser sungguhan
        browser = p.chromium.launch(args=['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'])
        page = browser.new_page(viewport={'width': args.width, 'height': args.height})
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(args.url)
        page.wait_for_function('window.__igloo && document.getElementById("loader").classList.contains("hidden")',
                               timeout=90000)
        page.evaluate('__igloo.adaptive(false)')
        for mode in args.modes.split(','):
            for ptr in args.pointers.split(','):
                cfg = dict(MODES[mode], stopP=args.stop, maxMs=40000)
                page.evaluate('__igloo.enableScroll(false)')
                page.evaluate(f'__igloo.setScroll({START_N})')
                px, py = POINTERS[ptr]
                page.evaluate(f'__igloo.setPointer({px}, {py})')
                page.wait_for_timeout(1200)
                page.evaluate('__igloo.enableScroll(true)')
                res = page.evaluate(RUN_JS, cfg)
                rec = res['rec']
                hits = crossings(rec)
                fps = (len(rec) - 1) / max(1e-3, (rec[-1][0] - rec[0][0]) / 1000) if len(rec) > 1 else 0
                results.append({'mode': mode, 'pointer': ptr, 'hits': hits, 'speed': speed(rec), 'fps': fps,
                                'scrollMs': res['scrollMs']})
                cells = []
                for i, h in enumerate(hits):
                    cells.append(f'ring{i + 1} ' + (f"{h['offset']:.3f} (x {h['x']:+.3f} z {h['z']:+.3f}, jalur "
                                                     f"{h['path']:.3f}, p {h['p']:.3f})" if h else 'TIDAK LEWAT'))
                print(f"{mode:6s} {ptr:6s} laju maks {results[-1]['speed']:.2f} progress/s, {fps:.0f} fps")
                for c in cells:
                    print('   ', c)
        page.evaluate('__igloo.enableScroll(false)')
        if args.shots:
            out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
            for mode in ('slow', 'fast'):
                got = portal_shots(page, out, mode)
                print(f'frame {mode} menjelang cincin:', [g + 1 for g in got], f'-> tools/verify/out/entry_portal_{mode}.png')
        browser.close()

    print('\nringkas offset lateral (unit dunia, lubang cincin r 0.27):')
    print('mode    pointer  ring1   ring2   ring3   maks')
    worst = 0
    for r in results:
        offs = [h['offset'] if h else float('nan') for h in r['hits']]
        m = max(o for o in offs if o == o) if any(o == o for o in offs) else float('nan')
        worst = max(worst, m) if m == m else worst
        print(f"{r['mode']:7s} {r['pointer']:7s} " + '  '.join(f'{o:.3f}' for o in offs) + f'   {m:.3f}')
    if args.json:
        with open(args.json, 'w') as f:
            json.dump(results, f, indent=1)
    print('console error:', errors if errors else 'nol')
    bad = bool(errors) or (args.limit > 0 and worst > args.limit) or any(h is None for r in results for h in r['hits'])
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
