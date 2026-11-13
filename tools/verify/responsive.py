"""Audit responsif: foto semua layar di matriks viewport dan cek kotak UI tidak saling menimpa.

Pakai:  python tools/verify/responsive.py [--url http://localhost:5182/] [--tag resp] [--out DIR]
        [--only 360x640,844x390] [--states igloo,fact,crystals,detail,contact,loader,quick] [--dsf 1] [--no-gpu]
Butuh dev server jalan (handle window.__igloo cuma ada di dev). Hasil: <out>/<viewport>_<state>.png,
lembar kontak <out>/sheet_<viewport>_<n>.png, dan <out>/problems.json. Default out = tools/verify/out/<tag>/.

Viewport: 360x640, 390x844, 844x390, 768x1024 (sentuh), 1024x768, 1440x900, 1920x1080, 2560x1080.
Keadaan per viewport:
  loader        frame statis loader + link IN A HURRY (main.js ditahan, link muncul sesudah 3 s), lalu pesan gagal 3D
  igloo         titik istirahat igloo dengan cue scroll
  fact          kartu fakta: bata dengan fakta terpanjang dan bata paling atas di layar
  crystals      3 kristal diam (label + [ OPEN ] + teks ajakan dipaksa tampil)
  detail        3 panel detail: atas dan discroll sampai habis (chip link, tombol Close)
  contact       ruang link untuk 5 link (petunjuk, VISIT, nama, panah, Sound, indeks, tombol atas)
  quick         halaman profil ringkas: atas dan panjang penuh

Yang dicek otomatis (kotak dibaca dari engine, piksel CSS):
  - kotak tampilan (logo, tombol atas, cue, indeks, Sound, Close, kartu fakta, pelat label kristal, blok ruang link,
    pelat panah) tidak saling menimpa dan tidak keluar layar
  - area klik (Sound, item indeks, tombol atas, Close, VISIT, chip link, tombol OPEN) tidak saling menimpa. Ukurannya
    diukur dengan MENCOBA fungsi hit test yang dipakai app (bukan menyalin angka pad), di layar sentuh minimal 40 px
  - nama link ruang kontak tidak saling menimpa dan ada di dalam pelatnya
  - panel detail: area baca penuh cukup tinggi, semua chip link masuk area baca saat discroll habis
  - loader: nama, persen, link cepat tidak menimpa, link cepat cukup besar untuk jari
  - quick: tidak ada scroll horizontal, link cukup besar untuk jari
Yang TIDAK bisa dicek otomatis (lihat PNG): teks terpotong di dalam kotaknya, keterbacaan di atas latar, blok ruang
link menutupi bentuk partikel.
"""
import argparse
import json
import os
import sys
import time

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
GPU = ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu']
SOFT = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

VIEWPORTS = [
    ('360x640', 360, 640, True),
    ('390x844', 390, 844, True),
    ('844x390', 844, 390, True),
    ('768x1024', 768, 1024, True),
    ('1024x768', 1024, 768, False),
    ('1440x900', 1440, 900, False),
    ('1920x1080', 1920, 1080, False),
    ('2560x1080', 2560, 1080, False),
]
ALL_STATES = ['loader', 'igloo', 'fact', 'crystals', 'detail', 'contact', 'quick']
MIN_TAP = 40  # px, sisi terpendek area klik di layar sentuh
MIN_READ = 0.42  # porsi tinggi layar yang harus jadi area baca penuh panel detail

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

READY_JS = 'window.__igloo && document.getElementById("loader").classList.contains("hidden")'

