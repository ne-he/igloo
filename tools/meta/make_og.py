"""Gambar preview link (public/og.jpg, 1200x630) dari screenshot igloo + nama, dirender browser supaya memakai
Plex Mono yang sama dengan situs.  Pakai: python tools/meta/make_og.py <screenshot_1200x630.png>"""
import base64, os, sys
from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FONTS = os.path.join(ROOT, 'node_modules', '@ibm', 'plex-mono', 'fonts', 'complete', 'woff2')
b64 = lambda p: base64.b64encode(open(p, 'rb').read()).decode()

def main(shot):
    html = f"""<!doctype html><meta charset="utf-8"><style>
    @font-face {{ font-family: P; font-weight: 500; src: url(data:font/woff2;base64,{b64(os.path.join(FONTS, 'IBMPlexMono-Medium.woff2'))}); }}
    @font-face {{ font-family: P; font-weight: 700; src: url(data:font/woff2;base64,{b64(os.path.join(FONTS, 'IBMPlexMono-Bold.woff2'))}); }}
    html, body {{ margin: 0; }}
    body {{ width: 1200px; height: 630px; background: url(data:image/png;base64,{b64(shot)}) center / cover; font-family: P, monospace; position: relative; overflow: hidden; }}
    .shade {{ position: absolute; inset: 0; background: linear-gradient(180deg, rgba(30,30,44,0.05) 30%, rgba(30,30,44,0.55)); }}
    .card {{ position: absolute; left: 56px; bottom: 50px; padding: 26px 34px 28px; background: rgba(30,30,44,0.82); border-radius: 8px; color: #fff; }}
    .k {{ font: 500 19px P; letter-spacing: 0.16em; color: #9fb9da; }}
    h1 {{ margin: 10px 0 12px; font: 700 52px/1.08 P; letter-spacing: -0.01em; }}
    p {{ margin: 0; font: 500 24px P; color: #e6ebf5; }}
    </style><div class="shade"></div><div class="card"><div class="k">NEMI'S IGLOO</div>
    <h1>Nehemiah Wilhelmus<br>Junaidi</h1><p>Data Science, BINUS / 3D portfolio</p></div>"""
    tmp = os.path.join(os.path.dirname(shot), 'og_tmp.png')
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 1200, 'height': 630})
        pg.set_content(html)
        pg.evaluate('document.fonts.ready')
        pg.wait_for_timeout(300)
        pg.screenshot(path=tmp)
        b.close()
    out = os.path.join(ROOT, 'public', 'og.jpg')
    Image.open(tmp).convert('RGB').save(out, quality=86, optimize=True)
    print('og.jpg', os.path.getsize(out), 'byte')

if __name__ == '__main__':
    main(sys.argv[1])
