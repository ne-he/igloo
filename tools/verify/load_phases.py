"""Pecah muatan dingin (cold load) jadi fase dengan angka nyata: HTML, cat pertama loader, unduh + parse JS,
unduh aset, build scene, precompile per scene (compile shader, upload tekstur), sampai loader hilang.

Pakai:  npx vite build --outDir <tmp>/dist --emptyOutDir ; npx vite preview --outDir <tmp>/dist --port 5183 --strictPort
        python tools/verify/load_phases.py [nama=]url [[nama=]url ...] [--runs 3] [--net none,fast4g]
                                           [--cpu 1] [--json hasil.json] [--mobile]

- Tiap run = konteks browser baru (cache kosong). Beberapa url dijalankan BERSELANG (a, b, a, b, ...) supaya
  derau mesin (agent lain yang juga menjalankan Playwright) terbagi rata ke semua kandidat.
- --net: none (tanpa throttle), fast4g (9 Mbps turun, 1.5 Mbps naik, 60 ms), slow4g (1.6 Mbps, 0.75 Mbps, 150 ms).
  Throttle lewat CDP Network.emulateNetworkConditions. Catatan: vite preview tidak mengompresi JS, Vercel
  memakai brotli, jadi di jaringan lambat fase JS di sini lebih lama daripada di situs live.
- --cpu N: perlambat CPU N kali (CDP Emulation.setCPUThrottlingRate), meniru laptop kantor / ponsel.
- Sumber angka: Navigation Timing + Paint Timing + Resource Timing + performance.mark dari kode
  (boot:start, init:start, build:<key>:end, init:built, upload:<key>:start|compiled|textures|end, init:end,
  boot:init, loader:finish, loader:hidden) + PerformanceObserver longtask.
- Keluaran: tabel median per kandidat (ms sejak navigasi dimulai) dan durasi tiap fase.
"""
import argparse
import json
import os
import re
import statistics
import sys

from playwright.sync_api import sync_playwright

GPU = ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu']
# kbps turun, kbps naik, latency ms
NET = {'none': None, 'fast4g': (9000, 1500, 60), 'slow4g': (1600, 750, 150)}

LONGTASK_JS = """
(() => {
  window.__longtasks = []
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longtasks.push([e.startTime, e.duration])
    }).observe({ type: 'longtask', buffered: true })
  } catch (e) {}
})()
"""

COLLECT_JS = """
() => {
  const nav = performance.getEntriesByType('navigation')[0]
  const paint = Object.fromEntries(performance.getEntriesByType('paint').map((e) => [e.name, e.startTime]))
  const marks = {}
  for (const m of performance.getEntriesByType('mark')) if (!(m.name in marks)) marks[m.name] = m.startTime
  const res = performance.getEntriesByType('resource').map((r) => ({
    url: r.name, start: r.startTime, end: r.responseEnd, transfer: r.transferSize, size: r.encodedBodySize,
    type: r.initiatorType,
  }))
  return { nav: { ttfb: nav.responseStart, htmlEnd: nav.responseEnd, dcl: nav.domContentLoadedEventEnd },
    paint, marks, res, longtasks: window.__longtasks || [] }
}
"""


def one_run(p, url, net, cpu, mobile):
    b = p.chromium.launch(args=GPU)
    try:
        if mobile:
            ctx = b.new_context(**p.devices['iPhone 13'])
        else:
            ctx = b.new_context(viewport={'width': 1440, 'height': 900})
        ctx.add_init_script(LONGTASK_JS)
        pg = ctx.new_page()
        errs = []
        pg.on('console', lambda m: errs.append(m.text[:160]) if m.type == 'error' else None)
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)[:160]))
        cdp = ctx.new_cdp_session(pg)
        cdp.send('Network.enable')
        cdp.send('Network.setCacheDisabled', {'cacheDisabled': False})
        if NET[net]:
            down, up, lat = NET[net]
            cdp.send('Network.emulateNetworkConditions', {
                'offline': False, 'latency': lat,
                'downloadThroughput': down * 1000 / 8, 'uploadThroughput': up * 1000 / 8,
            })
        if cpu > 1:
            cdp.send('Emulation.setCPUThrottlingRate', {'rate': cpu})
        pg.goto(url, wait_until='commit')
        pg.wait_for_function('document.getElementById("loader").classList.contains("hidden")', timeout=240000)
        pg.wait_for_timeout(300)
        d = pg.evaluate(COLLECT_JS)
        d['errors'] = errs
        return d
    finally:
        b.close()