# Semua kotak yang bisa dibaca dari engine. vis = kotak tampilan, hit = area klik (diukur lewat hit test asli).
BOXES_JS = r'''
(() => {
  const e = __igloo.engine, ui = e.ui, W = innerWidth, H = innerHeight
  const vis = {}, hit = {}, inside = {}
  const on = (m) => !!m && m.uniforms.uShow1.value > 0.5
  const tb = (m) => { const b = m.box, p = m.position; return { x0: p.x + b.x, y0: -(p.y + b.y), x1: p.x + b.x + b.width, y1: -(p.y + b.y - b.height) } }
  const plate = (pl) => { const h = pl.material.uniforms.uHalf.value, p = pl.position; return { x0: p.x - h.x, y0: -p.y - h.y, x1: p.x + h.x, y1: -p.y + h.y } }
  // area klik: jalan 1 px dari titik tengah ke empat arah sampai hit test asli bilang tidak kena
  const probe = (fn, cx, cy) => {
    if (!fn({ x: cx, y: cy })) return null
    const walk = (dx, dy) => { let k = 0; while (k < 600 && fn({ x: cx + dx * (k + 1), y: cy + dy * (k + 1) })) k++; return k }
    return { x0: cx - walk(-1, 0), x1: cx + walk(1, 0), y0: cy - walk(0, -1), y1: cy + walk(0, 1) }
  }
  const mid = (r) => [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2]
  const t = ui.texts
  if (on(t.logo)) vis.logo = tb(t.logo)
  if (on(t.copyrightTitle)) vis.copyTitle = tb(t.copyrightTitle)
  if (on(t.copyrightText)) vis.copyText = tb(t.copyrightText)
  if (on(t.sound) && ui.soundRect) {
    vis.sound = ui.soundRect
    hit.sound = probe((p) => ui._inSound(p), ...mid(ui.soundRect))
  }
  const tl = ui.topLinks
  if (tl.wanted && tl.lay) tl.lay.items.forEach((q, i) => {
    vis['top' + i] = plate(tl.plates[i])
    hit['top' + i] = probe((p) => tl.hit(p) === i, q.x + q.width / 2, q.baseline - tl.lay.cap / 2)
  })
  const cue = ui.scrollCue
  if (cue.wanted && cue.rect) {
    // pelat teks cue dan garis 1 px dicek terpisah (kotak gabungan melebar sampai baris Sound)
    const r = cue.rect, sp = cue.layoutSpec, cap = cue.font.capHeight * sp.size
    vis.cue = { x0: r.x0, y0: r.y0, x1: r.x1, y1: sp.baseline + 0.72 * sp.size }
    vis.cueTrack = { x0: sp.x - 1, x1: sp.x + 2, y0: sp.trackTop, y1: sp.trackBottom }
  }
  const si = ui.sectionIndex
  if (si.wanted && si.lay) {
    vis.index = plate(si.plate)
    si.lay.items.forEach((q, i) => {
      hit['index' + i] = probe((p) => si.hit(p) === i, q.x + q.width / 2, si.lay.markers[i].y)
    })
  }
  if (ui.detailMode && ui.closeRect) {
    vis.close = ui.closeRect
    hit.close = probe((p) => ui._inClose(p), ...mid(ui.closeRect))
  }
  const fl = ui.factLabel
  if (fl.visible && fl.show1 > 0.5 && fl.layoutResult) vis.fact = fl.layoutResult.box

  // label kristal: pelat diproyeksikan ke layar
  const cs = e.scenes.find((s) => s.key === 'crystals')
  let openPx = null
  // detail terbuka: scene kristal tidak di-update lagi, kotak tombol OPEN-nya basi (dan tidak bisa diklik)
  if (cs && cs.active && !ui._detailBusy()) cs.crystals.forEach((c, i) => {
    const L = c.labels, cam = cs.camera
    if (!L.visible) return
    const V = L.position.constructor
    const r = new V().setFromMatrixColumn(cam.matrixWorld, 0), u = new V().setFromMatrixColumn(cam.matrixWorld, 1)
    for (const [k, pl] of Object.entries(L.plates)) {
      if (!pl.visible) continue
      const h = pl.material.uniforms.uHalf.value
      const b = { x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9 }
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const p = pl.position.clone().addScaledVector(r, sx * h.x).addScaledVector(u, sy * h.y).project(cam)
        const x = (p.x * 0.5 + 0.5) * W, y = (0.5 - p.y * 0.5) * H
        b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y)
      }
      vis['label_' + k] = b
    }
    const br = cs.buttonRectPx(i)
    if (br) { openPx = br; hit.open = { x0: br.x0 - 6, y0: br.y0 - 6, x1: br.x1 + 6, y1: br.y1 + 6 } }
  })

  // ruang link: HUD piksel dengan origin tengah layar, y ke atas
  const en = e.scenes.find((s) => s.key === 'entry'), lu = en && en.linksUI
  let contact = null
  if (lu && lu.show > 0.5) {
    const hud = (r) => ({ x0: W / 2 + r.x0, x1: W / 2 + r.x1, y0: H / 2 - r.y1, y1: H / 2 - r.y0 })
    const hp = (pl) => { const h = pl.uniforms.uHalf.value, p = pl.position; return hud({ x0: p.x - h.x, x1: p.x + h.x, y0: p.y - h.y, y1: p.y + h.y }) }
    const ht = (m) => { const b = m.box, p = m.position; return hud({ x0: p.x + b.x, x1: p.x + b.x + b.width, y0: p.y + b.y - b.height, y1: p.y + b.y }) }
    vis.contact = hp(lu.plate)
    vis.arrowL = hp(lu.plateL)
    vis.arrowR = hp(lu.plateR)
    inside.contact = { hint: ht(lu.hintText), name: ht(lu.name0), namePrev: ht(lu.namePrev), nameNext: ht(lu.nameNext), visit: lu.visitRect }
    hit.visit = probe((p) => lu._inVisit(p), ...mid(lu.visitRect))
    contact = { index: lu.index, title: lu.links[lu.index].title, hint: lu.hintText.text, enabled: lu.enabled }
  }

  // panel detail
  const dc = e.detailController, panel = dc && dc.panel
  let detail = null
  if (panel && panel.shown && panel.L) {
    const c = panel.shared.uClip.value
    const chips = panel.chipRects.map((r) => ({ x0: r.x0 + panel.colX, x1: r.x1 + panel.colX, y0: r.y0 - panel.scrollY, y1: r.y1 - panel.scrollY }))
    chips.forEach((r, i) => { hit['chip' + i] = probe((p) => panel.hitChip(p.x, p.y) === i, ...mid(r)) || r })
    detail = { colX: panel.colX, colW: panel.colW, scrollY: panel.scrollY, scrollMax: panel.scrollMax, sizes: panel.L.sizes,
      full: [H * (1 - c.z), H * (1 - c.y)], top: panel.L.top, bottom: panel.L.bottom, chips }
  }
  const st = __igloo.state()
  return { W, H, vis, hit, inside, contact, detail, openPx, n: st.n, key: st.current.key, cueText: cue.text.text, bp: ui.layout && ui.layout.bp }
})()
'''

