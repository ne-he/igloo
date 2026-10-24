import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { MsdfFont } from '../src/text/MsdfFont.js'
import { layoutText } from '../src/text/layout.js'
import { Scroll } from '../src/engine/Scroll.js'
import { SECTIONS } from '../src/scenes/sections.js'
import { sectionRests, activeSection, planSectionJump, sectionLabel, SECTION_JUMP } from '../src/scenes/ui/sectionNav.js'
import { IdlePeek, PEEK, CueGate, CUE, loopDistance } from '../src/scenes/ui/idlePeek.js'
import { computeUILayout, layoutSectionIndex, UI_RATIOS } from '../src/scenes/ui/layout.js'
import content from '../src/content/content.js'

// Petunjuk scroll (cue, idle peek, indeks section): logika murni src/scenes/ui/sectionNav.js, idlePeek.js, layout.js.

const json = JSON.parse(fs.readFileSync(new URL('../public/assets/fonts/plexmono-msdf.json', import.meta.url), 'utf8'))
const font = new MsdfFont(json)
const close = (a, b, eps = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(eps)
const scroll = new Scroll(SECTIONS)
const rests = sectionRests(SECTIONS)
const total = scroll.total

describe('indeks section: titik istirahat dan item aktif', () => {
  it('titik istirahat = igloo 0.495, kristal pertama, entry 0.76 (n 0.658 / 2.35 / 9.29)', () => {
    expect(rests.map((r) => r.key)).toEqual(['igloo', 'crystals', 'entry'])
    close(rests[0].n, 0.658)
    close(rests[1].n, 2.35)
    close(rests[2].n, 9.29)
    close(scroll.map(rests[0].n).current.progress, 0.495)
    close(scroll.map(rests[2].n).current.progress, 0.76)
  })

  it('item aktif mengikuti scene yang menutupi lebih dari setengah layar', () => {
    expect(activeSection(scroll.map(0.658))).toBe(0)
    expect(activeSection(scroll.map(1.6))).toBe(0) // transisi 0.25
    expect(activeSection(scroll.map(1.9))).toBe(1) // transisi 0.55
    expect(activeSection(scroll.map(3.35))).toBe(1)
    expect(activeSection(scroll.map(5.0))).toBe(2)
    expect(activeSection(scroll.map(9.29))).toBe(2)
    expect(activeSection(scroll.map(10.5))).toBe(0) // sambungan loop entry ke igloo
  })

  it('label lebar dan ringkas', () => {
    expect(sectionLabel(0, 'IGLOO')).toBe('01 IGLOO')
    expect(sectionLabel(2, 'LINKS', true)).toBe('03')
    expect(content.ui.sections).toHaveLength(SECTIONS.length)
  })
})

describe('indeks section: arah dan durasi lompat', () => {
  const plan = (n, t) => planSectionJump(n, t, rests, total)

  it('01 -> 02 maju lewat transisi igloo ke kristal, 02 -> 01 mundur', () => {
    close(plan(0.658, 1).dy, 2.35 - 0.65825)
    close(plan(2.35, 0).dy, -(2.35 - 0.65825))
  })

  it('02 -> 03 maju menembus portal (bukan mundur lewat igloo), 03 -> 02 mundur', () => {
    close(plan(2.35, 2).dy, 9.29 - 2.35)
    close(plan(9.29, 1).dy, -(9.29 - 2.35))
  })

  it('03 -> 01 maju lewat sambungan loop, 01 -> 03 mundur lewat sambungan yang sama', () => {
    close(plan(9.29, 0).dy, total - 9.29 + 0.65825)
    close(plan(0.65825, 2).dy, -(total - 9.29 + 0.65825))
  })

  it('dari tengah scene: arah tetap tidak melewati titik istirahat section lain', () => {
    close(plan(3.35, 0).dy, 0.65825 - 3.35) // kristal 2 -> igloo: mundur
    close(plan(3.35, 2).dy, 9.29 - 3.35) // kristal 2 -> ruang link: maju
    close(plan(3.35, 1).dy, 2.35 - 3.35) // kristal 2 -> kristal 1
    // posisi di luar 0..total ikut dibungkus
    close(plan(3.35 + total * 2, 0).dy, 0.65825 - 3.35)
  })

  it('sudah di titik istirahat: tidak ada lompat', () => {
    expect(plan(0.65825, 0)).toBeNull()
    expect(plan(9.29, 2)).toBeNull()
  })

  it('durasi dijepit, lompat panjang lebih lama', () => {
    const J = SECTION_JUMP
    const short = plan(0.658, 1).duration
    const long = plan(2.35, 2).duration
    expect(short).toBeGreaterThanOrEqual(J.min)
    expect(long).toBeLessThanOrEqual(J.max)
    expect(long).toBeGreaterThan(short)
  })
})

describe('idle peek', () => {
  const ok = { enabled: true, atRest: true, detail: false, reduced: false, intro: false, busy: false }

  it('belum jalan sebelum intro UI selesai, jalan 6 s sesudahnya', () => {
    const p = new IdlePeek()
    expect(p.due(100, ok)).toBe(false) // belum di-arm
    p.arm(10)
    expect(p.due(10 + PEEK.firstDelay - 0.01, ok)).toBe(false)
    expect(p.due(10 + PEEK.firstDelay, ok)).toBe(true)
  })

  it('paling banyak 2 kali, jeda 9 s sesudah peek pertama selesai', () => {
    const p = new IdlePeek()
    p.arm(0)
    const t1 = PEEK.firstDelay
    expect(p.due(t1, ok)).toBe(true)
    p.begin()
    expect(p.due(t1 + 0.5, ok)).toBe(false) // sedang jalan
    const end1 = t1 + IdlePeek.span()
    p.end(end1)
    expect(p.due(end1 + PEEK.gap - 0.01, ok)).toBe(false)
    expect(p.due(end1 + PEEK.gap, ok)).toBe(true)
    p.begin()
    p.end(end1 + PEEK.gap + IdlePeek.span())
    expect(p.count).toBe(2)
    expect(p.due(1e6, ok)).toBe(false)
  })

  it('tidak jalan saat intro, detail terbuka, reduced motion, pointer ditekan, scroll terkunci, atau di luar titik istirahat', () => {
    const p = new IdlePeek()
    p.arm(0)
    const t = 100
    for (const k of ['intro', 'detail', 'reduced', 'busy']) expect(p.due(t, { ...ok, [k]: true }), k).toBe(false)
    for (const k of ['enabled', 'atRest']) expect(p.due(t, { ...ok, [k]: false }), k).toBe(false)
    // syarat yang cuma menunda: begitu bersih, peek jalan
    expect(p.due(t, ok)).toBe(true)
  })

  it('scroll sungguhan / scroll programatik membatalkan peek untuk sesi ini', () => {
    const p = new IdlePeek()
    p.arm(0)
    p.cancel()
    expect(p.due(1e6, ok)).toBe(false)
  })

  it('amplitudo peek tidak sampai transisi igloo ke kristal', () => {
    const peakN = 0.65825 + PEEK.amount
    expect(scroll.map(peakN).next).toBeNull()
    expect(scroll.map(peakN).current.key).toBe('igloo')
    // tapi cukup jauh untuk menggeser kamera (progress naik lebih dari 0.05)
    expect(scroll.map(peakN).current.progress - 0.495).toBeGreaterThan(0.05)
  })
})

describe('cue scroll: kapan terlihat', () => {
  const base = { dist: 0, inIgloo: true, moving: false, detail: false }

  it('tersembunyi sampai intro UI selesai, lalu tampil di igloo', () => {
    const g = new CueGate()
    expect(g.update(0.016, base)).toBe(false)
    g.arm()
    expect(g.update(0.016, base)).toBe(true)
    expect(g.update(0.016, { ...base, detail: true })).toBe(false)
    expect(g.update(0.016, { ...base, inIgloo: false })).toBe(false)
  })

  it('hilang di scroll pertama, TIDAK kembali kalau pengguna belum pernah pergi', () => {
    const g = new CueGate()
    g.arm()
    g.dismiss()
    for (let i = 0; i < 400; i++) expect(g.update(0.016, { ...base, dist: 0.05 })).toBe(false)
  })

  it('kembali hanya sesudah pergi, balik ke posisi awal, dan diam 3 s', () => {
    const g = new CueGate()
    g.arm()
    g.dismiss()
    g.update(0.016, { ...base, dist: 2, inIgloo: false, moving: true }) // pergi ke kristal
    expect(g.update(10, { ...base, dist: 0.3 })).toBe(false) // diam lama tapi belum di posisi awal
    g.update(0.016, { ...base, dist: 0.01, moving: true }) // kembali ke posisi awal (auto-center)
    expect(g.update(CUE.returnIdle - 0.1, { ...base, dist: 0.01 })).toBe(false) // diam belum 3 s
    expect(g.update(0.2, { ...base, dist: 0.01 })).toBe(true)
  })

  it('input apa pun mereset hitungan diam', () => {
    const g = new CueGate()
    g.arm()
    g.dismiss()
    g.update(0.016, { ...base, dist: 1, moving: true })
    g.update(2.9, { ...base, dist: 0 })
    g.input()
    expect(g.update(0.5, { ...base, dist: 0 })).toBe(false)
  })

  it('semua fakta ketemu: show() memaksa tampil lagi', () => {
    const g = new CueGate()
    g.arm()
    g.dismiss()
    g.show()
    expect(g.update(0.016, base)).toBe(true)
  })

  it('jarak melingkar di loop scroll', () => {
    close(loopDistance(0.7, 0.658, total), 0.042)
    close(loopDistance(10.8, 0.1, total), 0.15)
    close(loopDistance(0.658 + total * 3, 0.658, total), 0)
  })
})

describe('tata letak cue dan indeks section', () => {
  const m = { logoWidthEm: 2.55, capHeight: font.capHeight }
  const widths = (L, compact) => content.ui.sections.map((label, i) =>
    layoutText(font, sectionLabel(i, label, compact), { size: L.index.size, letterSpacing: L.index.letterSpacing }).width)

  for (const [w, h] of [[1024, 768], [1440, 900], [375, 812]]) {
    it(`${w}x${h}: cue di tengah, garis berakhir di baris Sound, indeks rata kanan di margin`, () => {
      const L = computeUILayout(w, h, m)
      close(L.cue.x, w / 2)
      close(L.cue.trackBottom, L.sound.baseline)
      expect(L.cue.trackTop).toBeLessThan(L.cue.trackBottom)
      expect(L.cue.baseline).toBeLessThan(L.cue.trackTop)
      const compact = L.index.compact
      expect(compact).toBe(w < 640)
      const ws = widths(L, compact)
      const I = layoutSectionIndex(L.index, ws, font.capHeight)
      // item terlebar menempel margin kanan, baris terakhir di baseline Sound
      close(Math.max(...I.items.map((it) => it.x + it.width)), L.index.right)
      close(I.items[2].baseline, L.sound.baseline)
      // area klik bersambung tanpa celah dan menutup teks
      for (let i = 1; i < I.hits.length; i++) close(I.hits[i].y0, I.hits[i - 1].y1)
      I.items.forEach((it, i) => {
        expect(I.hits[i].x0).toBeLessThan(it.x)
        expect(I.hits[i].x1).toBeGreaterThan(it.x + it.width)
      })
      // cue (pelat teks sekitar 1 em kiri kanan) tidak menabrak indeks: indeks seluruhnya di kanan cue
      const cueText = layoutText(font, compact ? content.ui.scrollCueTouch : content.ui.scrollCue,
        { size: L.cue.size, letterSpacing: L.cue.letterSpacing }).width
      const cueRight = L.cue.x + cueText / 2 + 1 * L.cue.size
      expect(cueRight).toBeLessThan(I.box.x0)
      // garis cue di kanan blok Sound (teks + ikon), teks cue di atas baris Sound
      const soundRight = L.sound.x + layoutText(font, 'Sound: Off', { size: L.sound.size }).width + 2 * L.sound.size
      expect(soundRight).toBeLessThan(L.cue.x)
      expect(L.cue.baseline).toBeLessThan(L.sound.baseline - 2 * L.sound.size)
    })
  }

  it('ponsel: nomor saja, baris lebih renggang (target sentuh), teks cue di atas baris teratas indeks', () => {
    const L = computeUILayout(375, 812, m)
    const I = layoutSectionIndex(L.index, widths(L, true), font.capHeight)
    expect(I.hits[0].y1 - I.hits[0].y0).toBeGreaterThanOrEqual(UI_RATIOS.indexLineHeightCompact * L.index.size - 1e-6)
    const indexTop = I.items[0].baseline - font.capHeight * L.index.size
    expect(L.cue.baseline).toBeLessThan(indexTop)
  })

  it('teks cue ASCII cetak saja (atlas font)', () => {
    for (const k of ['scrollCue', 'scrollCueTouch', 'scrollCueDone', 'scrollCueDoneTouch']) {
      expect(content.ui[k]).toMatch(/^[\x20-\x7e]+$/)
    }
    for (const s of content.ui.sections) expect(s).toMatch(/^[\x20-\x7e]+$/)
  })
})
