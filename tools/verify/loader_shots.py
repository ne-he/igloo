"""Screenshot loader dekripsi nama (src/engine/LoaderProgress.js) di beberapa momen, dengan muat diperlambat.

Pakai:  python tools/verify/loader_shots.py [--url http://localhost:5179/] [--gpu] [--kbps 12000] [--latency 40]
        [--cpu 1] [--only desktop,mobile,calm]
Butuh dev server jalan. PNG disimpan di tools/verify/out/loader/ (di-ignore git).

- Jaringan diperlambat lewat CDP (Network.emulateNetworkConditions) supaya fase muat cukup panjang untuk difoto.
  --cpu > 1 ikut memperlambat main thread (Emulation.setCPUThrottlingRate).
- Momen diambil dari state DOM loader, bukan jam: early (huruf pertama belum terkunci), mid (>= 8 terkunci),
  almost (>= 15), locked (17, belum pudar), fade (class hidden + 150 ms).
- Kasus: desktop 1024x768, mobile 375x812, calm = 375x812 dengan prefers-reduced-motion: reduce.
- Cek per kasus: persen tidak pernah turun, huruf terkunci selalu prefiks kiri ke kanan, tidak ada huruf yang terkunci
  mendahului progress, nama akhir = NEHEMIAH WILHELMUS, nama tidak terpotong viewport, intro jalan setelah loader
  hilang, error console nol.
"""
import argparse
import json
import os
import sys

from playwright.sync_api import sync_playwright, TimeoutError as PwTimeout

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out', 'loader')
NAME = 'NEHEMIAH WILHELMUS'
N = 17

# Sampler per frame: persen, jumlah huruf terkunci, pelanggaran urutan / mendahului progress.
SAMPLER_JS = """
(() => {
  window.__ls = { samples: [], order: 0, ahead: 0, drops: 0 }
  const f = (t) => {
    const name = document.getElementById('loader-name')
    const pctEl = document.getElementById('loader-pct')
    if (name && pctEl) {
      const on = [...name.querySelectorAll('.lg')].map((g) => g.parentElement.classList.contains('on'))
      const k = on.indexOf(false) === -1 ? on.length : on.indexOf(false)
      if (!on.every((v, i) => v === i < k)) window.__ls.order++
      const p = parseInt(pctEl.textContent, 10) || 0
      if (k > Math.floor(((p + 0.5) / 100) * %d + 1e-6)) window.__ls.ahead++
      const s = window.__ls.samples, last = s[s.length - 1]
      if (last && p < last[1]) window.__ls.drops++
      if (!last || last[1] !== p || last[2] !== k) s.push([Math.round(t), p, k])
    }
    const L = document.getElementById('loader')
    if (!L || !L.classList.contains('hidden')) requestAnimationFrame(f)
  }
  requestAnimationFrame(f)
})()
""" % N

LOCKED_JS = 'document.querySelectorAll("#loader-name .on").length'
HIDDEN_JS = 'document.getElementById("loader").classList.contains("hidden")'
STATE_JS = """(() => {
  const r = document.getElementById('loader-name').getBoundingClientRect()
  const text = [...document.querySelectorAll('#loader-name .ls')].map((s) => s.querySelector('.lg')?.textContent ?? ' ').join('')
  return { text, left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: innerWidth, vh: innerHeight,
    pct: document.getElementById('loader-pct').textContent, locked: %s, hidden: %s,
    opacity: +getComputedStyle(document.getElementById('loader')).opacity,
    font: getComputedStyle(document.querySelector('#loader-name .lg')).fontFamily,
    plex: document.fonts.check('500 20px IglooPlexMono') }
})()""" % (LOCKED_JS, HIDDEN_JS)

MOMENTS = [
    ('early', f'parseInt(document.getElementById("loader-pct").textContent, 10) >= 1 || {LOCKED_JS} >= 1'),
    ('mid', f'{LOCKED_JS} >= 8'),
    ('almost', f'{LOCKED_JS} >= 15'),
    ('locked', f'{LOCKED_JS} === {N} || {HIDDEN_JS}'),
    ('fade', HIDDEN_JS),
]

CASES = {
    'desktop': (1024, 768, False),
    'mobile': (375, 812, False),
    'calm': (375, 812, True),
}


