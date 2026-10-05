import { describe, it, expect } from 'vitest'
import { Scroll, SCROLL } from '../src/engine/Scroll.js'
import { SECTIONS } from '../src/scenes/sections.js'

const make = () => new Scroll(SECTIONS)
const close = (a, b, eps = 1e-3) => expect(Math.abs(a - b)).toBeLessThan(eps)

describe('pemetaan scroll ke scene (blueprint tabel 6.2)', () => {
  const s = make()

  it('total tinggi 10.85', () => close(s.total, 10.85, 1e-9))

  it('igloo istirahat di n = 0.658 -> progress 0.495', () => {
    const m = s.map(0.658)
    expect(m.current.key).toBe('igloo')
    close(m.current.progress, 0.495)
    expect(m.next).toBeNull()
  })

  it('igloo saja sampai n = 1.35', () => {
    expect(s.map(1.35).next).toBeNull()
    expect(s.map(1.36).next.key).toBe('crystals')
  })

  it('transisi igloo ke kristal di n = 1.85 -> uProgress 0.5', () => {
    const m = s.map(1.85)
    expect(m.current.key).toBe('igloo')
    expect(m.next.key).toBe('crystals')
    close(m.transition, 0.5)
  })

  it('kristal di tengah pada n = 2.35 / 3.35 / 4.35 -> progress 0.25 / 0.5 / 0.75', () => {
    close(s.map(2.35).current.progress, 0.25)
    close(s.map(3.35).current.progress, 0.5)
    close(s.map(4.35).current.progress, 0.75)
    expect(s.map(4.35).next).toBeNull()
  })

  it('entry istirahat 0.2 di n = 5.65 dan 0.76 di n = 9.29', () => {
    close(s.map(5.65).current.progress, 0.2)
    close(s.map(9.29).current.progress, 0.76)
  })

  it('loop: entry ke igloo di n = 10.35, uProgress 0.5', () => {
    const m = s.map(10.35)
    expect(m.current.key).toBe('entry')
    expect(m.next.key).toBe('igloo')
    close(m.transition, 0.5)
  })

  it('posisi negatif dan lewat total dibungkus modulo', () => {
    close(s.map(-10.85 + 0.658).current.progress, 0.495)
    close(s.map(10.85 * 3 + 3.35).current.progress, 0.5)
  })

  it('progress scene berikutnya bersambung mulus dengan progress saat jadi current', () => {
    const before = s.map(2.3499).next.progress
    const after = s.map(2.35).current.progress
    close(before, after, 1e-3)
  })
})

describe('integrasi damping', () => {
  it('target2 tidak boleh mendahului y lebih dari 0.5625', () => {
    const s = make()
    s.enabled = true
    s.addDelta(5, 0)
    s.update(1, 16)
    expect(s.target2 - s.y).toBeLessThanOrEqual(SCROLL.lead + 1e-9)
  })

  it('satu notch wheel (100 px) menggeser 0.075 unit dan y akhirnya mengejar', () => {
    const s = make()
    s.enabled = true
    s.addDelta(100 * SCROLL.wheel, 0)
    for (let i = 0; i < 600; i++) s.update(1, 16 * i)
    close(s.y, 0.075, 1e-6)
  })

  it('frame-rate independent: 1 detik di 60 fps vs 144 fps hasilnya mirip', () => {
    const run = (fps) => {
      const s = make()
      s.enabled = true
      s.addDelta(0.4, 0)
      const ratio = 60 / fps
      for (let i = 0; i < fps; i++) s.update(ratio, 0)
      return s.y
    }
    close(run(60), run(144), 0.02)
  })
})

describe('auto-center (blueprint 6.3)', () => {
  const s = make()

  it('diam di n = 1.9 (lebih dekat ke kristal) -> meluncur ke 2.35 dalam 2 s', () => {
    const p = s.planAutoCenter(1.9)
    close(1.9 + p.dy, 2.35)
    close(p.duration, 2)
  })

  it('diam di n = 1.6 (lebih dekat ke igloo) -> mundur lalu dorong ke istirahat igloo 0.658', () => {
    const p = s.planAutoCenter(1.6)
    close(1.6 + p.dy, 0.658)
    expect(p.duration).toBeGreaterThan(3.3)
    expect(p.duration).toBeLessThan(3.5)
  })

  it('maju dari kristal ke entry -> mendarat di progress 0.2 (n = 5.65), sekitar 2.6 s', () => {
    const p = s.planAutoCenter(5.0)
    close(5.0 + p.dy, 5.65)
    close(p.duration, 2.6, 1e-3)
  })

  it('loop maju dari entry ke igloo -> mendarat di 0.658 (+ total)', () => {
    const p = s.planAutoCenter(10.5)
    close((10.5 + p.dy) % s.total, 0.658)
  })

  it('di dalam kristal -> pusat kristal terdekat, durasi 1.6 sampai 2.4 s', () => {
    const p = s.planAutoCenter(3.1)
    close(3.1 + p.dy, 3.35)
    expect(p.duration).toBeGreaterThanOrEqual(1.6)
    expect(p.duration).toBeLessThanOrEqual(2.4)
  })

  it('entry progress > 0.15 -> auto-dive ke 0.76', () => {
    const p = s.planAutoCenter(5.65)
    close(5.65 + p.dy, 9.29)
    close(p.duration, Math.min(20, Math.max(2, (9.29 - 5.65) * 4)), 1e-3)
  })

  it('di dalam igloo tidak ada auto-center', () => {
    expect(s.planAutoCenter(0.3)).toBeNull()
  })

  it('tepat di titik istirahat tidak bergerak', () => {
    const p = s.planAutoCenter(9.29)
    close(p.dy, 0)
  })
})

describe('trigger auto-center lewat update()', () => {
  it('tidak jalan sebelum diam 1.4 s, jalan sesudahnya', () => {
    const calls = []
    const s = new Scroll(SECTIONS, {
      tween: (from, to, duration) => {
        calls.push({ from, to, duration })
        return { kill() {} }
      },
    })
    s.enabled = true
    s.setN(1.9)
    s.lastInputTime = 0
    s.update(1, 1000)
    expect(calls.length).toBe(0)
    s.update(1, 1500)
    expect(calls.length).toBe(1)
    close(calls[0].to - calls[0].from, 0.45)
  })
})
