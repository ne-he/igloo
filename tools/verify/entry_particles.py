"""Verifikasi partikel volume + carousel link ruang entry (M7b), GPU asli (Chromium headless, ANGLE D3D11).

Pakai:  python tools/verify/entry_particles.py [--url http://localhost:5183/] [--n 9.5] [--q 0] [--no-sheet]
Butuh dev server jalan. Alur:
  1. catat GPU, kualitas partikel, statistik pre-sim (compile + langkah)
  2. FPS di ruang 1280x800 (mouse diam), adaptive DPR mati
  3. tiap link (semua isi src/content/links.js, berurutan lewat panah kanan): frame saat pecah (+0.15 s), +1 s,
     +3 s, lalu kotak Visit diklik. window.open dicatat (dan request ke luar localhost dicegat), url harus sama
     dengan data link
  4. sapuan mouse menembus bentuk: frame saat dan sesudah, FPS selama sapuan
  5. klik setengah kiri + swipe kiri (dua jalur ganti link lain), cek indeks berputar benar
  6. lembar kontak menghadap: rotasi volume dikunci, tiap link difoto di 3 sudut (0, 0.6, 1.4 rad dari muka)
     -> m7b_links_sheet.png, plus cakupan muka dari posisi partikel GPU (dibaca balik): muka bentuk (proyeksi
     volume .vol) dibagi grid 32x32, sel tepi dibuang, partikel dihitung kalau jarak SDF di posisinya < 0.02
     (di permukaan atau di dalam). Sel "bolong" = di bawah 20 partikel. Bentuk yang padat: bolong rendah.
Output: tools/verify/out/m7b_p_*.png, m7b_links_sheet.png, m7b_side.png. Exit 1 kalau ada error console atau
url Visit salah.
"""
import argparse
import base64
import gzip
import json
import os
import re
import struct
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'out')
VOLUMES = os.path.join(ROOT, 'public', 'assets', 'volumes')
# ref privat (tidak di repo), dicari lewat awalan nomor supaya nama file tidak ikut publik
REF14 = next((os.path.join(ROOT, '_ref_screenshots', f) for f in sorted(os.listdir(os.path.join(ROOT, '_ref_screenshots'))) if f.startswith('14_')), '') if os.path.isdir(os.path.join(ROOT, '_ref_screenshots')) else ''
ENTRY = '__igloo.engine.scenes.find((s) => s.key === "entry")'
CUBE = 0.65  # Particles.js PARTICLES.cube
SHEET_ANGLES = [0.0, 0.6, 1.4]

FPS_JS = '''(secs) => new Promise((res) => {
  let frames = 0; const t0 = performance.now();
  const tick = () => { frames++; if (performance.now() - t0 < secs * 1000) requestAnimationFrame(tick);
    else res(frames / ((performance.now() - t0) / 1000)); };
  requestAnimationFrame(tick);
})'''

# FPS dengan sinkron GPU: tiap frame baca 1 piksel dari canvas sesudah engine merender (callback rAF kita
# terdaftar sesudah gsap.ticker), jadi CPU menunggu GPU selesai. Batas bawah yang jujur untuk biaya per frame;
# rAF biasa di headless tanpa vsync bisa jalan lebih cepat dari GPU karena frame dibuang.
FPS_SYNC_JS = '''(secs) => new Promise((res) => {
  const gl = __igloo.engine.renderer.getContext(); const px = new Uint8Array(4);
  let frames = 0; const t0 = performance.now();
  const tick = () => { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    frames++; if (performance.now() - t0 < secs * 1000) requestAnimationFrame(tick);
    else res(frames / ((performance.now() - t0) / 1000)); };
  requestAnimationFrame(tick);
})'''

# biaya sim partikel per langkah (ms GPU), diukur dengan sinkron: 30 langkah lalu baca 1 piksel
SIM_COST_JS = f'''() => {{
  const s = {ENTRY}; const pt = s.particles; const r = pt.renderer; const prev = r.getRenderTarget();
  const buf = pt.type === 1015 ? new Float32Array(4) : new Uint16Array(4);
  r.readRenderTargetPixels(pt.read, 0, 0, 1, 1, buf);
  const t0 = performance.now();
  for (let i = 0; i < 30; i++) pt.step(1);
  r.readRenderTargetPixels(pt.read, 0, 0, 1, 1, buf);
  const ms = (performance.now() - t0) / 30;
  r.setRenderTarget(prev);
  return ms;
}}'''