def run_case(browser, args, tag, w, h, calm):
    ctx = browser.new_context(viewport={'width': w, 'height': h}, reduced_motion='reduce' if calm else 'no-preference')
    page = ctx.new_page()
    errors = []
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(str(e)))
    cdp = ctx.new_cdp_session(page)
    cdp.send('Network.enable')
    cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})
    bps = args.kbps * 1024 / 8
    cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency': args.latency,
                                                   'downloadThroughput': bps, 'uploadThroughput': bps})
    if args.cpu > 1:
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': args.cpu})
    page.add_init_script(SAMPLER_JS)
    page.goto(args.url, wait_until='commit')
    ok = True
    states = {}
    for moment, cond in MOMENTS:
        try:
            page.wait_for_function(cond, timeout=180000)
        except PwTimeout:
            print(f'[{tag}] {moment}: tidak tercapai dalam 180 s')
            ok = False
            continue
        if moment == 'fade':
            page.wait_for_timeout(150)
        path = os.path.join(OUT, f'{tag}_{w}x{h}_{moment}.png')
        st = page.evaluate(STATE_JS)
        page.screenshot(path=path)
        states[moment] = st
        print(f'[{tag}] {moment:7s} pct {st["pct"]} terkunci {st["locked"]:2d} hidden {st["hidden"]!s:5s} '
              f'opacity {st["opacity"]:.2f} teks "{st["text"]}"  {os.path.relpath(path)}')

    # site jalan normal setelah loader: __igloo ada dan intro diputar
    page.wait_for_function(f'window.__igloo && {HIDDEN_JS}', timeout=60000)
    page.wait_for_timeout(600)
    intro = page.evaluate('({ running: __igloo.intro.running, time: __igloo.intro.time })')
    ls = page.evaluate('window.__ls')
    ctx.close()

    fin = states.get('locked') or states.get('fade') or {}
    checks = [
        ('nama akhir benar', fin.get('text') == NAME, fin.get('text')),
        ('nama di dalam viewport', fin and fin['left'] >= 0 and fin['right'] <= fin['vw'] and fin['top'] >= 0
         and fin['bottom'] <= fin['vh'], f'x {fin.get("left", 0):.0f}..{fin.get("right", 0):.0f} dari {fin.get("vw")}'),
        ('nama di tengah horizontal', fin and abs((fin['left'] + fin['right']) / 2 - fin['vw'] / 2) < 3,
         f'tengah {(fin.get("left", 0) + fin.get("right", 0)) / 2:.1f} vs {fin.get("vw", 0) / 2}'),
        ('persen tidak pernah turun', ls['drops'] == 0, ls['drops']),
        ('urutan kunci kiri ke kanan', ls['order'] == 0, ls['order']),
        ('tidak mendahului progress', ls['ahead'] == 0, ls['ahead']),
        ('intro diputar setelah loader', intro['time'] > 0.2, intro),
        ('font Plex Mono dipakai', bool(fin.get('plex')), fin.get('font')),
        ('error console nol', not errors, errors[:3]),
    ]
    for label, good, info in checks:
        ok &= bool(good)
        print(f'[{tag}] {"OK   " if good else "GAGAL"} {label}: {info}')
    # ringkas kurva: (ms, persen, terkunci) tiap perubahan, dijarangkan
    s = ls['samples']
    step = max(1, len(s) // 14)
    print(f'[{tag}] kurva', json.dumps(s[::step] + [s[-1]] if s else []))
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://localhost:5179/')
    ap.add_argument('--gpu', action='store_true', help='pakai GPU asli (D3D11), jauh lebih cepat dari SwiftShader')
    ap.add_argument('--kbps', type=int, default=12000, help='throughput unduh, kilobit/s')
    ap.add_argument('--latency', type=int, default=40, help='latensi per request, ms')
    ap.add_argument('--cpu', type=float, default=1, help='perlambat CPU N kali')
    ap.add_argument('--only', default='desktop,mobile,calm')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    ok = True
    with sync_playwright() as p:
        if args.gpu:
            flags = ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu']
        else:
            flags = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
        browser = p.chromium.launch(args=flags)
        for tag in args.only.split(','):
            w, h, calm = CASES[tag]
            ok &= run_case(browser, args, tag, w, h, calm)
        browser.close()
    print('HASIL:', 'OK' if ok else 'GAGAL')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
