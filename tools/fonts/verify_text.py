"""Verifikasi M4 (teks MSDF + scene UI) secara headless.

Pakai:  python tools/fonts/verify_text.py [--url http://localhost:5197/] [--tag m4]
Butuh server yang membuka build dev (lihat catatan snapshot di bawah) dengan window.__igloo.

Snapshot supaya tidak ikut full-reload saat agent lain mengedit file:
  NODE_ENV=development node node_modules/vite/bin/vite.js build --mode development --outDir tools/verify/out/snap_text
  node node_modules/vite/bin/vite.js preview --outDir tools/verify/out/snap_text --port 5197
(tanpa NODE_ENV=development, Vite 8 menganggap build = produksi dan handle debug ikut terbuang)

Yang diambil (semua ke tools/verify/out/):
  <tag>_800x600.png        n = 0.658, intro UI selesai (breakpoint mobile karena tinggi < 640)
  <tag>_1024x768.png       idem di 1024x768 (breakpoint small, ukuran tangkapan asli ref 01)
  <tag>_reveal40.png       intro dibekukan di 40 %, glyph masih ter-scramble
  <tag>_dpr2.png           device_scale_factor 2 dengan DPR engine bawaan (1.15)
  <tag>_dpr2_native.png    device_scale_factor 2 dengan DPR engine dipaksa 2 (bukti shader tajam)
  <tag>_side.png           ref 01 | kita 1024x768 dikecilkan ke 800x600
  <tag>_crops.png          potongan teks diperbesar 3x (nearest) untuk cek ketajaman
Plus: isi cermin a11y, uji hint hilang setelah scroll 0.59, error console.
"""
import argparse
import os
import sys

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'tools', 'verify', 'out')
REF01 = os.path.join(ROOT, '_ref_screenshots', '01_hero_igloo_exploded_plexus.jpg')
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']


def open_page(browser, url, w, h, dpr, errors):
    ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=dpr)
    page = ctx.new_page()
    page.set_default_timeout(120000)  # SwiftShader + agent lain jalan barengan, frame bisa lambat
    page.on('console', lambda m: errors.append(f'[{w}x{h}@{dpr}] {m.text}') if m.type == 'error' else None)
    page.on('pageerror', lambda e: errors.append(f'[{w}x{h}@{dpr}] {e}'))
    page.goto(url)
    page.wait_for_function('window.__igloo && document.getElementById("loader").classList.contains("hidden")', timeout=90000)
    page.evaluate('__igloo.enableScroll(false); __igloo.adaptive(false); __igloo.setScroll(0.658); __igloo.freeze(10)')
    return ctx, page


def wait_frames(page, n=2):
    start = page.evaluate('__igloo.engine.ticker.frame')
    page.wait_for_function(f'__igloo.engine.ticker.frame >= {start + n}')


def wait_intro_done(page, natural=False):
    """natural: tunggu intro jalan sendiri (auto 0.5 s) sampai selesai. Selain itu: tunggu intro mulai,
    lalu lompat ke akhir timeline (frame SwiftShader di mesin sibuk bisa > 0.5 s dan lag smoothing gsap
    membuat tween merayap 33 ms per frame)."""
    page.wait_for_function('__igloo.engine.ui && __igloo.engine.ui.introStarted')
    if natural:
        page.wait_for_function('__igloo.engine.ui.introTl.progress() === 1', timeout=300000)
    else:
        page.evaluate('__igloo.engine.ui.introTl.progress(1)')
    wait_frames(page, 3)


