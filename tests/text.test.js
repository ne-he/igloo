import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { MsdfFont } from '../src/text/MsdfFont.js'
import { MsdfText } from '../src/text/MsdfText.js'
import { layoutText } from '../src/text/layout.js'
import { uiBreakpoint, computeUILayout, UI_RATIOS } from '../src/scenes/ui/layout.js'

const json = JSON.parse(fs.readFileSync(new URL('../public/assets/fonts/plexmono-msdf.json', import.meta.url), 'utf8'))
const font = new MsdfFont(json)
const close = (a, b, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps)
const lay = (text, o) => layoutText(font, text, o)

describe('atlas + MsdfFont', () => {
  it('parameter atlas sesuai spesifikasi (size 42, range 4, PNG lossless)', () => {
    expect(json.info.size).toBe(42)
    expect(json.distanceField.distanceRange).toBe(4)
    expect(json.pages[0]).toMatch(/\.png$/)
  })

  it('charset ASCII cetak + simbol tambahan lengkap', () => {
    const want = []
    for (let c = 32; c <= 126; c++) want.push(c)
    for (const ch of '©®·‘’“”€') want.push(ch.codePointAt(0))
    for (const c of want) expect(font.has(c), String.fromCodePoint(c)).toBe(true)
  })

  it('metrik Plex Mono: line height 1.3, advance 0.6 em, tanpa kerning', () => {
    close(font.lineHeight, 1.3)
    close(font.capHeight, 0.698)
    close(font.glyph(65).advance, 0.6)
    expect(font.kernings.size).toBe(0)
    expect(font.kerning(65, 86)).toBe(0)
  })

  it('tabel scramble hanya glyph yang punya bitmap (spasi tidak)', () => {
    expect(font.glyph(32).visible).toBe(false)
    expect(font.table.every((g) => g.visible)).toBe(true)
    expect(font.table.length).toBe(json.chars.length - 1)
    font.table.forEach((g, i) => expect(g.tableIndex).toBe(i))
  })

  it('rect uv di dalam atlas dan plane bounds masuk akal', () => {
    for (const g of font.table) {
      expect(g.u0).toBeGreaterThanOrEqual(0)
      expect(g.u1).toBeLessThanOrEqual(1)
      expect(g.v0).toBeGreaterThanOrEqual(0)
      expect(g.v1).toBeLessThanOrEqual(1)
      expect(g.u1).toBeGreaterThan(g.u0)
      expect(g.top).toBeGreaterThan(g.bottom)
    }
    // H: atas glyph (termasuk padding 2 px range) kira-kira cap height
    const H = font.glyph(72)
    close(H.top, font.capHeight + 2 / 42, 0.02)
    close(H.bottom, -2 / 42, 0.02)
  })

  it('karakter yang tidak ada di atlas jatuh ke "?"', () => {
    expect(font.glyph(0x4e2d).char).toBe('?')
  })
})

describe('layoutText', () => {
  it('pen x per glyph, lebar, indeks ternormalisasi', () => {
    const l = lay('ABC', { size: 10 })
    expect(l.glyphs.map((g) => g.x)).toEqual([0, 6, 12].map((v) => expect.closeTo(v, 6)))
    close(l.width, 18)
    expect(l.glyphs.map((g) => g.index01)).toEqual([0, 0.5, 1])
    expect(l.glyphs.every((g) => g.line === 0 && g.word01 === 0 && g.y === 0)).toBe(true)
  })

  it('letter spacing menambah jarak tapi tidak di ekor', () => {
    const l = lay('ABC', { size: 10, letterSpacing: 0.1 })
    expect(l.glyphs.map((g) => g.x)).toEqual([0, 7, 14].map((v) => expect.closeTo(v, 6)))
    close(l.width, 20)
  })

  it('align right berakhir di 0, center berpusat di 0', () => {
    const r = lay('ABCD', { size: 10, align: 'right' })
    close(r.glyphs[0].x, -24)
    close(r.lines[0].x + r.lines[0].width, 0)
    const c = lay('ABCD', { size: 10, align: 'center' })
    close(c.glyphs[0].x, -12)
  })

  it('baris baru: indeks baris, kata, baseline turun lineHeight', () => {
    const l = lay('a b\nc', { size: 10 })
    expect(l.lineCount).toBe(2)
    expect(l.glyphs.map((g) => g.line)).toEqual([0, 0, 1])
    expect(l.glyphs.map((g) => g.word01)).toEqual([0, 0.5, 1])
    close(l.glyphs[2].y, -13)
    close(lay('a\nb', { size: 10, lineHeight: 1 }).glyphs[1].y, -10)
  })

  it('spasi tidak dapat glyph, indeks glyph tetap rapat', () => {
    const l = lay('A  B', { size: 1 })
    expect(l.glyphs.length).toBe(2)
    close(l.glyphs[1].x, 1.8)
    expect(l.glyphs[1].index01).toBe(1)
  })

  it('wrap per kata dengan maxWidth (hint UI pecah 2 baris seperti ref)', () => {
    const l = lay('Scroll down to discover.', { size: 1, maxWidth: UI_RATIOS.hintMaxWidth })
    expect(l.lineCount).toBe(2)
    close(l.lines[0].width, 14 * 0.6)
    close(l.lines[1].width, 9 * 0.6)
    // baris kedua mulai dari x 0 (spasi depan dibuang)
    close(l.glyphs.find((g) => g.line === 1).x, 0)
  })

  it('kata lebih panjang dari maxWidth dipotong per huruf', () => {
    const l = lay('ABCDEFGHIJ', { size: 1, maxWidth: 3 })
    expect(l.lineCount).toBe(2)
    expect(l.glyphs.filter((g) => g.line === 0).length).toBe(5)
  })

  it('baris kosong dipertahankan', () => {
    const l = lay('a\n\nb', { size: 1 })
    expect(l.lineCount).toBe(3)
    expect(l.glyphs[1].line).toBe(2)
  })

  it('seed deterministik per seed, di [0, 1)', () => {
    const a = lay('hello world', { seed: 3 }).glyphs.map((g) => g.seed)
    const b = lay('hello world', { seed: 3 }).glyphs.map((g) => g.seed)
    const c = lay('hello world', { seed: 4 }).glyphs.map((g) => g.seed)
    expect(a).toEqual(b)
    expect(a).not.toEqual(c)
    expect(a.every((s) => s >= 0 && s < 1)).toBe(true)
  })
})

