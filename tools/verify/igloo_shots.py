"""Screenshot deterministik igloo bata (M3) + side-by-side dengan ref 01/02/03.

Pakai:  python tools/verify/igloo_shots.py --url http://localhost:5192/ [--tag m3] [--width 800 --height 600]
Tiap shot: setScroll(n), setPointer(x, y), freeze(t), titik mouse dan lerp bata di-snap, lalu screenshot.
Output: tools/verify/out/<tag>_<nama>.png dan <tag>_side.png (kita di kiri, ref di kanan).
"""
import argparse
import json
import os
import sys

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(HERE, 'out')
REF = os.path.join(ROOT, '_ref_screenshots')

INTRO_MID = '''(() => { const c = __igloo.engine.scenes[0].igloo.introControls()
  c.iglooMaterialize.value = 0.55; c.outlineMaterialize.value = 0.85; c.outlineAlpha.value = 1
  c.cage.visible = true; c.cageProgress.value = 0.7; c.cageAlpha.value = 0.4
  c.digits.visible = true; c.digitsProgress.value = 0.6; c.digitsAlpha.value = 1 })()'''
INTRO_RESET = '''(() => { const c = __igloo.engine.scenes[0].igloo.introControls()
  c.iglooMaterialize.value = 1; c.outlineMaterialize.value = 1; c.outlineAlpha.value = 0
  c.cage.visible = false; c.cageAlpha.value = 0; c.digits.visible = false; c.digitsAlpha.value = 0 })()'''

# (nama, n, pointer x, pointer y, waktu beku, ref pembanding, JS sebelum shot)
SHOTS = [
    ('rest_out', 0.658, 0.9, -0.9, 10.0, '03_hero_igloo_assembled', ''),
    ('rest_center', 0.658, 0.0, 0.0, 10.0, '02_hero_igloo_assembling', ''),
    ('rest_igloo', 0.658, -0.06, 0.12, 12.6, '01_hero_igloo_exploded_plexus', ''),
    ('scroll_n0.2', 0.2, 0.9, -0.9, 10.0, None, ''),
    ('scroll_n0.0', 0.0, 0.9, -0.9, 10.0, None, ''),
    # n 10.55 = -0.3: transisi entry -> igloo, progress igloo 0.21 (ledakan scroll + outline jelas)
    ('scroll_n10.55', 10.55, 0.9, -0.9, 10.0, None, ''),
    ('intro_mid', 0.658, 0.9, -0.9, 10.0, None, INTRO_MID),
]

SNAP_JS = """
(() => {
  const e = __igloo.engine, s = e.scenes[0]
  s.mouse.update(s.camera, e.input.position11, 1000)
  s.igloo.bricks.snap()
  return true
})()
"""


def frames(page, n):
    page.evaluate(f'new Promise(r => {{ let k = {n}; const f = () => (--k <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f) }})')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://localhost:5192/')
    ap.add_argument('--tag', default='m3')
    ap.add_argument('--width', type=int, default=800)
    ap.add_argument('--height', type=int, default=600)
    ap.add_argument('--only', default='')
    ap.add_argument('--eval', default='', help='JS dijalankan sekali sebelum shot (tuning live)')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    errors = []
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        page = browser.new_page(viewport={'width': args.width, 'height': args.height})
        page.set_default_timeout(240000)
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(args.url)
        page.wait_for_function('window.__igloo && document.getElementById("loader").classList.contains("hidden")', timeout=180000)
        page.evaluate('__igloo.enableScroll(false); __igloo.adaptive(false)')
        if args.eval:
            page.evaluate(args.eval)
        for name, n, px, py, t, ref, js in SHOTS:
            if args.only and name not in args.only.split(','):
                continue
            page.evaluate(f'__igloo.setScroll({n}); __igloo.setPointer({px}, {py}); __igloo.freeze({t})')
            if js:
                page.evaluate(js)
            frames(page, 3)
            page.evaluate(SNAP_JS)
            frames(page, 3)
            page.evaluate(SNAP_JS)
            frames(page, 3)
            path = os.path.join(OUT, f'{args.tag}_{name}.png')
            page.screenshot(path=path, timeout=240000)
            st = page.evaluate('__igloo.state()')
            hero = page.evaluate("""(() => { const h = __igloo.engine.scenes[0].igloo; const b = h.bricks.bricks;
              return { maxDisp: Math.max(...b.map(x => x.disp)), plexusPoints: h.plexus.items.size, plexusLinks: h.plexus.links.length,
                       outlineAlpha: h.outline.material.uniforms.uScrollAlpha.value } })()""")
            if js:
                page.evaluate(INTRO_RESET)
            results.append((name, ref, path))
            print(f'{name}: n={n} p={st["current"]["progress"]:.3f} {json.dumps(hero)}  {os.path.relpath(path, ROOT)}')
        page.evaluate('__igloo.unfreeze()')
        frames(page, 30)
        info = page.evaluate('__igloo.info()')
        geo = page.evaluate('''(() => { const b = __igloo.engine.scenes[0].igloo.bricks.bricks
          return { bricks: b.length, tris: b.reduce((a, x) => a + x.geometry.index.count / 3, 0),
                   verts: b.reduce((a, x) => a + x.geometry.attributes.position.count, 0),
                   outlineSegs: __igloo.engine.scenes[0].igloo.outline.geometry.attributes.position.count / 2,
                   cageSegs: __igloo.engine.scenes[0].igloo.cage.geometry.attributes.position.count / 2 } })()''')
        print('igloo', json.dumps(geo))
        st = page.evaluate('__igloo.state()')
        print('renderer.info', json.dumps(info), 'fps (SwiftShader)', round(st['fps'], 1))
        browser.close()

    # side-by-side
    rows = []
    for name, ref, path in results:
        ours = Image.open(path).convert('RGB').resize((800, 600))
        row = Image.new('RGB', (1600, 600), (40, 40, 48))
        row.paste(ours, (0, 0))
        if ref:
            row.paste(Image.open(os.path.join(REF, f'{ref}.jpg')).convert('RGB').resize((800, 600)), (800, 0))
        d = ImageDraw.Draw(row)
        d.text((10, 580), f'kita: {name}', fill=(255, 255, 0))
        d.text((810, 580), f'ref: {ref or "-"}', fill=(255, 255, 0))
        rows.append(row)
    if rows:
        side = Image.new('RGB', (1600, 600 * len(rows)))
        for i, r in enumerate(rows):
            side.paste(r, (0, 600 * i))
        side = side.resize((800, 300 * len(rows)))
        sp = os.path.join(OUT, f'{args.tag}_side.png')
        side.save(sp)
        print('side-by-side', os.path.relpath(sp, ROOT))
    print('console errors:', errors if errors else 'nol')
    sys.exit(1 if errors else 0)


if __name__ == '__main__':
    main()
