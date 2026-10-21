import { describe, it, expect } from 'vitest'
import { NAME, GLYPHS, lockedCount, scrambleChar, follow, pct } from '../src/engine/LoaderProgress.js'

const LETTERS = NAME.replace(/ /g, '')

describe('loader dekripsi nama: data', () => {
  it('nama 18 slot, 17 huruf, celah kosong di indeks 8', () => {
    expect(NAME).toBe('NEHEMIAH WILHELMUS')
    expect(NAME.length).toBe(18)
    expect(LETTERS.length).toBe(17)
    expect(NAME.indexOf(' ')).toBe(8)
  })

  it('GLYPHS ASCII cetak, unik, memuat simbol kode yang diminta', () => {
    expect(new Set(GLYPHS).size).toBe(GLYPHS.length)
    for (const c of GLYPHS) {
      const code = c.charCodeAt(0)
      expect(code).toBeGreaterThan(32)
      expect(code).toBeLessThan(127)
    }
    for (const c of '#%&*/<>{}[]01') expect(GLYPHS).toContain(c)
  })
})

describe('lockedCount: huruf ke-k terkunci saat p >= (k + 1) / n', () => {
  const n = LETTERS.length

  it('batas tiap huruf', () => {
    for (let k = 0; k < n; k++) {
      expect(lockedCount((k + 1) / n, n)).toBe(k + 1)
      expect(lockedCount((k + 1) / n - 0.001, n)).toBe(k)
    }
  })

  it('awal nol, akhir penuh, di luar 0..1 dijepit', () => {
    expect(lockedCount(0, n)).toBe(0)
    expect(lockedCount(1, n)).toBe(n)
    expect(lockedCount(1.5, n)).toBe(n)
    expect(lockedCount(-0.2, n)).toBe(0)
  })

  it('monoton naik terhadap p', () => {
    let prev = 0
    for (let i = 0; i <= 1000; i++) {
      const c = lockedCount(i / 1000, n)
      expect(c).toBeGreaterThanOrEqual(prev)
      prev = c
    }
  })
})

describe('scrambleChar', () => {
  it('selalu dari GLYPHS dan tidak pernah sama dengan karakter sebelumnya', () => {
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
    let prev = ''
    for (let i = 0; i < 2000; i++) {
      const c = scrambleChar(rand, prev)
      expect(GLYPHS).toContain(c)
      expect(c).not.toBe(prev)
      prev = c
    }
  })

  it('tepi rand 0 dan mendekati 1 tetap valid, avoid digeser ke karakter berikutnya', () => {
    expect(scrambleChar(() => 0)).toBe(GLYPHS[0])
    expect(scrambleChar(() => 0, GLYPHS[0])).toBe(GLYPHS[1])
    expect(scrambleChar(() => 0.999999)).toBe(GLYPHS[GLYPHS.length - 1])
    expect(scrambleChar(() => 0.999999, GLYPHS[GLYPHS.length - 1])).toBe(GLYPHS[0])
  })
})

describe('follow: progress tampil', () => {
  it('tidak pernah mundur dan tidak pernah melewati target', () => {
    let shown = 0
    const targets = [0.1, 0.1, 0.4, 0.35, 0.75, 0.6, 0.9, 1, 1, 1]
    let target = 0
    for (const t of targets) {
      target = Math.max(target, t) // target di LoaderProgress sendiri monoton
      for (let f = 0; f < 5; f++) {
        const next = follow(shown, target)
        expect(next).toBeGreaterThanOrEqual(shown)
        expect(next).toBeLessThanOrEqual(target)
        shown = next
      }
    }
    expect(follow(0.8, 0.5)).toBe(0.8)
  })

  it('sampai tepat di target dalam beberapa frame (snap di bawah 0.002)', () => {
    let shown = 0
    let frames = 0
    while (shown < 1 && frames < 100) {
      shown = follow(shown, 1)
      frames++
    }
    expect(shown).toBe(1)
    expect(frames).toBeLessThan(30)
  })
})

describe('pct', () => {
  it('3 digit, dijepit 0..100', () => {
    expect(pct(0)).toBe('000')
    expect(pct(0.07)).toBe('007')
    expect(pct(0.5)).toBe('050')
    expect(pct(1)).toBe('100')
    expect(pct(1.2)).toBe('100')
    expect(pct(-1)).toBe('000')
  })
})
