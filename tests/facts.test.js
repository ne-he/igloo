import { describe, it, expect } from 'vitest'
import {
  assignUniqueFacts, factNumber, counterText, FactTracker, Glimmer, GLIMMER, glimmerEnvelope,
} from '../src/scenes/igloo/facts.js'
import { factLabelLayout, FACT_LABEL, factHeader, factCardHeight } from '../src/scenes/ui/FactLabel.js'
import { factCounterLayout, tickSpans } from '../src/scenes/ui/FactCounter.js'
import content, { iglooFacts } from '../src/content/content.js'

// Kubah tiruan mirip igloo: cincin bata dari bawah ke atas, jumlah per cincin mengecil, total 70.
function dome() {
  const rings = [16, 15, 13, 11, 8, 5, 2]
  const pts = []
  rings.forEach((count, r) => {
    const phi = (r / rings.length) * (Math.PI / 2) * 0.95
    const radius = 3 * Math.cos(phi)
    const y = 0.3 + 3 * Math.sin(phi)
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + r * 0.37
      pts.push({ x: radius * Math.cos(a), y, z: radius * Math.sin(a) })
    }
  })
  return pts
}

describe('fakta bata igloo', () => {
  // kamera titik istirahat (BrickFacts FACTS.restCamera)
  const view = { x: -13.49, y: 2.65, z: 14.43 }

  it('daftar fakta: ASCII cetak saja, pendek, tidak ada duplikat, tanpa IELTS', () => {
    expect(iglooFacts.length).toBeGreaterThanOrEqual(8)
    expect(new Set(iglooFacts).size).toBe(iglooFacts.length)
    for (const f of iglooFacts) {
      expect(f).toMatch(/^[ -~]+$/)
      expect(f.length).toBeLessThanOrEqual(24)
    }
    expect(iglooFacts.some((f) => f.includes('IELTS'))).toBe(false)
  })

  it('tiap fakta tepat di satu bata, sisanya tanpa fakta', () => {
    const pts = dome()
    const out = assignUniqueFacts(pts, iglooFacts.length, view)
    const used = out.filter((f) => f >= 0)
    expect(used.length).toBe(iglooFacts.length)
    expect(new Set(used).size).toBe(iglooFacts.length)
    expect(out.filter((f) => f < 0).length).toBe(pts.length - iglooFacts.length)
  })

  it('bata berfakta menghadap kamera dan tersebar (tidak bergerombol)', () => {
    const pts = dome()
    const out = assignUniqueFacts(pts, iglooFacts.length, view)
    const chosen = pts.filter((_, i) => out[i] >= 0)
    const len = Math.hypot(view.x, view.z)
    for (const p of chosen) {
      // sisi kubah yang menghadap kamera (bidang datar)
      expect((p.x * view.x + p.z * view.z) / len).toBeGreaterThan(-0.5)
    }
    let minGap = Infinity
    for (let i = 0; i < chosen.length; i++) {
      for (let j = i + 1; j < chosen.length; j++) {
        const d = Math.hypot(chosen[i].x - chosen[j].x, chosen[i].y - chosen[j].y, chosen[i].z - chosen[j].z)
        minGap = Math.min(minGap, d)
      }
    }
    expect(minGap).toBeGreaterThan(0.6)
  })

  it('deterministik dan aman untuk daftar kosong / fakta lebih banyak dari kandidat', () => {
    const pts = dome()
    expect(assignUniqueFacts(pts, 12, view)).toEqual(assignUniqueFacts(pts, 12, view))
    expect(assignUniqueFacts(pts, 0, view).every((f) => f === -1)).toBe(true)
    const many = assignUniqueFacts(pts, 60, view).filter((f) => f >= 0)
    expect(new Set(many).size).toBe(60)
  })
})

