import { describe, it, expect } from 'vitest'
import { assignUniqueFacts } from '../src/scenes/igloo/facts.js'
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
