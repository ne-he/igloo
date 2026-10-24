import { describe, it, expect } from 'vitest'
import { NudgeScheduler, NUDGE, nudgeEnvelope, clampShift, pointInRect } from '../src/scenes/crystals/nudge.js'
import { labelEmPx, dateText, LABEL_PX } from '../src/scenes/crystals/Labels.js'
import content from '../src/content/content.js'

// Jalankan jadwal ajakan per 1/60 s dari t0 sampai t1, kembalikan waktu tiap ajakan mulai.
function run(s, t0, t1, state) {
  const fired = []
  for (let t = t0; t <= t1 + 1e-9; t += 1 / 60) {
    const st = typeof state === 'function' ? state(t) : state
    if (s.update(t, st)) fired.push(t)
  }
  return fired
}

describe('jadwal ajakan klik kristal', () => {
  it('ajakan pertama sesudah diam 3 s di tengah, lalu paling cepat tiap 8 s, maks 3 per kunjungan', () => {
    const s = new NudgeScheduler()
    const fired = run(s, 0, 60, { index: 1, settled: true })
    expect(fired.length).toBe(NUDGE.max)
    expect(fired[0]).toBeCloseTo(NUDGE.idle, 1)
    expect(fired[1] - fired[0]).toBeGreaterThanOrEqual(NUDGE.every - 1e-6)
    expect(fired[1] - fired[0]).toBeLessThan(NUDGE.every + 0.05)
    expect(fired[2] - fired[1]).toBeGreaterThanOrEqual(NUDGE.every - 1e-6)
  })

  it('tidak ada ajakan selama scroll / belum diam, hitungan diam mulai lagi sesudahnya', () => {
    const s = new NudgeScheduler()
    // scroll terus 0..10 s, diam mulai 10 s
    const fired = run(s, 0, 20, (t) => ({ index: 1, settled: t >= 10 }))
    expect(fired.length).toBe(1)
    expect(fired[0]).toBeCloseTo(10 + NUDGE.idle, 1)
  })

  it('kunjungan kristal baru = jatah baru, scroll kecil ke kristal yang sama tidak mereset jatah', () => {
    const s = new NudgeScheduler()
    run(s, 0, 30, { index: 0, settled: true })
    expect(s.count).toBe(3)
    // geser sedikit lalu balik ke kristal 0: masih kunjungan yang sama, tidak ada ajakan lagi
    expect(run(s, 30, 31, { index: 0, settled: false }).length).toBe(0)
    expect(run(s, 31, 50, { index: 0, settled: true }).length).toBe(0)
    // pindah ke kristal 2
    const fired = run(s, 50, 65, { index: 2, settled: true })
    expect(fired.length).toBe(2) // 53 dan 61
    expect(fired[0]).toBeCloseTo(50 + NUDGE.idle, 1)
    expect(s.count).toBe(2)
  })

  it('klik / sentuh mereset hitungan diam', () => {
    const s = new NudgeScheduler()
    const fired = []
    for (let t = 0; t <= 6; t += 1 / 60) {
      if (Math.abs(t - 2) < 1 / 120) s.poke(t)
      if (s.update(t, { index: 1, settled: true })) fired.push(t)
    }
    expect(fired.length).toBe(1)
    expect(fired[0]).toBeCloseTo(2 + NUDGE.idle, 1)
  })

  it('sesudah satu kristal dibuka, ajakan berhenti untuk sisa sesi', () => {
    const s = new NudgeScheduler()
    s.markOpened()
    expect(run(s, 0, 40, { index: 1, settled: true }).length).toBe(0)
    expect(run(s, 40, 80, { index: 2, settled: true }).length).toBe(0)
  })

  it('amplop: cincin dan kilau hanya tanpa reduced motion, teks tampil di kedua mode', () => {
    const a = nudgeEnvelope(0.5)
    expect(a.ring).toBeGreaterThan(0)
    expect(a.glow).toBeGreaterThan(0.5)
    expect(a.text).toBe(true)
    const r = nudgeEnvelope(0.5, true)
    expect(r.ring).toBe(-1)
    expect(r.glow).toBe(0)
    expect(r.text).toBe(true)
    expect(nudgeEnvelope(NUDGE.ring + 0.01).ring).toBe(-1)
    expect(nudgeEnvelope(NUDGE.textOut + 0.01).text).toBe(false)
    expect(nudgeEnvelope(NUDGE.duration).done).toBe(true)
  })
})

describe('tata letak label kristal', () => {
  it('clampShift memasukkan rentang ke layar, rentang kebesaran menahan sisi kiri', () => {
    expect(clampShift(-5, 5, -10, 10)).toBe(0)
    expect(clampShift(8, 14, -10, 10)).toBe(-4)
    expect(clampShift(-13, -2, -10, 10)).toBe(3)
    expect(clampShift(-30, 30, -10, 10)).toBe(20)
  })

  it('pointInRect dengan pad, kotak null = tidak kena', () => {
    const r = { x0: 0, y0: 0, x1: 1, y1: 1 }
    expect(pointInRect(0.5, 0.5, r)).toBe(true)
    expect(pointInRect(1.05, 0.5, r)).toBe(false)
    expect(pointInRect(1.05, 0.5, r, 0.1)).toBe(true)
    expect(pointInRect(0.5, 0.5, null)).toBe(false)
  })

  it('tinggi em label: desktop sekitar 16 px, ponsel sempit tetap di atas 14 px', () => {
    expect(labelEmPx(1024, 768)).toBeGreaterThan(15.5)
    expect(labelEmPx(1920, 1080)).toBe(LABEL_PX.em)
    expect(labelEmPx(375, 812)).toBe(LABEL_PX.narrow)
    expect(labelEmPx(375, 600)).toBeGreaterThanOrEqual(LABEL_PX.min)
  })

  it('baris tanggal tanpa CLICK TO EXPLORE, teks tombol dan ajakan ASCII cetak saja', () => {
    expect(dateText('17/10/2026')).toBe('D 17.10.2026')
    const ui = content.ui.crystal
    for (const k of ['open', 'nudge', 'nudgeTouch']) expect(ui[k]).toMatch(/^[ -~]+$/)
    expect(ui.open).toBe('[ OPEN ]')
  })
})