def ui_uniform(page, name, u):
    return page.evaluate(f'__igloo.engine.ui.texts.{name}.uniforms.{u}.value')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://localhost:5197/')
    ap.add_argument('--tag', default='m4')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    p = lambda name: os.path.join(OUT, f'{args.tag}_{name}.png')
    errors = []
    ok = True

    with sync_playwright() as pw:
        browser = pw.chromium.launch(args=ARGS)

        # 1. 800x600 (mobile) + reveal 40 % + a11y + hint
        ctx, page = open_page(browser, args.url, 800, 600, 1, errors)
        wait_intro_done(page, natural=True)
        print('intro jalan sendiri (auto 0.5 s) dan selesai')
        page.screenshot(path=p('800x600'))
        st = page.evaluate('({bp: __igloo.engine.ui.layout.bp, dpr: __igloo.engine.currentDpr})')
        print('800x600 ->', st, p('800x600'))

        a11y = page.evaluate('document.getElementById("a11y").innerText')
        print('a11y mirror:', a11y.replace('\n', ' | '))
        ok &= 'NEMI' in a11y and 'Scroll down to discover.' in a11y and 'Sound: Off' in a11y

        page.evaluate('__igloo.engine.ui.debugReveal(0.4)')
        wait_frames(page, 3)
        page.screenshot(path=p('reveal40'))
        print('reveal 40% ->', p('reveal40'),
              'logo show1/show2 =', ui_uniform(page, 'logo', 'uShow1'), ui_uniform(page, 'logo', 'uShow2'))
        page.evaluate('__igloo.engine.ui.introTl.progress(1)')

        # hint: hilang setelah 0.59 unit, muncul lagi saat kembali (polling, frame bisa lambat)
        page.evaluate('__igloo.setScroll(0.658 + 0.7)')
        page.wait_for_function('__igloo.engine.ui.texts.hint.uniforms.uShow1.value < 0.01', timeout=180000)
        hidden = ui_uniform(page, 'hint', 'uShow1')
        page.evaluate('__igloo.setScroll(0.658 + 0.3)')
        page.wait_for_function('__igloo.engine.ui.texts.hint.uniforms.uShow1.value > 0.99', timeout=180000)
        shown = ui_uniform(page, 'hint', 'uShow1')
        print(f'hint uShow1: setelah scroll +0.7 = {hidden:.3f} (harap 0), kembali +0.3 = {shown:.3f} (harap 1)')
        ok &= hidden < 0.01 and shown > 0.99
        ctx.close()

        # 2. 1024x768 (small, ukuran tangkapan ref 01)
        ctx, page = open_page(browser, args.url, 1024, 768, 1, errors)
        wait_intro_done(page)
        page.screenshot(path=p('1024x768'))
        print('1024x768 ->', page.evaluate('__igloo.engine.ui.layout.bp'), p('1024x768'))
        ctx.close()

        # 3. DPR 2: bawaan engine (1.15, keputusan Engine meniru igloo) lalu dipaksa 2.
        # Yang dipaksa 2 pakai viewport kecil supaya SwiftShader tidak timeout di 1600x1200.
        ctx, page = open_page(browser, args.url, 800, 600, 2, errors)
        wait_intro_done(page)
        page.screenshot(path=p('dpr2'))
        print('dpr2 engine dpr =', page.evaluate('__igloo.engine.currentDpr'), p('dpr2'))
        ctx.close()
        ctx, page = open_page(browser, args.url, 480, 360, 2, errors)
        page.evaluate('__igloo.engine.baseDpr = 2; __igloo.engine.resize()')
        wait_intro_done(page)
        page.screenshot(path=p('dpr2_native'))
        print('dpr2 native engine dpr =', page.evaluate('__igloo.engine.currentDpr'), p('dpr2_native'))
        ctx.close()
        browser.close()

    # side-by-side: ref 01 | kita (1024x768 dikecilkan ke 800x600, sama seperti ref)
    ref = Image.open(REF01).convert('RGB')
    ours = Image.open(p('1024x768')).convert('RGB').resize((800, 600), Image.LANCZOS)
    side = Image.new('RGB', (1600, 620), (20, 20, 24))
    side.paste(ref, (0, 20))
    side.paste(ours, (800, 20))
    d = ImageDraw.Draw(side)
    d.text((6, 4), 'ref 01 (1024x768 diperkecil)', fill=(255, 255, 255))
    d.text((806, 4), 'M4 kita 1024x768 diperkecil ke 800x600', fill=(255, 255, 255))
    side.save(p('side'))
    print('side-by-side ->', p('side'))

    # crop teks diperbesar (nearest) untuk cek ketajaman AA
    crops = [
        (p('800x600'), (15, 15, 215, 135), 1),
        (p('dpr2'), (30, 30, 430, 270), 2),
        (p('dpr2_native'), (40, 40, 440, 280), 2),
    ]
    tiles = []
    for path, box, s in crops:
        im = Image.open(path).convert('RGB').crop(box)
        im = im.resize((im.width * 3 // s, im.height * 3 // s), Image.NEAREST if s == 1 else Image.LANCZOS)
        tiles.append(im)
    W = sum(t.width for t in tiles) + 10 * (len(tiles) - 1)
    H = max(t.height for t in tiles)
    sheet = Image.new('RGB', (W, H), (20, 20, 24))
    x = 0
    for t in tiles:
        sheet.paste(t, (x, 0))
        x += t.width + 10
    sheet.save(p('crops'))
    print('crops ->', p('crops'))

    print('console errors:', errors if errors else 'nol')
    sys.exit(0 if ok and not errors else 1)


if __name__ == '__main__':
    main()
