"""Cek build produksi sebagai pengunjung asli (tanpa handle debug): versi aset, tombol cepat, tap kristal di
ponsel, dan jalur tanpa WebGL.

Pakai:  npx vite build && npx vite preview        (port 5180)
        python tools/verify/prod_check.py [url] [folder_screenshot]
"""
import sys, os, re
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5180/'
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
os.makedirs(OUT, exist_ok=True)
GPU = ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu']
ok_all = True
def check(name, good, info=''):
    global ok_all
    ok_all &= bool(good)
    print(('[OK] ' if good else '[GAGAL] ') + name, info)

with sync_playwright() as p:
    # 1. desktop: versi aset + tombol cepat + link loader
    b = p.chromium.launch(args=GPU)
    ctx = b.new_context(viewport={'width': 1440, 'height': 900})
    pg = ctx.new_page()
    errs, reqs = [], []
    pg.on('console', lambda m: errs.append(m.text[:200]) if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)[:200]))
    pg.on('request', lambda r: reqs.append(r.url))
    pg.goto(URL, wait_until='commit')
    pg.wait_for_selector('#loader-quick')
    check('link profil ringkas ada di loader', pg.get_attribute('#loader-quick', 'href') == '/quick.html')
    pg.wait_for_function('document.getElementById("loader").classList.contains("hidden")', timeout=180000)
    pg.wait_for_timeout(7000)
    check('link loader tersembunyi sesudah loader hilang', not pg.is_visible('#loader-quick'))
    assets = [u for u in reqs if re.search(r'/(assets|draco)/', u)]
    bad = [u for u in assets if '?v=' not in u and not re.search(r'-[A-Za-z0-9_-]{8}\.(js|css|woff2)$', u)]
    check(f'semua {len(assets)} request aset berversi atau ber-hash', not bad, bad[:5])
    pg.screenshot(path=os.path.join(OUT, 'prod_rest.png'))
    # tombol cepat kanan atas: cari posisinya dari link a11y tidak bisa, jadi klik di kanan atas (CV kiri, QUICK kanan)
    pg.evaluate('''() => { window.__opened = []; window.open = (u, t, f) => { window.__opened.push([u, t, f]); return null } }''')
    pg.mouse.move(1255, 62); pg.wait_for_timeout(400); pg.mouse.click(1255, 62); pg.wait_for_timeout(400)
    opened = pg.evaluate('window.__opened')
    check('klik [ CV ] membuka PDF di tab baru', len(opened) == 1 and opened[0][0].endswith('.pdf') and opened[0][1] == '_blank', opened)
    pg.mouse.move(1345, 62); pg.wait_for_timeout(400); pg.mouse.click(1345, 62)
    pg.wait_for_url('**/quick.html', timeout=15000)
    pg.wait_for_selector('#contact')
    check('klik [ QUICK VIEW ] membuka profil ringkas', True, pg.url)
    check('desktop tanpa console error', not errs, errs[:3])
    ctx.close()

    # 2. ponsel: tap badan kristal membuka detail
    ctx = b.new_context(**p.devices['iPhone 13'])
    pg = ctx.new_page()
    errs2 = []
    pg.on('pageerror', lambda e: errs2.append(str(e)[:200]))
    cdp = ctx.new_cdp_session(pg)
    pg.goto(URL)
    pg.wait_for_function('document.getElementById("loader").classList.contains("hidden")', timeout=180000)
    pg.wait_for_timeout(7000)
    W, H = pg.viewport_size['width'], pg.viewport_size['height']
    pg.screenshot(path=os.path.join(OUT, 'prod_phone_rest.png'))
    for _ in range(3):
        cdp.send('Input.synthesizeScrollGesture', {'x': W // 2, 'y': int(H * 0.6), 'yDistance': -380, 'speed': 1200, 'gestureSourceType': 'touch', 'preventFling': True})
        pg.wait_for_timeout(200)
    pg.wait_for_timeout(6000)
    pg.screenshot(path=os.path.join(OUT, 'prod_phone_crystal.png'))
    pg.touchscreen.tap(W * 0.5, H * 0.52)
    pg.wait_for_timeout(3500)
    check('ponsel: tap badan kristal membuka detail', '/portfolio/' in pg.url, pg.url)
    pg.screenshot(path=os.path.join(OUT, 'prod_phone_detail.png'))
    check('ponsel tanpa page error', not errs2, errs2[:3])
    ctx.close(); b.close()

    # 3. tanpa WebGL: pesan ramah lalu pindah ke profil ringkas
    b = p.chromium.launch(args=['--disable-gpu', '--disable-3d-apis'])
    pg = b.new_page(viewport={'width': 1280, 'height': 800})
    pg.goto(URL)
    try:
        pg.wait_for_selector('#loader-fail', timeout=60000)
        txt = pg.inner_text('#loader-fail')
        pg.screenshot(path=os.path.join(OUT, 'prod_no3d.png'))
        check('tanpa WebGL: pesan ramah muncul', 'quick profile' in txt.lower(), txt[:90].replace('\n', ' | '))
        pg.wait_for_url('**/quick.html?from=no3d', timeout=15000)
        pg.wait_for_selector('#contact')
        check('tanpa WebGL: pindah otomatis ke profil ringkas + catatan', pg.is_visible('#note'), pg.url)
    except Exception as e:
        check('tanpa WebGL: jalur gagal', False, str(e)[:200])
    b.close()
print('SEMUA LOLOS' if ok_all else 'ADA YANG GAGAL')