describe('tata letak label fakta', () => {
  const base = { textWidth: 160, size: 12.8, capHeight: 0.698, width: 1024, height: 768 }

  it('ke kanan: siku di kanan atas titik bata, teks di atas garis bawah, kotak di dalam layar', () => {
    const L = factLabelLayout({ ...base, x: 500, y: 400, side: 1 })
    expect(L.side).toBe(1)
    expect(L.elbow.x).toBeCloseTo(500 + FACT_LABEL.elbowX * 12.8)
    expect(L.elbow.y).toBeCloseTo(400 - FACT_LABEL.elbowY * 12.8)
    expect(L.end.x).toBeGreaterThan(L.elbow.x)
    expect(L.baseline).toBeLessThan(L.elbow.y)
    expect(L.textX).toBeGreaterThan(L.box.x0)
    expect(L.textX + base.textWidth).toBeLessThan(L.box.x1)
  })

  it('ke kiri: garis bawah memanjang ke kiri dari siku', () => {
    const L = factLabelLayout({ ...base, x: 500, y: 400, side: -1 })
    expect(L.side).toBe(-1)
    expect(L.end.x).toBeLessThan(L.elbow.x)
    expect(L.box.x1).toBeCloseTo(L.elbow.x)
  })

  it('tidak muat di kanan -> pindah ke kiri, dan tetap di dalam layar di tepi atas', () => {
    const L = factLabelLayout({ ...base, x: 980, y: 20, side: 1 })
    expect(L.side).toBe(-1)
    expect(L.box.x0).toBeGreaterThanOrEqual(FACT_LABEL.margin)
    expect(L.box.x1).toBeLessThanOrEqual(base.width - FACT_LABEL.margin)
    expect(L.box.y0).toBeGreaterThanOrEqual(FACT_LABEL.margin - 1e-9)
  })

  it('kotak blok teks UI dihindari: sisi dibalik kalau sisi pilihan menabrak', () => {
    const free = factLabelLayout({ ...base, x: 300, y: 200, side: 1 })
    const avoid = [{ x0: free.box.x0 + 5, y0: free.box.y0, x1: free.box.x0 + 30, y1: free.box.y1 }]
    const L = factLabelLayout({ ...base, x: 300, y: 200, side: 1, avoid })
    expect(L.side).toBe(-1)
    // dua sisi menabrak: tetap di sisi pilihan (tidak hilang)
    const both = [{ x0: 0, y0: 0, x1: 1024, y1: 768 }]
    expect(factLabelLayout({ ...base, x: 300, y: 200, side: 1, avoid: both }).side).toBe(1)
  })

  it('layar sempit (mobile 375): kotak dijepit ke dalam layar', () => {
    const L = factLabelLayout({ ...base, width: 375, height: 812, size: 12, x: 190, y: 400, side: 1 })
    expect(L.box.x0).toBeGreaterThanOrEqual(FACT_LABEL.margin)
    expect(L.box.x1).toBeLessThanOrEqual(375 - FACT_LABEL.margin + 1e-9)
  })
})

describe('kartu fakta dan penghitung: teks', () => {
  const strings = content.ui.facts

  it('kepala kartu: nomor fakta dua digit, ASCII', () => {
    expect(factNumber(3, 12)).toBe('03/12')
    expect(factNumber(12, 12)).toBe('12/12')
    expect(factNumber(7, 120)).toBe('007/120')
    expect(factHeader(3, 12)).toBe('FACT 03/12')
    expect(factHeader(0, 12)).toBe('')
    expect(factHeader(1, iglooFacts.length)).toMatch(/^[ -~]+$/)
  })

  it('penghitung: FOUND n/total, selesai ALL total FOUND, semua ASCII', () => {
    expect(counterText(3, 12, strings)).toBe('FOUND 3/12')
    expect(counterText(12, 12, strings)).toBe('ALL 12 FOUND')
    for (let n = 0; n <= iglooFacts.length; n++) expect(counterText(n, iglooFacts.length, strings)).toMatch(/^[ -~]+$/)
  })
})

describe('hitungan fakta ditemukan', () => {
  it('tiap fakta dihitung sekali, ulang tidak menambah', () => {
    const t = new FactTracker(12)
    expect(t.mark(4)).toEqual({ isNew: true, count: 1, total: 12, justCompleted: false })
    expect(t.mark(4)).toEqual({ isNew: false, count: 1, total: 12, justCompleted: false })
    expect(t.mark(-1).isNew).toBe(false)
    expect(t.mark(12).isNew).toBe(false)
    expect(t.count).toBe(1)
    expect(t.has(4)).toBe(true)
  })

  it('selesai tepat sekali, saat fakta terakhir', () => {
    const t = new FactTracker(12)
    const done = []
    for (const f of [3, 1, 3, 0, 2, 5, 4, 7, 6, 9, 8, 11, 10, 10, 2]) done.push(t.mark(f).justCompleted)
    expect(done.filter(Boolean).length).toBe(1)
    expect(done.indexOf(true)).toBe(12) // fakta ke-12 yang baru (indeks 10), sesudah satu ulangan
    expect(t.completed).toBe(true)
    expect(t.count).toBe(12)
  })
})

