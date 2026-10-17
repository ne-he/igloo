"""Bukti audio M8 dengan angka (bunyinya tidak bisa didengar di headless).

Pakai:  python tools/verify/audio_gains.py [--url http://localhost:5197] [--gpu]
Output: tools/verify/out/audio_gains.json + audio_gains.png (grafik gain vs waktu), ringkasan cek di stdout.

Alur yang direkam (semua lewat jalur pengguna sungguhan kecuali sapuan scroll yang memakai __igloo.setScroll):
  1. sebelum gesture: AudioContext belum ada, master 0
  2. klik pertama di area kosong: unlock, buffer di-decode, Sound tetap Off -> master tetap 0
  3. klik tombol "Sound: Off" di kanvas: Sound On -> master naik ke 1 (tau 0.35 s)
  4. sapuan igloo n 0..2.35: gain angin mengikuti 0.4 * fit(p,.05,.2,0,1) * fit(p,.75,.95,1,0)
  5. mouse di atas igloo saat istirahat: plexus aktif -> gain room naik, mouse pergi -> turun
  6. sapuan entry n 5.4..8.5: gain portals memuncak di progress 0.28 / 0.375 / 0.465
  7. ruang partikel: mouse bergerak di tengah -> EntryScene memancarkan audio_param particles -> gain particles
  8. beeps: 10 panggilan beruntun tiap 0.1 s -> yang lolos berjarak >= 0.4 s
  9. tab tersembunyi (visibilitychange disimulasikan): master -> 0, terlihat lagi -> 1
 10. klik Sound lagi: Off -> master 0
"""
import argparse
import json
import math
import os
import sys
import time

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
IGLOO_H, CRYSTAL_H, ENTRY_H = 2.35, 3.0, 5.5
ENTRY_START = IGLOO_H + CRYSTAL_H


def fit(v, a, b, c, d):
    t = min(1, max(0, (v - a) / (b - a)))
    return c + (d - c) * t


