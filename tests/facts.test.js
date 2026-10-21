import { describe, it, expect } from 'vitest'
import { assignFacts, brickNeighbors } from '../src/scenes/igloo/facts.js'
import { factLabelLayout, FACT_LABEL } from '../src/scenes/ui/FactLabel.js'
import { iglooFacts } from '../src/content/content.js'

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
  it('daftar fakta: 13 item, ASCII cetak saja, pendek, tidak ada duplikat', () => {
    expect(iglooFacts.length).toBe(13)
    expect(new Set(iglooFacts).size).toBe(iglooFacts.length)
    for (const f of iglooFacts) {
      expect(f).toMatch(/^[\x20-\x7e]+$/)
      expect(f.length).toBeLessThanOrEqual(24)
    }
  })

  it('tetangga simetris dan tidak memuat diri sendiri', () => {
    const pts = dome()
    const nb = brickNeighbors(pts, 6)
    nb.forEach((list, i) => {
      expect(list).not.toContain(i)
      expect(list.length).toBeGreaterThanOrEqual(6)
      for (const j of list) expect(nb[j]).toContain(i)
    })
  })

  it('70 bata: semua dapat fakta, tetangga selalu beda, semua fakta terpakai rata', () => {
    const pts = dome()
    expect(pts.length).toBe(70)
    const out = assignFacts(pts, iglooFacts.length)
    const nb = brickNeighbors(pts, 6)
    out.forEach((f, i) => {
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThan(iglooFacts.length)
      for (const j of nb[i]) expect(out[j]).not.toBe(f)
    })
    const counts = new Array(iglooFacts.length).fill(0)
    for (const f of out) counts[f]++
    expect(Math.min(...counts)).toBeGreaterThanOrEqual(4) // 70 / 13 = 5.4
    expect(Math.max(...counts)).toBeLessThanOrEqual(7)
  })

  it('deterministik dan aman untuk daftar kosong / fakta lebih sedikit dari tetangga', () => {
    const pts = dome()
    expect(assignFacts(pts, 13)).toEqual(assignFacts(pts, 13))
    expect(assignFacts(pts, 0).every((f) => f === -1)).toBe(true)
    const two = assignFacts(pts, 2)
    expect(two.every((f) => f === 0 || f === 1)).toBe(true)
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