# Bata berfakta yang bisa dikenai dari kamera: titik layar + teks faktanya (pola igloo_hover.py)
FACT_POINTS_JS = r'''
(() => {
  const e = __igloo.engine, s = e.scenes[0], cam = s.camera, W = innerWidth, H = innerHeight, f = s.facts
  const out = []
  for (const i of f.factBricks) {
    const b = s.igloo.bricks.bricks[i]
    const c = b.position.clone().project(cam)
    let pt = null
    for (let r = 0; r <= 0.08 && !pt; r += 0.005) {
      for (let a = 0; a < 16 && !pt; a++) {
        const x = c.x + r * Math.cos(a * Math.PI / 8) * H / W, y = c.y + r * Math.sin(a * Math.PI / 8)
        if (f.pick({ x, y }) === i) pt = { x: (x * 0.5 + 0.5) * W, y: (0.5 - y * 0.5) * H }
      }
    }
    if (pt && pt.x > 8 && pt.x < W - 8 && pt.y > 8 && pt.y < H - 8) out.push({ i, text: f.factOf(i), pt })
  }
  return out
})()
'''

PROBLEMS = []


def problem(vp, state, msg):
    PROBLEMS.append({'viewport': vp, 'state': state, 'problem': msg})
    print(f'  [MASALAH] {vp} {state}: {msg}')


def overlap(a, b, eps=0.5):
    return a['x0'] < b['x1'] - eps and a['x1'] > b['x0'] + eps and a['y0'] < b['y1'] - eps and a['y1'] > b['y0'] + eps


def fmt(r):
    return f"({r['x0']:.0f},{r['y0']:.0f})-({r['x1']:.0f},{r['y1']:.0f})"