describe('MsdfText geometry', () => {
  it('satu quad per glyph, atribut per glyph konsisten di 4 vertex', () => {
    const t = new MsdfText(font, { text: 'Hi there', size: 10 })
    expect(t.glyphCount).toBe(7)
    expect(t.geometry.drawRange.count).toBe(42)
    const a = t.geometry.attributes.aText.array
    for (let i = 0; i < 7; i++) {
      for (let c = 1; c < 4; c++) expect(a[(i * 4 + c) * 4]).toBe(a[i * 16])
    }
    // aPen.z = indeks tabel glyph yang benar
    const pen = t.geometry.attributes.aPen.array
    expect(font.table[pen[2]].char).toBe('H')
  })

  it('setText lebih pendek tidak realokasi, lebih panjang realokasi', () => {
    const t = new MsdfText(font, { text: 'Sound: Off' })
    const before = t.geometry.attributes.position.array
    t.setText('Sound: On')
    expect(t.geometry.attributes.position.array).toBe(before)
    expect(t.glyphCount).toBe(8)
    t.setText('A much longer string that will not fit')
    expect(t.geometry.attributes.position.array).not.toBe(before)
    expect(t.capacity).toBeGreaterThanOrEqual(t.glyphCount)
  })

  it('teks kosong aman', () => {
    const t = new MsdfText(font, { text: '' })
    expect(t.glyphCount).toBe(0)
    expect(t.geometry.drawRange.count).toBe(0)
  })
})

describe('layout scene UI', () => {
  it('breakpoint small < 1600x800, mobile < 640', () => {
    expect(uiBreakpoint(1920, 1080)).toBe('desktop')
    expect(uiBreakpoint(1600, 800)).toBe('desktop')
    expect(uiBreakpoint(1599, 1080)).toBe('small')
    expect(uiBreakpoint(1920, 799)).toBe('small')
    expect(uiBreakpoint(1024, 768)).toBe('small')
    expect(uiBreakpoint(800, 600)).toBe('mobile')
    expect(uiBreakpoint(639, 1000)).toBe('mobile')
  })

  it('margin dan lebar kotak logo per breakpoint', () => {
    const m = { logoWidthEm: 2.55, capHeight: font.capHeight }
    expect(computeUILayout(1920, 1080, m).logoBox).toMatchObject({ x: 125, y: 90, width: 200 })
    expect(computeUILayout(1024, 768, m).logoBox).toMatchObject({ x: 50, y: 45, width: 160 })
    expect(computeUILayout(800, 600, m).logoBox).toMatchObject({ x: 25, y: 25, width: 140 })
  })

  it('1024x768 cocok dengan posisi yang diukur di ref 01 (toleransi 2 px)', () => {
    const L = computeUILayout(1024, 768, { logoWidthEm: 2.55, capHeight: font.capHeight, hintLines: 2 })
    const capTop = (b) => b.baseline - font.capHeight * b.size
    close(capTop(L.copyrightTitle), 94.7, 2)
    close(L.copyrightText.baseline, 135, 2)
    close(L.copyrightText.baseline + L.copyrightText.lineHeight * L.copyrightText.size, 151.6, 2)
    close(L.hint.baseline, 666.9, 2)
    close(L.hint.baseline + L.hint.lineHeight * L.hint.size, 680.3, 2)
    close(L.sound.baseline, 713.6, 2)
    // wordmark masuk kotak logo
    expect(L.logo.size * 2.55).toBeLessThanOrEqual(160 + 1e-6)
    expect(L.logo.size * font.capHeight).toBeLessThanOrEqual(160 * 0.21 + 1e-6)
  })
})