def phases(d):
    """Ubah data mentah satu run jadi kamus fase (ms)."""
    m = d['marks']
    res = d['res']
    js = [r for r in res if re.search(r'/assets/[^/]+\.js(\?|$)', r['url'])]
    assets = [r for r in res if re.search(r'/(assets|draco)/', r['url']) and r not in js]
    built = m.get('init:built')
    # aset muatan awal = yang selesai sebelum semua scene terbangun (audio diunduh sesudah loader)
    initial = [r for r in assets if built is None or r['end'] <= built + 1]
    out = {
        'html_ttfb': d['nav']['ttfb'],
        'loader_paint': d['paint'].get('first-contentful-paint'),
        'js_downloaded': max((r['end'] for r in js), default=None),
        'js_ready': m.get('boot:start'),
        'asset_first_req': min((r['start'] for r in initial), default=None),
        'asset_last_done': max((r['end'] for r in initial), default=None),
        'built': built,
        'init_end': m.get('init:end'),
        'loader_finish': m.get('loader:finish'),
        'loader_hidden': m.get('loader:hidden'),
        'n_requests': len(res) + 1,
        'kb_initial': sum(r['transfer'] for r in initial) / 1024 + sum(r['transfer'] for r in js) / 1024,
        'kb_js': sum(r['transfer'] for r in js) / 1024,
    }
    for key in ('igloo', 'crystals', 'entry', 'detail', 'ui'):
        s, c, t, e = (m.get(f'upload:{key}:{k}') for k in ('start', 'compiled', 'textures', 'end'))
        if s is None or e is None:
            continue
        out[f'up_{key}'] = e - s
        if c is not None:
            out[f'up_{key}_compile'] = c - s
        if c is not None and t is not None:
            out[f'up_{key}_textures'] = t - c
        b = m.get(f'build:{key}:end')
        if b is not None:
            out[f'build_{key}_done'] = b
    if built is not None and out['init_end'] is not None:
        out['precompile_total'] = out['init_end'] - built
    if out['loader_finish'] is not None and out['loader_hidden'] is not None:
        out['loader_tail'] = out['loader_hidden'] - out['loader_finish']
    if out['js_ready'] is not None and built is not None:
        # main thread macet (longtask) selama aset dimuat: decode Draco / PMREM / presim, bukan jaringan
        lt = [dur for st, dur in d['longtasks'] if out['js_ready'] <= st <= built]
        out['longtask_during_assets'] = sum(lt)
    out['errors'] = len(d['errors'])
    return out


ROWS = [
    ('html_ttfb', 'HTML byte pertama'),
    ('loader_paint', 'loader tampil (FCP)'),
    ('js_downloaded', 'JS selesai diunduh'),
    ('js_ready', 'JS di-parse + jalan (boot:start)'),
    ('asset_first_req', 'request aset pertama'),
    ('asset_last_done', 'aset terakhir selesai'),
    ('built', 'semua scene terbangun (init:built)'),
    ('up_igloo', '  precompile igloo'),
    ('up_igloo_compile', '    compile shader'),
    ('up_igloo_textures', '    upload tekstur'),
    ('up_crystals', '  precompile crystals'),
    ('up_crystals_compile', '    compile shader'),
    ('up_crystals_textures', '    upload tekstur'),
    ('up_entry', '  precompile entry (+ presim)'),
    ('up_entry_compile', '    compile shader'),
    ('up_entry_textures', '    upload tekstur'),
    ('up_detail', '  precompile detail'),
    ('up_ui', '  precompile ui'),
    ('precompile_total', 'precompile total (built -> init:end)'),
    ('init_end', 'init selesai (init:end)'),
    ('loader_finish', 'loader.finish()'),
    ('loader_tail', '  ekor animasi loader'),
    ('loader_hidden', 'LOADER HILANG'),
    ('longtask_during_assets', 'longtask selama fase aset'),
    ('n_requests', 'jumlah request'),
    ('kb_initial', 'kB transfer muatan awal'),
    ('kb_js', 'kB transfer JS'),
    ('errors', 'console error'),
]


def med(vals):
    vals = [v for v in vals if v is not None]
    return statistics.median(vals) if vals else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('urls', nargs='*', default=['http://localhost:5183/'])
    ap.add_argument('--runs', type=int, default=3)
    ap.add_argument('--net', default='none,fast4g')
    ap.add_argument('--cpu', type=float, default=1)
    ap.add_argument('--mobile', action='store_true')
    ap.add_argument('--json')
    args = ap.parse_args()
    cands = []
    for i, u in enumerate(args.urls):
        name, _, url = u.partition('=') if re.match(r'^[\w-]+=http', u) else (f'url{i + 1}', '', u)
        cands.append((name, url))
    nets = [n.strip() for n in args.net.split(',') if n.strip()]
    for n in nets:
        if n not in NET:
            sys.exit(f'--net tidak dikenal: {n} (pilihan: {", ".join(NET)})')

    results = {}  # (net, nama) -> [fase per run]
    with sync_playwright() as p:
        for net in nets:
            for run in range(args.runs):
                for name, url in cands:
                    ph = phases(one_run(p, url, net, args.cpu, args.mobile))
                    results.setdefault((net, name), []).append(ph)
                    print(f'[{net}] {name} run {run + 1}: loader hilang {ph["loader_hidden"]:.0f} ms, '
                          f'built {ph["built"]:.0f}, init {ph["init_end"]:.0f}, error {ph["errors"]}', flush=True)

    summary = {}
    for net in nets:
        names = [n for n, _ in cands]
        print(f'\n=== jaringan: {net}, cpu x{args.cpu:g}, {args.runs} run, median (ms) ===')
        print(f'{"fase":40s}' + ''.join(f'{n:>12s}' for n in names) + (f'{"selisih":>10s}' if len(names) == 2 else ''))
        for key, label in ROWS:
            vals = [med([r.get(key) for r in results[(net, n)]]) for n in names]
            if all(v is None for v in vals):
                continue
            line = f'{label:40s}' + ''.join(f'{v:12.0f}' if v is not None else f'{"-":>12s}' for v in vals)
            if len(names) == 2 and None not in vals:
                line += f'{vals[1] - vals[0]:+10.0f}'
            print(line)
            for n, v in zip(names, vals):
                summary.setdefault(net, {}).setdefault(n, {})[key] = v
        for n in names:
            hid = [r['loader_hidden'] for r in results[(net, n)]]
            print(f'  {n}: loader hilang per run = {", ".join(f"{h:.0f}" for h in hid)} (rentang {max(hid) - min(hid):.0f} ms)')
    if args.json:
        with open(args.json, 'w', encoding='utf-8') as f:
            json.dump({'summary': summary, 'runs': {f'{k[0]}|{k[1]}': v for k, v in results.items()}}, f, indent=1)
        print('json:', os.path.abspath(args.json))


if __name__ == '__main__':
    main()