def check_boxes(vp, state, b, touch):
    """Aturan umum untuk satu keadaan: tidak menimpa, tidak keluar layar, area klik cukup besar."""
    W, H = b['W'], b['H']
    vis = {k: v for k, v in b['vis'].items() if v}
    hit = {k: v for k, v in b['hit'].items() if v}
    for k, v in b['hit'].items():
        if not v:
            problem(vp, state, f'area klik {k} tidak kena di titik tengahnya sendiri')
    names = sorted(vis)
    for i, a in enumerate(names):
        r = vis[a]
        if r['x0'] < -0.5 or r['y0'] < -0.5 or r['x1'] > W + 0.5 or r['y1'] > H + 0.5:
            problem(vp, state, f'{a} keluar layar {fmt(r)}')
        for c in names[i + 1:]:
            # dua pelat label kristal yang sama boleh bersebelahan rapat, tapi tetap tidak boleh menimpa
            if overlap(r, vis[c]):
                problem(vp, state, f'{a} {fmt(r)} menimpa {c} {fmt(vis[c])}')
    hn = sorted(hit)
    for i, a in enumerate(hn):
        r = hit[a]
        w = min(r['x1'], W) - max(r['x0'], 0)
        h = min(r['y1'], H) - max(r['y0'], 0)
        if w <= 0 or h <= 0:
            continue  # di luar layar (chip panel yang belum discroll), tidak bisa di-tap
        if touch and min(w, h) < MIN_TAP - 0.5:
            problem(vp, state, f'area klik {a} cuma {w:.0f}x{h:.0f} px (minimal {MIN_TAP})')
        for c in hn[i + 1:]:
            if overlap(r, hit[c]):
                problem(vp, state, f'area klik {a} {fmt(r)} menimpa area klik {c} {fmt(hit[c])}')
        # area klik satu kontrol tidak boleh menutup tampilan kontrol lain
        for c in names:
            if c.rstrip('0123456789') == a.rstrip('0123456789') or (a == 'visit' and c == 'contact') or (a == 'open' and c.startswith('label_')):
                continue
            if c in ('fact', 'cue', 'cueTrack') or c.startswith('label_'):
                continue
            if overlap(r, vis[c]):
                problem(vp, state, f'area klik {a} {fmt(r)} menimpa {c} {fmt(vis[c])}')
    for parent, kids in (b.get('inside') or {}).items():
        p = vis.get(parent)
        if not p:
            continue
        kn = sorted(kids)
        for i, a in enumerate(kn):
            r = kids[a]
            if r['x0'] < p['x0'] - 1 or r['x1'] > p['x1'] + 1 or r['y0'] < p['y0'] - 1 or r['y1'] > p['y1'] + 1:
                problem(vp, state, f'{a} {fmt(r)} keluar dari pelat {parent} {fmt(p)}')
            for c in kn[i + 1:]:
                if overlap(r, kids[c]):
                    problem(vp, state, f'{a} {fmt(r)} menimpa {c} {fmt(kids[c])}')


