"""Verifikasi M5b: mouse frost, label, plexus, FPS (GPU asli, waktu nyata, tanpa freeze).

Pakai:  python tools/verify/crystals_frost.py [--url http://localhost:5192] [--n 3.35]
Langkah:
  1. setScroll(n), tunggu label selesai reveal, jepret 'before'.
  2. Sapu mouse (page.mouse, event pointer asli) melintasi kristal, jepret 'during' di tengah sapuan.
  3. Diam 1.5 s, jepret 'after'.
  4. Resize viewport 1100x700 lalu balik, jepret 'resize' (frost harus tetap ada, sim tidak ikut resize).
  5. FPS rata-rata di 1280x800 selama sapuan 4 s.
  6. Side-by-side before/during/after vs ref 07 dan 11 -> tools/verify/out/m5b_side.png
Juga mengukur energi frost (jumlah piksel r > 0.05 di RT sim) supaya tidak cuma mengandalkan mata.
"""
import argparse
import json
import os

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'out')
REF = os.path.join(ROOT, '_ref_screenshots')
GPU = ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu']

# hitung texel frost aktif di RT sim kristal tengah (baca balik HalfFloat)
FROST_JS = '''async (idx) => {
  const { DataUtils } = await import('/node_modules/.vite/deps/three.js')
  const e = __igloo.engine, s = e.scenes[1], c = s.crystals[idx], r = e.renderer
  const rt = c.frost.read, n = rt.width
  const buf = new Uint16Array(n * n * 4)
  r.readRenderTargetPixels(rt, 0, 0, n, n, buf)
  let on = 0, rim = 0, max = 0
  for (let i = 0; i < n * n; i++) {
    const v = DataUtils.fromHalfFloat(buf[i * 4]); const g = DataUtils.fromHalfFloat(buf[i * 4 + 1])
    if (v > 0.05) on++
    if (g > 0.01) rim++
    if (v > max) max = v
  }
  return { size: n, on, rim, max: +max.toFixed(3), steps: c.frost.steps, sleeping: c.frost.sleeping, tex: c.material.frost.tMouseFrost.value === rt.texture }
}'''


# Agent lain mengedit file di dev server yang sama: HMR Vite bisa me-reload halaman di tengah tes.
# Klien HMR diganti stub tanpa websocket, jadi halaman yang sedang dites tidak pernah di-reload.
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


def no_hmr(page):
    page.route('**/@vite/client', lambda route: route.fulfill(status=200, content_type='application/javascript', body=VITE_CLIENT_STUB))


def ready(page):
    page.wait_for_function('window.__igloo && document.getElementById("loader").classList.contains("hidden")', timeout=60000)