# posisi partikel + uRotation di panggilan yang SAMA (dibaca terpisah, rotasi sudah maju selama transfer data)
READBACK_JS = f'''() => {{ const s = {ENTRY}; const pt = s.particles; const r = pt.renderer;
  const N = pt.size; const buf = new Float32Array(N * N * 4);
  r.readRenderTargetPixels(pt.read, 0, 0, N, N, buf);
  const out = new Float32Array(pt.count * 3);
  for (let i = 0; i < pt.count; i++) {{ out[i * 3] = buf[i * 4]; out[i * 3 + 1] = buf[i * 4 + 1]; out[i * 3 + 2] = buf[i * 4 + 2]; }}
  // base64 dari buffer biner: jauh lebih cepat dari Array.from (450 ribu angka lewat JSON makan detik)
  const u8 = new Uint8Array(out.buffer); let bin = '';
  for (let i = 0; i < u8.length; i += 32768) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 32768));
  return {{ rot: pt.uniforms.uRotation.value, xyz: btoa(bin) }}; }}'''


def readback(page):
    """Posisi partikel GPU (n, 3) dan uRotation saat posisi itu dihitung."""
    r = page.evaluate(READBACK_JS)
    return np.frombuffer(base64.b64decode(r['xyz']), dtype=np.float32).reshape(-1, 3).copy(), r['rot']


def lum(path, box=None):
    im = Image.open(path).convert('L')
    if box:
        im = im.crop(box)
    a = np.asarray(im, dtype=float) / 255
    return 'p10/50/90 %.2f/%.2f/%.2f' % tuple(np.percentile(a, [10, 50, 90]))