class Run:
    def __init__(self, args, browser, vp):
        self.args = args
        self.browser = browser
        self.name, self.w, self.h, self.touch = vp
        self.errors = []
        self.shots = []

    def context(self):
        kw = {'viewport': {'width': self.w, 'height': self.h}, 'device_scale_factor': self.args.dsf}
        if self.touch:
            kw.update(has_touch=True, is_mobile=True)
        return self.browser.new_context(**kw)

    def page(self, ctx, stub=True):
        page = ctx.new_page()
        page.set_default_timeout(60000)
        if stub:
            page.route('**/@vite/client', lambda route: route.fulfill(status=200, content_type='application/javascript', body=VITE_CLIENT_STUB))
        page.on('console', lambda m: self.errors.append(f'{self.name}: {m.text}') if m.type == 'error' else None)
        page.on('pageerror', lambda e: self.errors.append(f'{self.name}: {e}'))
        return page

    def shot(self, page, state, full=False):
        path = os.path.join(self.args.out, f'{self.name}_{state}.png')
        page.screenshot(path=path, full_page=full)
        self.shots.append((state, path))
        return path

    def boxes(self, page, state):
        b = page.evaluate(BOXES_JS)
        check_boxes(self.name, state, b, self.touch)
        return b

    # ---------- loader ----------
    def loader(self):
        ctx = self.context()
        page = self.page(ctx)
        # main.js diganti modul kosong: loader tetap frame statis (menahan request selamanya membuat screenshot macet)
        page.route('**/src/main.js*', lambda route: route.fulfill(status=200, content_type='application/javascript', body='export {}'))
        page.goto(self.args.url, wait_until='commit')
        page.wait_for_selector('#loader-quick', state='attached')
        page.wait_for_timeout(4000)  # link cepat muncul 3 s + pudar 0.6 s
        self.shot(page, 'loader')
        r = page.evaluate('''(() => {
          const q = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom } }
          return { W: innerWidth, H: innerHeight, name: q('#loader-name'), pct: q('#loader-pct'), quick: q('#loader-quick span'), link: q('#loader-quick'),
            opacity: +getComputedStyle(document.querySelector('#loader-quick')).opacity }
        })()''')
        self._dom_rules('loader', r, ['name', 'pct', 'quick'], tap=['quick'])
        if r['opacity'] < 0.9:
            problem(self.name, 'loader', f"link cepat belum tampil sesudah 4 s (opacity {r['opacity']:.2f})")
        # pesan gagal 3D: markup sama dengan yang dibuat main.js saat WebGL gagal
        page.evaluate('''(() => {
          const loaderEl = document.getElementById('loader')
          const box = document.createElement('div'); box.id = 'loader-fail'
          const msg = document.createElement('p'); msg.textContent = 'The 3D view could not start in this browser. Opening the quick profile instead.'
          const link = document.createElement('a'); link.href = '#'; link.textContent = 'OPEN THE QUICK PROFILE'
          box.append(msg, link); loaderEl.replaceChildren(box); document.getElementById('loader-quick')?.remove()
        })()''')
        page.wait_for_timeout(150)
        self.shot(page, 'loader_fail')
        r = page.evaluate('''(() => {
          const q = (s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x0: r.left, y0: r.top, x1: r.right, y1: r.bottom } }
          return { W: innerWidth, H: innerHeight, msg: q('#loader-fail p'), link: q('#loader-fail a') }
        })()''')
        self._dom_rules('loader_fail', r, ['msg', 'link'], tap=['link'])
        ctx.close()

    def _dom_rules(self, state, r, names, tap=()):
        W, H = r['W'], r['H']
        for i, a in enumerate(names):
            ra = r.get(a)
            if not ra:
                problem(self.name, state, f'elemen {a} tidak ada')
                continue
            if ra['x0'] < -0.5 or ra['y0'] < -0.5 or ra['x1'] > W + 0.5 or ra['y1'] > H + 0.5:
                problem(self.name, state, f'{a} keluar layar {fmt(ra)}')
            for c in names[i + 1:]:
                if r.get(c) and overlap(ra, r[c]):
                    problem(self.name, state, f'{a} {fmt(ra)} menimpa {c} {fmt(r[c])}')
        for a in tap:
            ra = r.get(a)
            if ra and self.touch and min(ra['x1'] - ra['x0'], ra['y1'] - ra['y0']) < MIN_TAP - 0.5:
                problem(self.name, state, f"area klik {a} cuma {ra['x1'] - ra['x0']:.0f}x{ra['y1'] - ra['y0']:.0f} px (minimal {MIN_TAP})")

    # ---------- situs 3D ----------
    def site(self, states):
        ctx = self.context()
        page = self.page(ctx)
        page.goto(self.args.url.rstrip('/') + '/?nointro')
        page.wait_for_function(READY_JS, timeout=120000)
        # kunci scroll diambil lebih awal: idle peek tidak pernah jalan (tidak ada setScroll dulu, cue harus tetap tampil)
        page.evaluate('__igloo.enableScroll(false); __igloo.adaptive(false)')
        page.wait_for_function('__igloo.engine.ui.introStarted', timeout=30000)
        if 'igloo' in states:
            self.igloo(page)
        if 'fact' in states:
            self.fact(page)
        if 'crystals' in states or 'detail' in states:
            self.crystals(page, 'crystals' in states, 'detail' in states)
        if 'contact' in states:
            self.contact(page)
        ctx.close()

    def igloo(self, page):
        try:
            page.wait_for_function('__igloo.engine.ui.guide.cueVisible && __igloo.engine.ui.scrollCue.draw.value >= 1 '
                                   '&& __igloo.engine.ui.sectionIndex.show.value >= 1 && __igloo.engine.ui.topLinks.show.value >= 1', timeout=15000)
        except Exception:
            problem(self.name, 'igloo', 'cue scroll / indeks / tombol atas tidak tampil dalam 15 s sesudah intro UI')
        page.wait_for_timeout(900)
        self.shot(page, 'igloo')
        b = self.boxes(page, 'igloo')
        for k in ('logo', 'sound', 'cue', 'index', 'top0', 'top1'):
            if k not in b['vis']:
                problem(self.name, 'igloo', f'kotak {k} tidak tampil')
        if abs(b['n'] - 0.658) > 0.02:
            problem(self.name, 'igloo', f"bukan di titik istirahat igloo (n {b['n']:.3f})")
        print(f"  igloo: bp {b['bp']} cue \"{b['cueText']}\" n {b['n']:.3f}")

    def _away(self, page):
        if self.touch:
            page.touchscreen.tap(self.w * 0.88, self.h * 0.3)
        else:
            page.mouse.move(self.w * 0.9, self.h * 0.12, steps=3)
        try:
            page.wait_for_function('__igloo.engine.ui.factLabel.show1 === 0', timeout=8000)
        except Exception:
            pass

    def fact(self, page):
        pts = page.evaluate(FACT_POINTS_JS)
        if not pts:
            problem(self.name, 'fact', 'tidak ada bata berfakta yang bisa dikenai')
            return
        longest = max(pts, key=lambda t: len(t['text']))
        top = min(pts, key=lambda t: t['pt']['y'])
        for tag, t in (('fact_long', longest), ('fact_top', top)):
            self._away(page)
            # titik dihitung ulang tepat sebelum disentuh (bata bernapas)
            fresh = next((x for x in page.evaluate(FACT_POINTS_JS) if x['i'] == t['i']), t)
            x, y = fresh['pt']['x'], fresh['pt']['y']
            if self.touch:
                page.touchscreen.tap(x, y)
            else:
                page.mouse.move(x, y, steps=5)
            try:
                page.wait_for_function('__igloo.engine.ui.factLabel.factShow2 >= 1 && __igloo.engine.ui.factLabel.line >= 1', timeout=8000)
            except Exception:
                problem(self.name, tag, f"kartu fakta bata {t['i']} tidak muncul")
            page.wait_for_timeout(200)
            self.shot(page, tag)
            b = self.boxes(page, tag)
            f = b['vis'].get('fact')
            print(f"  {tag}: bata {t['i']} \"{t['text']}\" kotak {fmt(f) if f else '-'}")
        self._away(page)

    def crystals(self, page, shots, detail):
        page.evaluate('''(() => { const s = __igloo.engine.scenes[1]; s._updateNudge = () => {} })()''')
        for i in range(3):
            page.evaluate(f'__igloo.setScroll({2.35 + i})')
            page.wait_for_timeout(900)
            if shots:
                page.evaluate(f'''(() => {{ const c = __igloo.engine.scenes[1].crystals[{i}]
                  c.labels.prepareNudge({{ touch: {'true' if self.touch else 'false'} }}); c.labels.setNudge(true) }})()''')
                page.wait_for_timeout(1100)
                state = f'crystal{i + 1}'
                self.shot(page, state)
                b = self.boxes(page, state)
                for k in ('label_title', 'label_date', 'label_temp'):
                    if k not in b['vis']:
                        problem(self.name, state, f'{k} tidak tampil')
                if 'open' not in b['hit']:
                    problem(self.name, state, 'tombol OPEN belum bisa diklik')
                page.evaluate(f'__igloo.engine.scenes[1].crystals[{i}].labels.setNudge(false)')
                o = b.get('openPx')
                print(f"  {state}: tombol OPEN {fmt(o) if o else '-'} label {sorted(k for k in b['vis'] if k.startswith('label_'))}")
            if detail:
                self.detail(page, i)

    def detail(self, page, i):
        tag = f'detail{i + 1}'
        page.evaluate('__igloo.enableScroll(true)')
        ok = page.evaluate(f'__igloo.detail.open({i})')
        try:
            page.wait_for_function("__igloo.detail.state().state === 'open'", timeout=15000)
        except Exception:
            problem(self.name, tag, f'detail tidak terbuka (open() = {ok}, state {page.evaluate("__igloo.detail.state().state")})')
            page.evaluate('__igloo.enableScroll(false)')
            return
        page.wait_for_timeout(1800)
        self.shot(page, f'{tag}_top')
        b = self.boxes(page, f'{tag}_top')
        d = b['detail']
        if d:
            full = d['full'][1] - d['full'][0]
            if full < MIN_READ * b['H']:
                problem(self.name, f'{tag}_top', f"area baca penuh panel cuma {full:.0f} px dari tinggi layar {b['H']} px")
            if d['colX'] < 12:
                problem(self.name, f'{tag}_top', f"kolom panel terlalu mepet tepi kiri ({d['colX']:.0f} px)")
        page.evaluate('(() => { const p = __igloo.engine.detailController.panel; p.scrollTarget = p.scrollMax })()')
        page.wait_for_function('(() => { const p = __igloo.engine.detailController.panel; return Math.abs(p.scrollY - p.scrollMax) < 0.5 })()', timeout=15000)
        page.wait_for_timeout(300)
        self.shot(page, f'{tag}_end')
        b = self.boxes(page, f'{tag}_end')
        d = b['detail']
        if d:
            for k, r in enumerate(d['chips']):
                # baris teks chip (tanpa pad klik 10 px) harus di dalam area baca penuh
                if r['y0'] + 10 < d['full'][0] - 1 or r['y1'] - 10 > d['full'][1] + 1:
                    problem(self.name, f'{tag}_end', f"chip {k} {fmt(r)} di luar area baca penuh {d['full'][0]:.0f}..{d['full'][1]:.0f}")
                if r['x1'] - 6 > d['colX'] + d['colW'] + 1:
                    problem(self.name, f'{tag}_end', f'chip {k} {fmt(r)} keluar kolom')
            print(f"  {tag}: scrollMax {d['scrollMax']:.0f} area baca {d['full'][0]:.0f}..{d['full'][1]:.0f} kolom {d['colX']:.0f}+{d['colW']:.0f} "
                  f"badan {d['sizes']['body']} px chip {len(d['chips'])}")
        page.evaluate('__igloo.detail.close()')
        try:
            page.wait_for_function("__igloo.detail.state().state === 'closed' && __igloo.detail.state().dp === 0", timeout=15000)
        except Exception:
            problem(self.name, tag, 'detail tidak tertutup')
        page.wait_for_timeout(600)
        page.evaluate('__igloo.enableScroll(false)')

    def contact(self, page):
        page.evaluate('__igloo.setScroll(9.4)')
        try:
            page.wait_for_function("(() => { const s = __igloo.engine.scenes.find((x) => x.key === 'entry'); return s.linksUI.enabled && s.linksUI.show > 0.98 })()", timeout=15000)
        except Exception:
            problem(self.name, 'contact', f"UI ruang link tidak aktif di n 9.4 ({json.dumps(page.evaluate('__igloo.state().current'))})")
            return
        if self.touch:
            page.evaluate("__igloo.engine.scenes.find((x) => x.key === 'entry').linksUI._setTouchHint(true)")
        n = page.evaluate("__igloo.engine.scenes.find((x) => x.key === 'entry').linksUI.links.length")
        for k in range(n):
            page.wait_for_timeout(2200 if k else 1500)  # partikel berubah bentuk
            state = f'contact{k + 1}'
            self.shot(page, state)
            b = self.boxes(page, state)
            c = b['contact'] or {}
            v = b['vis'].get('contact')
            print(f"  {state}: \"{c.get('title')}\" petunjuk \"{c.get('hint')}\" blok {fmt(v) if v else '-'}")
            for key in ('contact', 'arrowL', 'arrowR', 'sound', 'index', 'top0', 'logo'):
                if key not in b['vis']:
                    problem(self.name, state, f'kotak {key} tidak tampil')
            page.evaluate("__igloo.engine.scenes.find((x) => x.key === 'entry').changeLink(1)")

    # ---------- profil ringkas ----------
    def quick(self):
        ctx = self.context()
        page = self.page(ctx)
        page.goto(self.args.url.rstrip('/') + '/quick.html')
        page.wait_for_selector('#contact')
        page.wait_for_timeout(700)
        # ukur dulu: screenshot full_page mengatur ulang emulasi layar (pointer: coarse hilang sesudahnya)
        r = page.evaluate('''(() => {
          const W = innerWidth
          const out = { W, scrollW: document.documentElement.scrollWidth, small: [], wide: [] }
          for (const a of document.querySelectorAll('a')) {
            const r = a.getBoundingClientRect()
            if (r.right > W + 0.5 || r.left < -0.5) out.wide.push(a.textContent.trim().slice(0, 30))
            if (a.closest('footer') || a.closest('li')) continue
            out.small.push({ text: a.textContent.trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height), cls: a.className || a.parentElement.className })
          }
          for (const el of document.querySelectorAll('h1, h2, h3, p, li, nav')) {
            const r = el.getBoundingClientRect()
            if (r.right > W + 0.5) out.wide.push(el.tagName + ':' + el.textContent.trim().slice(0, 30))
          }
          return out
        })()''')
        self.shot(page, 'quick_top')
        self.shot(page, 'quick_full', full=True)
        if r['scrollW'] > r['W'] + 0.5:
            problem(self.name, 'quick', f"halaman bisa digeser horizontal (scrollWidth {r['scrollW']} > {r['W']})")
        for t in r['wide']:
            problem(self.name, 'quick', f'elemen keluar layar ke kanan: {t}')
        if self.touch:
            for a in r['small']:
                if a['h'] < MIN_TAP - 0.5:
                    problem(self.name, 'quick', f"link \"{a['text']}\" ({a['cls']}) cuma {a['w']}x{a['h']} px (minimal {MIN_TAP})")
        ctx.close()

    # ---------- lembar kontak ----------
    def sheets(self):
        if not self.shots:
            return []
        scale = min(0.75, 520 / max(self.w, self.h))
        cw, ch = round(self.w * scale), round(self.h * scale)
        cols = max(1, 1560 // (cw + 6))
        rows = max(1, 1500 // (ch + 22))
        per = cols * rows
        out = []
        items = [s for s in self.shots if s[0] != 'quick_full']
        for n in range(0, len(items), per):
            chunk = items[n:n + per]
            r = (len(chunk) + cols - 1) // cols
            sheet = Image.new('RGB', (cols * (cw + 6), r * (ch + 22)), (24, 24, 30))
            d = ImageDraw.Draw(sheet)
            for k, (state, path) in enumerate(chunk):
                x, y = (k % cols) * (cw + 6), (k // cols) * (ch + 22)
                d.text((x + 4, y + 4), f'{self.name} {state}', fill=(235, 235, 235))
                im = Image.open(path).convert('RGB').resize((cw, ch), Image.LANCZOS)
                sheet.paste(im, (x, y + 20))
            p = os.path.join(self.args.out, f'sheet_{self.name}_{n // per + 1}.png')
            sheet.save(p)
            out.append(p)
        return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://localhost:5182/')
    ap.add_argument('--tag', default='resp')
    ap.add_argument('--out', default='')
    ap.add_argument('--only', default='', help='daftar viewport dipisah koma, mis. 360x640,844x390')
    ap.add_argument('--states', default=','.join(ALL_STATES))
    ap.add_argument('--dsf', type=float, default=1, help='device scale factor (1 = paling ringan, tidak pernah macet)')
    ap.add_argument('--no-gpu', action='store_true', help='SwiftShader (lambat), default GPU asli D3D11')
    args = ap.parse_args()
    args.out = args.out or os.path.join(OUT, args.tag)
    os.makedirs(args.out, exist_ok=True)
    states = [s for s in args.states.split(',') if s]
    only = [s for s in args.only.split(',') if s]
    vps = [v for v in VIEWPORTS if not only or v[0] in only]

    errors = []
    sheets = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=SOFT if args.no_gpu else GPU)
        for vp in vps:
            t0 = time.time()
            run = Run(args, browser, vp)
            print(f'== {vp[0]} ({"sentuh" if vp[3] else "mouse"}) ==')
            for name, fn in (('loader', run.loader), ('site', lambda: run.site(states)), ('quick', run.quick)):
                if name != 'site' and name not in states:
                    continue
                if name == 'site' and not set(states) & {'igloo', 'fact', 'crystals', 'detail', 'contact'}:
                    continue
                try:
                    fn()
                except Exception as e:  # satu bagian gagal total: catat, lanjut ke bagian berikutnya
                    problem(vp[0], name, f'bagian gagal dijalankan: {str(e).splitlines()[0][:160]}')
            errors += run.errors
            sheets += run.sheets()
            print(f'  selesai {time.time() - t0:.0f} s, {len(run.shots)} foto')
        browser.close()

    with open(os.path.join(args.out, 'problems.json'), 'w', encoding='utf-8') as f:
        json.dump({'problems': PROBLEMS, 'console_errors': errors}, f, indent=1)
    print('\nlembar kontak:')
    for s in sheets:
        print(' ', s)
    print(f'\nmasalah: {len(PROBLEMS)}')
    for q in PROBLEMS:
        print(f"  {q['viewport']:>9}  {q['state']:<13} {q['problem']}")
    print('console errors:', errors if errors else 'nol')
    sys.exit(0 if not PROBLEMS and not errors else 1)


if __name__ == '__main__':
    main()
