import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { MsdfFont } from '../src/text/MsdfFont.js'
import { layoutText } from '../src/text/layout.js'
import { PANEL, panelSizes, layoutPanel, chipText } from '../src/scenes/detail/panelLayout.js'
import content from '../src/content/content.js'

// Panel detail format baru (26 Okt 2026): judul besar + kalimat pembuka + blok { label, lines } + link.
const json = JSON.parse(fs.readFileSync(new URL('../public/assets/fonts/plexmono-msdf.json', import.meta.url), 'utf8'))
const font = new MsdfFont(json)
const SCREENS = [[375, 812], [1024, 768], [1440, 900], [1024, 420]]
const ASCII = /^[ -~]*$/

describe('ukuran teks panel detail', () => {
  it('badan teks 17 sampai 19 px di desktop, 15 sampai 16 px di ponsel, judul jauh lebih besar', () => {
    for (const [w, h] of [[1024, 768], [1440, 900], [1920, 1080]]) {
      const s = panelSizes(w, h)
      expect(s.body).toBeGreaterThanOrEqual(17)
      expect(s.body).toBeLessThanOrEqual(19)
      expect(s.heading).toBeGreaterThanOrEqual(3 * s.body)
      expect(s.lead).toBeGreaterThan(s.body)
    }
    const p = panelSizes(375, 812)
    expect(p.body).toBeGreaterThanOrEqual(15)
    expect(p.body).toBeLessThanOrEqual(16)
    expect(p.lead).toBeGreaterThan(p.body)
    expect(p.label).toBeLessThan(p.body)
  })

  it('layar pendek: judul mengecil, maksimal ke 0.7x', () => {
    expect(panelSizes(1024, 420).heading).toBeLessThan(panelSizes(1024, 768).heading)
    expect(panelSizes(1024, 200).heading).toBeGreaterThanOrEqual(Math.floor(PANEL.sizes.small.heading * 0.7))
  })
})

describe('isi content.js cocok dengan panel', () => {
  it('tiap proyek punya heading, summary, 6 sampai 7 blok berisi 2 sampai 5 baris, semua ASCII cetak', () => {
    for (const p of content.projects) {
      expect(p.heading).toBeTruthy()
      expect(p.summary).toBeTruthy()
      expect(p.description).toBeUndefined()
      expect(p.blocks.length).toBeGreaterThanOrEqual(6)
      expect(p.blocks.length).toBeLessThanOrEqual(7)
      for (const t of [p.heading, p.summary, ...p.links.map(chipText)]) expect(t, p.slug).toMatch(ASCII)
      for (const b of p.blocks) {
        expect(b.label).toMatch(ASCII)
        expect(b.lines.length).toBeGreaterThanOrEqual(2)
        expect(b.lines.length).toBeLessThanOrEqual(5)
        for (const l of b.lines) expect(l, b.label).toMatch(ASCII)
      }
    }
  })
})

describe('tata letak panel detail', () => {
  it('kolom di dalam layar dengan tepi minimal, baris maksimal sekitar 64 huruf', () => {
    for (const [w, h] of SCREENS) {
      const L = layoutPanel(font, content.projects[0], w, h)
      expect(L.colX).toBeGreaterThanOrEqual(PANEL.gutter - 1)
      expect(L.colX + L.colW).toBeLessThanOrEqual(w - PANEL.gutter + 1)
      expect(L.colW).toBeLessThanOrEqual(PANEL.maxWidth)
      for (const b of L.blocks) {
        for (const it of b.items) {
          const lay = layoutText(font, it.text, it)
          expect(lay.width).toBeLessThanOrEqual(it.maxWidth + 1e-6)
          expect(it.x + it.maxWidth).toBeLessThanOrEqual(L.colW + 1e-6)
          for (const line of lay.lines) expect(line.width / (0.6 * it.size)).toBeLessThan(65)
        }
      }
    }
  })

  it('urutan vertikal: judul, pembuka, lalu tiap blok garis -> label -> butir, tanpa tumpang tindih', () => {
    for (const p of content.projects) {
      for (const [w, h] of SCREENS) {
        const L = layoutPanel(font, p, w, h)
        expect(L.blocks.length).toBe(p.blocks.length)
        expect(L.heading.y).toBeGreaterThan(L.top)
        expect(L.lead.y).toBeGreaterThan(L.heading.y)
        let prevBottom = L.lead.y + (L.lead.lines - 1) * L.lead.lineHeight * L.lead.size
        L.blocks.forEach((b, i) => {
          expect(b.items.length).toBe(p.blocks[i].lines.length)
          expect(b.ruleY).toBeGreaterThan(prevBottom)
          expect(b.label.y).toBeGreaterThan(b.ruleY)
          // label yang pecah jadi 2 baris mendorong butir pertama ke bawah
          const labelBottom = b.label.y + (b.label.lines - 1) * b.label.lineHeight * b.label.size
          let y = labelBottom
          for (const it of b.items) {
            // baseline butir di bawah baris terakhir sebelumnya + cap height butir ini
            expect(it.y - font.capHeight * it.size).toBeGreaterThan(y)
            // kotak penanda di kiri teks, sejajar baris pertama
            expect(it.marker.x + it.marker.size).toBeLessThan(it.x)
            expect(it.marker.y).toBeLessThan(it.y)
            expect(it.marker.y + it.marker.size).toBeGreaterThan(it.y - font.capHeight * it.size)
            y = it.y + (it.lines - 1) * it.lineHeight * it.size
          }
          prevBottom = y
        })
        expect(L.links.ruleY).toBeGreaterThan(prevBottom)
      }
    }
  })

  it('chip link di dalam kolom, pindah baris di ponsel, kotak klik menutup teks + panah', () => {
    for (const [w, h] of SCREENS) {
      for (const p of content.projects) {
        const L = layoutPanel(font, p, w, h)
        expect(L.links.chips.length).toBe(p.links.length)
        for (const c of L.links.chips) {
          expect(c.x).toBeGreaterThanOrEqual(0)
          expect(c.x + c.width).toBeLessThanOrEqual(L.colW + 1e-6)
          expect(c.rect.x0).toBeLessThan(c.x)
          expect(c.rect.x1).toBeGreaterThan(c.arrow.x + c.arrow.size)
          expect(c.rect.y0).toBeLessThan(c.y - font.capHeight * c.size)
          expect(c.rect.y1).toBeGreaterThan(c.y)
        }
      }
    }
    const rows = new Set(layoutPanel(font, content.projects[2], 375, 812).links.chips.map((c) => c.y))
    expect(rows.size).toBeGreaterThan(1)
  })

  it('konten lebih panjang dari layar bisa di-scroll sampai chip terakhir masuk area penuh', () => {
    for (const [w, h] of SCREENS) {
      for (const p of content.projects) {
        const L = layoutPanel(font, p, w, h)
        expect(L.scrollMax).toBeGreaterThan(0)
        const last = L.links.chips[L.links.chips.length - 1]
        const yOnScreen = last.y - L.scrollMax
        expect(yOnScreen).toBeGreaterThan(2 * PANEL.margin)
        expect(yOnScreen).toBeLessThanOrEqual(h - 2 * PANEL.margin)
      }
    }
  })

  it('jalur baca gelap menutup kolom dengan pad di kedua sisi', () => {
    const L = layoutPanel(font, content.projects[1], 1024, 768)
    expect(L.lane.x).toBeLessThan(L.colX)
    expect(L.lane.x + L.lane.w).toBeGreaterThan(L.colX + L.colW)
  })
})
