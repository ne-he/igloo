import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { MsdfFont } from '../src/text/MsdfFont.js'
import { layoutText } from '../src/text/layout.js'
import { computeUILayout, layoutSectionIndex, uiTopZones, TOUCH_TARGET } from '../src/scenes/ui/layout.js'
import { layoutTopLinks } from '../src/scenes/ui/TopLinks.js'
import { sectionLabel } from '../src/scenes/ui/sectionNav.js'
import { PANEL, panelMargin, layoutPanel } from '../src/scenes/detail/panelLayout.js'
import content from '../src/content/content.js'

// Audit responsif 13 Nov 2026: area klik di layar sentuh, indeks satu baris di ponsel, blok ruang link menghindari
// UI bawah, panel detail di layar pendek. Pemeriksaan visual matriks viewport ada di tools/verify/responsive.py.
// LinksUI.js mengimpor three, jadi linksLayout dites lewat import dinamis.
const json = JSON.parse(fs.readFileSync(new URL('../public/assets/fonts/plexmono-msdf.json', import.meta.url), 'utf8'))
const font = new MsdfFont(json)
const m = { logoWidthEm: 2.55, capHeight: font.capHeight }
const VIEWPORTS = [[360, 640], [390, 844], [844, 390], [768, 1024], [1024, 768], [1440, 900], [1920, 1080], [2560, 1080]]
const overlap = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0

const indexOf = (L) => {
  const ws = content.ui.sections.map((label, i) =>
    layoutText(font, sectionLabel(i, label, L.index.compact), { size: L.index.size, letterSpacing: L.index.letterSpacing }).width)
  return layoutSectionIndex(L.index, ws, font.capHeight)
}

describe('area klik UI di layar sentuh', () => {
  for (const [w, h] of VIEWPORTS) {
    it(`${w}x${h}: item indeks dan tombol cepat minimal ${TOUCH_TARGET} px, tidak saling menimpa`, () => {
      const L = computeUILayout(w, h, { ...m, touch: true })
      const I = indexOf(L)
      for (const r of I.hits) {
        expect(r.y1 - r.y0).toBeGreaterThanOrEqual(TOUCH_TARGET - 1e-6)
        expect(r.x1 - r.x0).toBeGreaterThanOrEqual(TOUCH_TARGET - 1e-6)
        expect(r.y1).toBeLessThanOrEqual(h)
      }
      for (let i = 1; i < I.hits.length; i++) expect(overlap(I.hits[i], I.hits[i - 1])).toBe(false)
      const ws = content.ui.topLinks.map((l) => layoutText(font, l.label, { size: L.sound.size }).width)
      const T = layoutTopLinks({ right: w - L.sound.x, baseline: 40, size: L.sound.size, capHeight: font.capHeight, minHit: TOUCH_TARGET }, ws)
      for (const r of T.hits) {
        expect(r.y1 - r.y0).toBeGreaterThanOrEqual(TOUCH_TARGET - 1e-6)
        expect(r.x1 - r.x0).toBeGreaterThanOrEqual(TOUCH_TARGET - 1e-6)
      }
      expect(overlap(T.hits[0], T.hits[1])).toBe(false)
    })
  }

  it('mouse: tinggi baris indeks desktop tidak berubah', () => {
    const L = computeUILayout(1024, 768, m)
    const I = indexOf(L)
    expect(I.hits[0].y1 - I.hits[0].y0).toBeCloseTo(2.1 * L.index.size, 6)
  })
})

describe('indeks section satu baris di ponsel', () => {
  for (const [w, h] of [[360, 640], [390, 844], [844, 390]]) {
    it(`${w}x${h}: semua nomor di baseline Sound, rata kanan, di kanan blok Sound, garis cue di atasnya`, () => {
      const L = computeUILayout(w, h, { ...m, touch: true })
      const I = indexOf(L)
      for (const it of I.items) expect(it.baseline).toBeCloseTo(L.sound.baseline, 6)
      expect(I.items[2].x + I.items[2].width).toBeCloseTo(L.index.right, 6)
      for (let i = 1; i < I.items.length; i++) {
        // penanda item i tidak menimpa teks item sebelumnya
        expect(I.markers[i].x0).toBeGreaterThan(I.items[i - 1].x + I.items[i - 1].width)
      }
      const soundRight = L.sound.x + layoutText(font, 'Sound: Off', { size: L.sound.size }).width + 2 * L.sound.size
      expect(I.box.x0).toBeGreaterThan(soundRight)
      // garis cue berhenti di atas puncak huruf baris Sound / indeks
      expect(L.cue.trackBottom).toBeLessThan(I.items[0].baseline - font.capHeight * L.index.size)
    })
  }
})