describe('kilau petunjuk', () => {
  const run = (g, seconds, cand, enabled = () => true, dt = 1 / 60) => {
    const log = []
    for (let i = 0; i < seconds / dt; i++) {
      const t = i * dt
      g.update(dt, enabled(t), typeof cand === 'function' ? cand(t) : cand)
      log.push([t, g.index, g.amount])
    }
    return log
  }
  const starts = (log) => log.filter(([, idx], i) => idx >= 0 && (i === 0 || log[i - 1][1] !== idx)).map(([t, idx]) => [t, idx])

  it('selubung naik turun halus, nol di ujung', () => {
    expect(glimmerEnvelope(0)).toBe(0)
    expect(glimmerEnvelope(1)).toBe(0)
    expect(glimmerEnvelope(0.5)).toBeCloseTo(1)
    expect(glimmerEnvelope(0.1)).toBeLessThan(glimmerEnvelope(0.3))
  })

  it('hanya bata kandidat, jarak antar awal 3 sampai 5 s, lama sekitar 1.3 s', () => {
    const cand = [9, 10, 22, 33, 53]
    const s = starts(run(new Glimmer(), 60, cand))
    expect(s.length).toBeGreaterThanOrEqual(12)
    expect(s[0][0]).toBeCloseTo(GLIMMER.first, 1)
    for (const [, idx] of s) expect(cand).toContain(idx)
    for (let i = 1; i < s.length; i++) {
      const gap = s[i][0] - s[i - 1][0]
      expect(gap).toBeGreaterThanOrEqual(GLIMMER.minGap - 0.02)
      expect(gap).toBeLessThanOrEqual(GLIMMER.maxGap + 0.02)
      expect(s[i][1]).not.toBe(s[i - 1][1]) // tidak bata yang sama dua kali berturut-turut
    }
    expect(GLIMMER.duration).toBeGreaterThanOrEqual(1)
    expect(GLIMMER.duration).toBeLessThanOrEqual(1.5)
  })

  it('deterministik dengan seed sama', () => {
    const a = starts(run(new Glimmer(), 30, [1, 2, 3, 4]))
    const b = starts(run(new Glimmer(), 30, [1, 2, 3, 4]))
    expect(a).toEqual(b)
  })

  it('mati saat tidak aktif (intro, luar titik istirahat), tanpa kandidat tidak ada kilau baru', () => {
    expect(run(new Glimmer(), 20, [1, 2], () => false).every(([, idx, a]) => idx === -1 && a === 0)).toBe(true)
    expect(run(new Glimmer(), 20, []).every(([, idx]) => idx === -1)).toBe(true)
    // semua fakta ketemu di detik 10: kilau yang sedang jalan selesai, sesudahnya tidak ada lagi
    const log = run(new Glimmer(), 30, (t) => (t < 10 ? [1, 2, 3] : []))
    expect(log.filter(([t, idx]) => t > 10 + GLIMMER.duration + 0.05 && idx >= 0).length).toBe(0)
  })

  it('dimatikan di tengah kilau: pudar cepat, jadwal mulai lagi dari awal', () => {
    const g = new Glimmer()
    run(g, GLIMMER.first + 0.5, [5])
    expect(g.index).toBe(5)
    run(g, GLIMMER.fadeOut + 0.05, [5], () => false)
    expect(g.index).toBe(-1)
    expect(g.amount).toBe(0)
    expect(g.wait).toBe(GLIMMER.first)
  })
})

describe('tata letak kartu dan penghitung', () => {
  const size = 12.8
  const cap = 0.698

  it('kartu dua baris: kotak cukup tinggi untuk kepala + garis + fakta, isi di dalam kotak', () => {
    const h = factCardHeight(size, cap)
    expect(h).toBeGreaterThan(cap * size * FACT_LABEL.factScale * 2)
    const L = factLabelLayout({ x: 500, y: 400, side: 1, textWidth: 180, textHeight: h, size, width: 1024, height: 768 })
    expect(L.baseline - L.top).toBeCloseTo(h)
    expect(L.top).toBeGreaterThan(L.box.y0)
    expect(L.baseline).toBeLessThan(L.box.y1)
    // tetap di dalam layar 375 x 812 untuk fakta terpanjang
    const longest = Math.max(...iglooFacts.map((f) => f.length)) * 0.6 * 12 * FACT_LABEL.factScale
    const M = factLabelLayout({ x: 300, y: 300, side: 1, textWidth: longest, textHeight: factCardHeight(12, cap), size: 12, width: 375, height: 812 })
    expect(M.box.x0).toBeGreaterThanOrEqual(FACT_LABEL.margin - 1e-9)
    expect(M.box.x1).toBeLessThanOrEqual(375 - FACT_LABEL.margin + 1e-9)
  })

  it('penghitung rata kanan di margin, sejajar tengah logo, tidak menabrak logo (1024 dan 375)', () => {
    for (const [width, logoBox, margin, s] of [
      [1024, { x: 50, y: 45, width: 160, height: 33.6 }, 50, 12.8],
      [375, { x: 25, y: 25, width: 140, height: 29.4 }, 25, 12],
    ]) {
      const textWidth = 'FOUND 12/12'.length * 0.6 * s
      const rowWidth = 'ALL 12 FOUND'.length * 0.6 * s
      const L = factCounterLayout({ width, logoBox, margin, size: s, capHeight: cap, textWidth, rowWidth })
      expect(L.textX + textWidth).toBeCloseTo(width - margin)
      expect(L.rect.x1).toBeLessThanOrEqual(width)
      expect(L.rect.y0).toBeGreaterThanOrEqual(0)
      expect(L.rect.x0).toBeGreaterThan(logoBox.x + logoBox.width)
      const mid = (L.baseline - cap * s + L.tickY) / 2
      expect(mid).toBeCloseTo(logoBox.y + logoBox.height / 2)
    }
  })

  it('tanda: n sama panjang, rapat ke kanan baris', () => {
    const sp = tickSpans(12, 100, 120, 4)
    expect(sp.length).toBe(12)
    expect(sp[0][0]).toBe(100)
    expect(sp[11][1]).toBeCloseTo(220)
    const len = sp[0][1] - sp[0][0]
    for (const [a, b] of sp) expect(b - a).toBeCloseTo(len)
  })
})