def side_by_side(frames, out):
    W, H = 520, 390
    cols = 3
    tiles = ([(REF14, 'ref 14')] if REF14 else []) + frames
    rows = (len(tiles) + cols - 1) // cols
    canvas = Image.new('RGB', (cols * W, rows * H), (20, 20, 20))
    for i, (path, label) in enumerate(tiles):
        im = Image.open(path).convert('RGB').resize((W, H), Image.LANCZOS)
        d = ImageDraw.Draw(im)
        d.rectangle([0, H - 22, W, H], fill=(0, 0, 0))
        d.text((6, H - 18), f'{label}  lum {lum(path)}', fill=(255, 255, 255))
        canvas.paste(im, ((i % cols) * W, (i // cols) * H))
    canvas.save(out)


def slug(title):
    return re.sub(r'[^a-z0-9]+', '', title.lower())


def load_distance(volume):
    """Jarak SDF [z][y][x] (satuan uvw) dari file .vol, sama dengan bacaan shader sim."""
    b = open(os.path.join(VOLUMES, f'{volume}.vol'), 'rb').read()
    _magic, res, ln, _ = struct.unpack('<4sIII', b[:16])
    raw = np.frombuffer(gzip.decompress(b[16:16 + ln]), np.uint8).astype(np.int32).reshape(4, res, res, res)
    a = np.cumsum(raw[3], axis=-1) % 256
    return (a / 255 * 2 - 1) * 2


def coverage(xyz, dist, scale, rot=1.5 * np.pi, grid=32, band=0.02, min_count=20):
    """Cakupan muka di ruang bentuk: partikel yang benar-benar di permukaan atau di dalam bentuk (jarak SDF di
    posisinya < band) diproyeksikan sepanjang tebal bentuk dan dihitung per sel muka. rot = uRotation sim saat
    posisi dibaca (sim membaca volume di rotY(rot) x posisi), jadi ukuran ini tidak tergantung sudut pandang.
    Sel tepi dibuang (erosi 1 sel). Return persen sel bentuk yang partikelnya di bawah min_count (terlihat
    bolong), median per sel, jumlah sel bentuk. Partikel yang melayang di luar bentuk tidak dihitung."""
    res = dist.shape[0]
    front = (dist < 0).any(axis=2).T[:, ::-1]  # [y][x bentuk], -z volume = +x bentuk
    k = res // grid
    mask = ndimage.binary_erosion(front.reshape(grid, k, grid, k).any(axis=(1, 3)))
    cs, sn = np.cos(rot), np.sin(rot)
    x, y, z = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    lp = np.stack([cs * x + sn * z, y, -sn * x + cs * z], axis=1)
    q = lp / CUBE * scale + 0.5
    idx = q * res - 0.5
    d = ndimage.map_coordinates(dist, [idx[:, 2], idx[:, 1], idx[:, 0]], order=1, mode='nearest')
    on = d < band
    sx = -(q[on, 2] - 0.5)  # ruang bentuk (facing() di build_volumes.py): x bentuk = -z volume
    sy = q[on, 1] - 0.5
    H, _, _ = np.histogram2d(sy, sx, bins=[grid, grid], range=[[-0.5, 0.5], [-0.5, 0.5]])
    cells = H[mask]
    return (cells < min_count).mean() * 100, float(np.median(cells)), int(mask.sum())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://localhost:5183/')
    ap.add_argument('--n', type=float, default=9.5, help='titik scroll ruang (entry progress 0.79)')
    ap.add_argument('--q', default='', help='paksa langkah fallback (dev: ?pq=)')
    ap.add_argument('--width', type=int, default=1280)
    ap.add_argument('--height', type=int, default=800)
    ap.add_argument('--no-sheet', action='store_true', help='lewati lembar kontak menghadap + cakupan muka')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    url = args.url + (f'?pq={args.q}' if args.q != '' else '')
    errors, warnings = [], []
    frames = []
    bad_visit = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu',
                                          '--disable-gpu-vsync', '--disable-frame-rate-limit'])
        ctx = browser.new_context(viewport={'width': args.width, 'height': args.height})
        # jangan benar-benar membuka situs luar dari tombol Visit
        ctx.route(lambda u: not u.startswith('http://localhost'), lambda r: r.fulfill(status=200, body='blocked by verify'))
        page = ctx.new_page()
        page.on('console', lambda m: (errors if m.type == 'error' else warnings if m.type == 'warning' else []).append(m.text))
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(url)
        page.wait_for_function('window.__igloo && document.getElementById("loader").classList.contains("hidden")',
                               timeout=90000)
        gpu = page.evaluate('''() => { const gl = __igloo.engine.renderer.getContext();
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); }''')
        info = page.evaluate(f'() => {{ const s = {ENTRY}; return {{ q: s.quality, stats: s.particles.stats, '
                             f'float: s.particles.type === 1015, size: s.particles.size }} }}')
        links = page.evaluate(f'() => {ENTRY}.linksUI.links.map((l) => ({{ title: l.title, url: l.url, volume: l.volume, scale: l.scale }}))')
        a11y = page.evaluate('''() => [...document.querySelectorAll('#a11y section[data-entry-links] a')]
            .map((a) => ({ text: a.textContent, href: a.getAttribute('href'), target: a.target }))''')
        print('GPU:', gpu)
        print('kualitas:', json.dumps(info['q']), ' tekstur sim', info['size'], 'float' if info['float'] else 'half')
        st = info['stats']
        print(f"pre-sim: compileAsync {st.get('compileAsyncMs', 0):.0f} ms, init + langkah pertama (kompilasi draw "
              f"pertama) {st['presimCompileMs']:.0f} ms, total presim {st['presimMs']:.0f} ms, "
              f"{st['presimStepsMs']:.2f} ms per langkah")
        print('link:', ', '.join(l['title'] for l in links))
        print('cermin DOM a11y:', a11y)
        if [a['href'] for a in a11y] != [l['url'] for l in links]:
            bad_visit.append('cermin DOM a11y tidak sama dengan data link')

        page.evaluate('__igloo.enableScroll(false); __igloo.adaptive(false)')
        page.evaluate(f'__igloo.setScroll({args.n})')
        page.mouse.move(args.width * 0.9, args.height * 0.15)  # mouse diam di pojok
        page.wait_for_timeout(2500)
        state = page.evaluate('__igloo.state()')
        print(f"ruang: n={args.n} p={state['current']['progress']:.3f} dpr {state['dpr']:.2f}")

        def shot(name, label):
            path = os.path.join(OUT, f'm7b_p_{name}.png')
            page.screenshot(path=path)
            frames.append((path, label))
            return path

        fps_idle = page.evaluate(FPS_JS, 4)
        fps_sync = page.evaluate(FPS_SYNC_JS, 4)
        sim_ms = page.evaluate(SIM_COST_JS)
        print(f'FPS ruang diam {args.width}x{args.height}: rAF {fps_idle:.1f}, tersinkron GPU {fps_sync:.1f}, '
              f'sim partikel {sim_ms:.2f} ms per langkah (GPU, tersinkron)')

        # window.open dicatat (url, target) lalu tetap diteruskan
        page.evaluate('''() => { window.__opened = []; const o = window.open.bind(window);
            window.open = (u, t, f) => { window.__opened.push([u, t]); return o(u, t, f) } }''')
        # screenshot sendiri makan ratusan ms, jadi tunggu per titik waktu sejak tombol ditekan (jam halaman),
        # dan label memakai waktu yang benar-benar terukur
        page.evaluate("window.addEventListener('keydown', () => { window.__switchAt = performance.now() })")
        since = '(performance.now() - window.__switchAt) / 1000'
        for k, link in enumerate(links):
            name = slug(link['title'])
            if k == 0:
                shot(f'0_{name}', f"link 0 {link['title']} (diam)")
            else:
                page.keyboard.press('ArrowRight')
                for tag, at in [('burst', 0.15), ('1s', 1.0), ('3s', 3.0)]:
                    page.wait_for_function(f'{since} >= {at}')
                    t = page.evaluate(since)
                    shot(f'{k}_{name}_{tag}', f"{link['title']} +{t:.2f} s")
            idx = page.evaluate(f'() => {ENTRY}.linkIndex')
            shown = page.evaluate(f'() => {ENTRY}.linksUI.name0.text')
            rect = page.evaluate(f'() => {ENTRY}.linksUI.visitRect')
            page.mouse.click((rect['x0'] + rect['x1']) / 2, (rect['y0'] + rect['y1']) / 2)
            page.wait_for_timeout(250)
            opened = page.evaluate('window.__opened.splice(0)')
            ok = idx == k and shown == link['title'] and len(opened) == 1 and opened[0][0] == link['url']
            if not ok:
                bad_visit.append(f"link {k} {link['title']}: index {idx}, nama {shown!r}, window.open {opened}")
            print(f"link {k} {link['title']:9s} index {idx} nama tampil {shown!r} Visit -> {opened}  "
                  f"{'OK' if ok else 'SALAH'}")
            page.mouse.move(args.width * 0.9, args.height * 0.15)
        for pg in ctx.pages[1:]:
            pg.close()

        # ---- sapuan mouse menembus bentuk ----
        cx, cy = args.width / 2, args.height * 0.42
        page.mouse.move(cx - args.width * 0.25, cy)
        page.wait_for_timeout(200)
        page.evaluate(f'''() => {{ window.__fpsP = ({FPS_JS})(1.0); return 1 }}''')
        for i in range(24):
            t = i / 23
            page.mouse.move(cx - args.width * 0.25 + t * args.width * 0.5, cy + np.sin(t * 6.28) * 40)
            page.wait_for_timeout(16)
        fps_sweep = page.evaluate('window.__fpsP')
        shot('sweep_during', 'sapuan mouse (saat)')
        page.wait_for_timeout(700)
        shot('sweep_after', 'sapuan +0.7 s')
        page.wait_for_timeout(2500)
        shot('sweep_settle', 'sapuan +3 s (kembali)')
        print(f'FPS selama sapuan mouse: {fps_sweep:.1f}')

        # ---- jalur ganti lain: klik setengah kiri, swipe ----
        n = len(links)
        before = page.evaluate(f'() => {ENTRY}.linkIndex')
        page.mouse.click(args.width * 0.2, args.height * 0.5)
        page.wait_for_timeout(300)
        after_click = page.evaluate(f'() => {ENTRY}.linkIndex')
        def swipe():
            page.mouse.move(args.width * 0.7, args.height * 0.5)
            page.mouse.down()
            # 4 langkah 100 px tanpa jeda: jeda antar event cuma overhead Playwright (belasan ms), jauh di atas
            # 1000 px/s. Saat mesin sibuk (agent lain menjalankan Playwright) jedanya bisa melar dan laju terukur
            # jatuh di bawah ambang (benar ditolak), jadi diulang sekali.
            for i in range(4):
                page.mouse.move(args.width * 0.75 - (i + 1) * 100, args.height * 0.5)
            page.mouse.up()
            page.wait_for_timeout(300)
            return page.evaluate(f'() => {ENTRY}.linkIndex')
        after_swipe = swipe()
        if after_swipe == after_click:
            print('swipe pertama ditolak (laju di bawah ambang), diulang sekali')
            after_swipe = swipe()
        nav_ok = after_click == (before - 1) % n and after_swipe == (after_click + 1) % n
        print(f'klik kiri: {before} -> {after_click} (harus -1), swipe kiri 400 px: {after_click} -> {after_swipe} '
              f"(harus +1)  {'OK' if nav_ok else 'SALAH'}")
        if not nav_ok:
            bad_visit.append('navigasi klik/swipe salah')

        # ---- lembar kontak menghadap + cakupan muka ----
        if not args.no_sheet:
            page.mouse.move(args.width * 0.9, args.height * 0.15)
            page.evaluate(f'''() => {{ const s = {ENTRY}; const pt = s.particles; const orig = pt.update.bind(pt);
              pt.update = (o) => {{ orig(o); if (window.__rot != null) pt.uniforms.uRotation.value = window.__rot }} }}''')
            cur = page.evaluate(f'() => {ENTRY}.linkIndex')
            tiles = []
            print('cakupan muka (rotasi dikunci menghadap, grid 32, partikel di permukaan): bolong = sel < 20 partikel')
            for k, link in enumerate(links):
                steps = (k - cur) % n
                for _ in range(steps):
                    page.keyboard.press('ArrowRight')
                cur = k
                for j, ang in enumerate(SHEET_ANGLES):
                    page.evaluate(f'window.__rot = 1.5 * Math.PI - {ang}')
                    page.wait_for_timeout(3500 if j == 0 else 1800)
                    if j == 0:
                        xyz, rot = readback(page)
                        np.save(os.path.join(OUT, f"m7b_face_{k}_{slug(link['title'])}.npy"), xyz)
                        holes, med, cells = coverage(xyz, load_distance(link['volume']), link['scale'], rot)
                        print(f"  {link['title']:9s} bolong {holes:5.1f}%  median {med:4.0f} partikel/sel  ({cells} sel)")
                    path = os.path.join(OUT, f"m7b_face_{k}_{slug(link['title'])}_{j}.png")
                    page.screenshot(path=path, clip={'x': args.width / 2 - 250, 'y': args.height * 0.15,
                                                     'width': 500, 'height': 480})
                    tiles.append((path, f"{link['title']} {ang:.1f} rad"))
            page.evaluate('window.__rot = null')
            tw, th = 300, 288
            cols = len(SHEET_ANGLES)
            sheet = Image.new('RGB', (cols * tw, len(links) * th), (20, 20, 20))
            for i, (path, label) in enumerate(tiles):
                im = Image.open(path).convert('RGB').resize((tw, th), Image.LANCZOS)
                ImageDraw.Draw(im).text((6, 6), label, fill=(0, 0, 0))
                sheet.paste(im, ((i % cols) * tw, (i // cols) * th))
            sheet_path = os.path.join(OUT, 'm7b_links_sheet.png')
            sheet.save(sheet_path)
            print('lembar kontak:', os.path.relpath(sheet_path, ROOT))

        lost = page.evaluate('__igloo.engine.renderer.getContext().isContextLost()')
        print('context lost:', lost)
        browser.close()

    side = os.path.join(OUT, 'm7b_side.png')
    pick = [f for f in frames if f[0].endswith(('_3s.png', '0_nehemiah.png', 'sweep_during.png'))][:5]
    side_by_side(pick, side)
    print('side-by-side:', os.path.relpath(side, ROOT))
    print('console warning:', warnings if warnings else 'nol')
    print('console error:', errors if errors else 'nol')
    if bad_visit:
        print('GAGAL:', bad_visit)
    sys.exit(1 if errors or bad_visit else 0)


if __name__ == '__main__':
    main()