describe('blok ruang link', () => {
  it('menghindari kotak UI bawah: dipersempit kalau cukup, dinaikkan kalau tidak', async () => {
    const { linksLayout } = await import('../src/scenes/entry/LinksUI.js')
    // tablet portrait: indeks di kanan bawah, cukup dipersempit
    const idx = { x0: 606, y0: 860, x1: 735, y1: 980 }
    const sound = { x0: 45, y0: 960, x1: 160, y1: 970 }
    const free = linksLayout(768, 1024)
    const a = linksLayout(768, 1024, { obstacles: [idx, sound] })
    expect(overlap(a.plateRect, idx)).toBe(false)
    expect(overlap(a.plateRect, sound)).toBe(false)
    expect(a.side).toBeLessThan(free.side)
    expect(a.plateRect.y1).toBeCloseTo(free.plateRect.y1, 6)
    // ponsel: indeks satu baris memakan sisi kanan, blok naik tepat di atasnya
    const row = { x0: 180, y0: 590, x1: 345, y1: 612 }
    const b = linksLayout(360, 640, { obstacles: [row, { x0: 25, y0: 598, x1: 135, y1: 606 }] })
    expect(overlap(b.plateRect, row)).toBe(false)
    expect(b.plateRect.y1).toBeLessThanOrEqual(row.y0 - 9.99)
    expect(b.plateRect.y1).toBeGreaterThan(row.y0 - 12)
  })

  it('layar pendek: kotak Visit kecil, blok lebih pendek. Ultrawide: panah dekat tengah', async () => {
    const { linksLayout } = await import('../src/scenes/entry/LinksUI.js')
    const s = linksLayout(844, 390)
    const t = linksLayout(1024, 768)
    expect(s.boxW).toBe(150)
    expect(s.plateH).toBeLessThan(t.plateH)
    expect(s.plateRect.y1).toBeLessThanOrEqual(390 - 12)
    expect(linksLayout(2560, 1080).ax).toBeLessThanOrEqual(1080 * 0.66 + 1e-6)
    expect(linksLayout(1024, 768).ax).toBeCloseTo(512 - 1024 * 0.13, 6)
  })
})

describe('label kristal dan panel detail', () => {
  it('zona UI atas menutup logo dan tombol cepat', () => {
    for (const [w, h] of VIEWPORTS) {
      const [left, right] = uiTopZones(w, h)
      const L = computeUILayout(w, h, m)
      expect(left.x1).toBeGreaterThan(L.logoBox.x + L.logoBox.width)
      expect(left.y1).toBeGreaterThan(L.logoBox.y + L.logoBox.height)
      const ws = content.ui.topLinks.map((l) => layoutText(font, l.label, { size: L.sound.size }).width)
      const T = layoutTopLinks({ right: w - L.sound.x, baseline: 0, size: L.sound.size, capHeight: font.capHeight }, ws)
      expect(right.x0).toBeLessThan(T.box.x0 - 0.55 * L.sound.size)
    }
  })

  it('layar pendek: area baca panel minimal 42% tinggi layar, layar biasa tetap 65 px', () => {
    expect(panelMargin(768)).toBe(PANEL.margin)
    expect(panelMargin(1080)).toBe(PANEL.margin)
    for (const h of [390, 420, 500]) expect(h - 4 * panelMargin(h)).toBeGreaterThanOrEqual(0.42 * h)
  })

  it('chip link: kotak klik minimal 44 px tinggi, kotak chip tidak saling menimpa', () => {
    for (const [w, h] of VIEWPORTS) {
      for (const p of content.projects) {
        const chips = layoutPanel(font, p, w, h).links.chips
        for (const c of chips) expect(c.rect.y1 - c.rect.y0).toBeGreaterThanOrEqual(PANEL.chipHit - 1e-6)
        for (let i = 0; i < chips.length; i++) {
          for (let k = i + 1; k < chips.length; k++) expect(overlap(chips[i].rect, chips[k].rect)).toBe(false)
        }
      }
    }
  })
})