def sweep(page, x0, x1, y0, y1, steps, ms):
    # gerakan dipecah per 4 langkah supaya total waktu dekat steps * ms (move satu-satu terlalu lambat)
    page.mouse.move(x0, y0)
    chunk = 4
    for i in range(chunk, steps + 1, chunk):
        t = i / steps
        page.mouse.move(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, steps=chunk)
        page.wait_for_timeout(ms * chunk)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://localhost:5192/')
    ap.add_argument('--n', type=float, default=3.35)
    ap.add_argument('--idx', type=int, default=1, help='indeks kristal di tengah untuk n tersebut')
    ap.add_argument('--js', default='', help='JS tuning dijalankan sebelum sapuan')
    ap.add_argument('--tag', default='frost')
    ap.add_argument('--no-fps', action='store_true')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    errors = []
    shots = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(args=GPU)
        page = browser.new_page(viewport={'width': 1024, 'height': 768})
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        no_hmr(page)
        page.goto(args.url)
        ready(page)
        page.evaluate('__igloo.enableScroll(false); __igloo.adaptive(false)')
        page.evaluate(f'__igloo.setScroll({args.n})')
        if args.js:
            page.evaluate(args.js)
        page.mouse.move(60, 400)
        page.wait_for_timeout(1500)

        def shot(name):
            # ukur dulu (langsung sesudah gerakan), baru jepret
            st = page.evaluate(FROST_JS, args.idx)
            path = os.path.join(OUT, f'crystals_{args.tag}_{name}.png')
            page.screenshot(path=path)
            shots[name] = path
            print(f'{name:8s} frost={json.dumps(st)}  {os.path.relpath(path, ROOT)}')
            return st

        before = shot('before')
        # sapuan diagonal melintasi kristal, kecepatan sedang (sekitar 600 px/s)
        sweep(page, 330, 700, 300, 470, 30, 16)
        sweep(page, 700, 380, 470, 380, 24, 16)
        during = shot('during')
        page.wait_for_timeout(1500)
        after = shot('after')
        # resize di tengah sapuan kedua: frost yang baru dilukis harus tetap ada sesudah resize
        sweep(page, 330, 700, 300, 470, 30, 16)
        pre = page.evaluate(FROST_JS, args.idx)
        page.set_viewport_size({'width': 1100, 'height': 700})
        page.wait_for_timeout(60)
        page.set_viewport_size({'width': 1024, 'height': 768})
        page.wait_for_timeout(60)
        resized = shot('resize')
        print('sebelum resize', json.dumps(pre))
        if args.no_fps:
            browser.close()
            print('console errors:', errors if errors else 'nol')
            return

        # FPS di 1280x800 sambil menyapu (sim frost + raycast aktif)
        page.set_viewport_size({'width': 1280, 'height': 800})
        page.wait_for_timeout(1500)
        fps = []
        for k in range(4):
            sweep(page, 420, 860, 330, 520, 30, 16)
            sweep(page, 860, 420, 520, 330, 30, 16)
            fps.append(page.evaluate('__igloo.state().fps'))
        st = page.evaluate('__igloo.state()')
        info = page.evaluate('__igloo.info()')
        print('fps 1280x800 (sampel tiap ~1 s):', [round(f, 1) for f in fps], 'dpr', st['dpr'])
        print('renderer.info', json.dumps(info))
        browser.close()

    # frost terus melebar sesudah sapuan (dilasi) sambil meluruh, jadi yang dicek nilai puncaknya.
    # resize: sim tidak di-reset, nilai sesudah resize masih sekelas sebelum resize (tinggal luruh beberapa langkah)
    ok = (before['max'] == 0 and during['max'] > 0.3 and during['rim'] > 0 and after['max'] < during['max']
          and resized['max'] > 0.5 * pre['max'] and resized['steps'] > pre['steps'])
    print('frost tumbuh saat sapuan, meluruh sesudahnya, selamat resize:', 'OK' if ok else 'GAGAL')

    # side-by-side: baris 1 = before/during/after kita, baris 2 = ref 07, ref 11, frost resize
    W, H = 512, 384
    tiles = [shots['before'], shots['during'], shots['after'],
             os.path.join(REF, '07_cube01_label_hud.jpg'), os.path.join(REF, '11_cube03_slab.jpg'), shots['resize']]
    labels = ['kita: before', 'kita: during sweep', 'kita: +1.5 s', 'ref 07', 'ref 11', 'kita: tepat sesudah resize']
    side = Image.new('RGB', (W * 3, H * 2), 'black')
    d = ImageDraw.Draw(side)
    for i, (path, lab) in enumerate(zip(tiles, labels)):
        im = Image.open(path).convert('RGB').resize((W, H), Image.LANCZOS)
        x, y = (i % 3) * W, (i // 3) * H
        side.paste(im, (x, y))
        d.rectangle([x, y, x + 150, y + 18], fill='black')
        d.text((x + 4, y + 3), lab, fill='white')
    path = os.path.join(OUT, 'm5b_side.png')
    side.save(path)
    print('side-by-side ->', os.path.relpath(path, ROOT))
    print('console errors:', errors if errors else 'nol')


if __name__ == '__main__':
    main()