def wind_expected(p):
    return 0.4 * fit(p, 0.05, 0.2, 0, 1) * fit(p, 0.75, 0.95, 1, 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://localhost:5197')
    ap.add_argument('--gpu', action='store_true')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    log = []  # sampel {t, phase, n, ...state}
    marks = []
    errors = []
    checks = []

    def check(name, ok, detail):
        checks.append((name, bool(ok), detail))
        print(f'[{"OK" if ok else "GAGAL"}] {name}: {detail}')

    with sync_playwright() as p:
        flags = ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu'] if args.gpu else \
            ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
        browser = p.chromium.launch(args=flags)
        page = browser.new_page(viewport={'width': 1024, 'height': 768})
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(args.url.rstrip('/') + '/?nointro')
        page.wait_for_function('window.__igloo && document.getElementById("loader").classList.contains("hidden")', timeout=90000)
        page.evaluate('__igloo.enableScroll(false); __igloo.adaptive(false); __igloo.setScroll(0.658)')
        t0 = time.time()

        def sample(phase, n=None):
            # satu evaluate: state audio dan progress scene dari frame yang sama (dua evaluate terpisah
            # bisa diselingi satu frame, target angin lalu tidak cocok dengan progress yang dibaca)
            st, sc = page.evaluate('(() => { const e = __igloo.engine; return [__igloo.audio.state(), '
                                   'Object.fromEntries(e.scenes.map((s) => [s.key, { p: s.progress, active: s.active }]))] })()')
            row = {'t': time.time() - t0, 'phase': phase, 'n': n, 'scenes': sc, **st}
            log.append(row)
            return row

        def mark(label):
            marks.append((time.time() - t0, label))

        # 1. sebelum gesture
        page.wait_for_timeout(2000)  # beri waktu prefetch (1.5 s setelah loader)
        s = sample('awal')
        check('mulai terkunci', not s['unlocked'] and s['ctxState'] is None and s['master'] == 0,
              f"unlocked={s['unlocked']} ctx={s['ctxState']} master={s['master']}")

        # 2. klik pertama di area kosong (kanan bawah, bukan tombol)
        mark('klik pertama')
        page.mouse.click(900, 700)
        for _ in range(40):
            page.wait_for_timeout(100)
            s = sample('unlock')
            if len(s['buffers']) >= 15:
                break
        check('gesture pertama membuka AudioContext', s['unlocked'] and s['ctxState'] == 'running',
              f"ctx={s['ctxState']} buffer={len(s['buffers'])}")
        check('Sound tetap Off setelah unlock', not s['enabled'] and s['master'] < 1e-3, f"enabled={s['enabled']} master={s['master']:.4f}")
        loops = {k: v for k, v in s['buffers'].items() if k in ('music', 'wind', 'room', 'circles', 'particles')}
        check('loop ter-decode dengan panjang sama (music/wind/room)',
              len({round(loops[k]['duration'], 4) for k in ('music', 'wind', 'room') if k in loops}) == 1,
              {k: round(v['duration'], 4) for k, v in loops.items()})

        # 3. klik tombol Sound di kanvas (posisi dari layout UI)
        r = page.evaluate('__igloo.engine.ui.soundRect')
        cx, cy = (r['x0'] + r['x1']) / 2, (r['y0'] + r['y1']) / 2
        label_before = page.evaluate('__igloo.engine.ui.texts.sound.text')
        mark('klik Sound On')
        page.mouse.move(cx, cy)
        page.mouse.click(cx, cy)
        for _ in range(20):
            page.wait_for_timeout(100)
            s = sample('sound on')
        label_after = page.evaluate('__igloo.engine.ui.texts.sound.text')
        check('klik tombol menyalakan bunyi', s['enabled'] and s['master'] > 0.9,
              f"master={s['master']:.3f} teks '{label_before}' -> '{label_after}'")
        page.mouse.move(600, 300)

        # 4. sapuan igloo
        mark('sapuan igloo')
        wind_pairs = []
        for i in range(48):
            n = 0.02 + i * (IGLOO_H - 0.06) / 47
            page.evaluate(f'__igloo.setScroll({n})')
            page.wait_for_timeout(110)
            s = sample('igloo', n)
            ip = s['scenes']['igloo']['p']
            wind_pairs.append((ip, s['targets']['wind'], s['gains']['wind']))
        err = max(abs(t - wind_expected(p_)) for p_, t, _ in wind_pairs)
        check('target angin = rumus forensik', err < 1e-6, f'selisih maks {err:.2e} di {len(wind_pairs)} titik')
        peak = max(g for _, _, g in wind_pairs)
        edges = [g for p_, _, g in wind_pairs if p_ < 0.04]
        check('gain angin naik di tengah, nol di tepi', peak > 0.3 and max(edges or [0]) < 0.02,
              f'puncak {peak:.3f}, di p<0.04 maks {max(edges or [0]):.4f}')

        # 5. plexus igloo
        page.evaluate('__igloo.setScroll(0.658)')
        page.wait_for_timeout(600)
        base = sample('plexus', 0.658)['gains']['room']
        mark('mouse di igloo')
        for k in range(30):
            page.mouse.move(470 + 60 * math.sin(k / 3), 330 + 30 * math.cos(k / 4))
            page.wait_for_timeout(80)
            s = sample('plexus', 0.658)
        room_hi = max(r_['gains']['room'] for r_ in log if r_['phase'] == 'plexus')
        mark('mouse pergi')
        page.mouse.move(1000, 760)
        for _ in range(25):
            page.wait_for_timeout(100)
            s = sample('plexus pergi', 0.658)
        check('room naik saat plexus aktif lalu turun', room_hi > base + 0.1 and s['gains']['room'] < room_hi - 0.1,
              f'awal {base:.3f}, puncak {room_hi:.3f}, akhir {s["gains"]["room"]:.3f}')

        # 6. sapuan entry (cincin portal)
        mark('sapuan entry')
        portal = []
        for i in range(160):
            n = ENTRY_START + 0.05 + i * 0.02
            page.evaluate(f'__igloo.setScroll({n})')
            page.wait_for_timeout(70)
            s = sample('entry', n)
            portal.append((s['scenes']['entry']['p'], s['targets']['portals'], s['gains']['portals']))
        # puncak lokal target
        tp = [t for _, t, _ in portal]
        peaks = [round(portal[i][0], 3) for i in range(1, len(portal) - 1) if tp[i] >= tp[i - 1] and tp[i] > tp[i + 1] and tp[i] > 0.5]
        check('puncak portals di progress 0.28/0.375/0.465', len(peaks) == 3 and all(abs(a - b) < 0.006 for a, b in zip(peaks, (0.28, 0.375, 0.465))),
              f'puncak target {peaks}, gain maks {max(g for *_, g in portal):.3f}')

        # 7. ruang partikel
        page.evaluate(f'__igloo.setScroll({ENTRY_START + 0.76 * ENTRY_H})')
        page.wait_for_timeout(800)
        mark('mouse di partikel')
        for k in range(40):
            page.mouse.move(512 + 90 * math.sin(k / 2.5), 384 + 70 * math.cos(k / 3.1))
            page.wait_for_timeout(60)
            s = sample('partikel', ENTRY_START + 0.76 * ENTRY_H)
        part_hi = max(r_['gains']['particles'] for r_ in log if r_['phase'] == 'partikel')
        par_hi = max(r_['params'].get('particles', 0) for r_ in log if r_['phase'] == 'partikel')
        check('audio_param particles dari EntryScene menggerakkan gain', par_hi > 0 and part_hi > 0.01,
              f'param maks {par_hi:.3f}, gain maks {part_hi:.3f}')
        page.mouse.move(1000, 760)

        # 8. jeda beeps
        mark('beeps x10')
        page.evaluate('__igloo.setScroll(0.658)')
        played = []
        last = None
        for k in range(10):
            page.evaluate("__igloo.audio.play('beeps')")
            s = sample('beeps')
            if s['lastBeep'] != last:
                played.append(s['lastBeep'])
                last = s['lastBeep']
            page.wait_for_timeout(100)
        gaps = [round(b - a, 3) for a, b in zip(played, played[1:])]
        check('beeps berjarak >= 0.4 s', all(g >= 0.4 - 1e-6 for g in gaps) and len(played) >= 2,
              f'{len(played)} dari 10 terputar, jarak {gaps}')

        # 9. tab tersembunyi
        mark('tab hidden')
        page.evaluate("Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange'))")
        for _ in range(15):
            page.wait_for_timeout(100)
            s = sample('hidden')
        hid = s['master']
        mark('tab terlihat')
        page.evaluate("Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'))")
        for _ in range(15):
            page.wait_for_timeout(100)
            s = sample('visible')
        check('tab tersembunyi = master 0, kembali 1', hid < 0.05 and s['master'] > 0.9, f'hidden {hid:.3f}, visible {s["master"]:.3f}')

        # 10. Sound Off
        mark('klik Sound Off')
        page.mouse.click(cx, cy)
        for _ in range(15):
            page.wait_for_timeout(100)
            s = sample('sound off')
        check('klik lagi mematikan bunyi', not s['enabled'] and s['master'] < 0.05,
              f"master={s['master']:.3f} teks '{page.evaluate('__igloo.engine.ui.texts.sound.text')}'")
        browser.close()

    check('nol error console', not errors, errors[:3] if errors else 'nol')
    with open(os.path.join(OUT, 'audio_gains.json'), 'w', encoding='utf-8') as f:
        json.dump({'marks': marks, 'checks': checks, 'log': log}, f, indent=1)
    plot(log, marks)
    print(f'{sum(ok for _, ok, _ in checks)}/{len(checks)} cek lolos. Data: {os.path.relpath(os.path.join(OUT, "audio_gains.json"))}')
    sys.exit(0 if all(ok for _, ok, _ in checks) else 1)


def plot(log, marks):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    t = [r['t'] for r in log]
    fig, ax = plt.subplots(2, 1, figsize=(14, 7), sharex=True, constrained_layout=True)
    ax[0].plot(t, [r['master'] for r in log], label='master', color='black', lw=1.5)
    for name, c in (('music', '#888'), ('wind', '#2a7'), ('room', '#c60'), ('portals', '#36c'), ('particles', '#c3c')):
        ax[1].plot(t, [r['gains'].get(name, 0) for r in log], label=f'{name} gain', color=c, lw=1.2)
        ax[1].plot(t, [r['targets'].get(name, 0) for r in log], color=c, lw=0.6, ls='--')
    for a in ax:
        for mt, label in marks:
            a.axvline(mt, color='#bbb', lw=0.6)
        a.legend(loc='upper right', fontsize=8)
    for mt, label in marks:
        ax[0].text(mt, 1.05, label, rotation=30, fontsize=7, va='bottom')
    ax[0].set_ylim(-0.05, 1.4)
    ax[0].set_ylabel('master')
    ax[1].set_ylabel('gain loop (garis putus = target)')
    ax[1].set_xlabel('detik')
    fig.savefig(os.path.join(OUT, 'audio_gains.png'), dpi=90)
    plt.close(fig)


if __name__ == '__main__':
    main()
