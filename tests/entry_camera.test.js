import { describe, it, expect } from 'vitest'
import gsap from 'gsap'
import { CustomEase } from 'gsap/CustomEase'
import {
  CameraFollow, ringCenterWeight, buildCameraTimeline, initialCameraState, RING_Y, RING_CENTER, CAMERA_SMOOTH,
} from '../src/scenes/entry/timeline.js'
import { lerpFPS } from '../src/engine/math.js'

// ease yang didaftarkan Engine.js (timeline entry memakai inOut2)
gsap.registerPlugin(CustomEase)
CustomEase.create('inOut2', 'M0,0 C0.56,0 0,1 1,1')

/** Offset lateral kamera saat y-nya memotong y tiap cincin (interpolasi linear antar frame). */
function ringOffsets(rec) {
  return RING_Y.map((ry) => {
    for (let i = 1; i < rec.length; i++) {
      const a = rec[i - 1]
      const b = rec[i]
      if (a.y > ry && b.y <= ry) {
        const t = (a.y - ry) / (a.y - b.y)
        return Math.hypot(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)
      }
    }
    return NaN
  })
}

/**
 * Scroll dengan laju progress tetap (per detik, 60 fps) dari p0 sampai pStop, lalu diam.
 * mode 'follow' = CameraFollow (sekarang), 'lerp3d' = model lama (posisi 3D di-lerp 0.02 ke titik timeline).
 */
function simulate(speed, mode, { p0 = 0, pStop = 0.6, seconds = 12 } = {}) {
  const follow = new CameraFollow()
  const raw = initialCameraState()
  const tl = buildCameraTimeline(raw)
  const cam = { x: 0, y: 0, z: 0 }
  const rec = []
  let p = p0
  for (let i = 0; i < seconds * 60; i++) {
    p = Math.min(pStop, p + speed / 60)
    if (mode === 'follow') {
      follow.update(p, 1, i === 0)
      rec.push({ ...follow.position })
    } else {
      tl.progress(p)
      const k = i === 0 ? 1 : 1 - Math.pow(1 - CAMERA_SMOOTH.position, 1)
      cam.x += (raw.px - cam.x) * k
      cam.y += (raw.py - cam.y) * k
      cam.z += (raw.pz - cam.z) * k
      rec.push({ ...cam })
    }
  }
  return rec
}

describe('kamera entry lewat poros cincin (tools/verify/entry_portal.py)', () => {
  it('bobot pemusat 0 di bidang cincin, 1 jauh dari cincin', () => {
    for (const y of RING_Y) expect(ringCenterWeight(y)).toBe(0)
    expect(ringCenterWeight(RING_Y[0] + RING_CENTER.inner * 0.5)).toBe(0)
    expect(ringCenterWeight(RING_Y[1] - RING_CENTER.outer)).toBe(1)
    expect(ringCenterWeight(1.5)).toBe(1)
    expect(ringCenterWeight(-9.83)).toBe(1)
  })

  it('model lama (lerp 3D) memang memotong tikungan saat scroll cepat (bug yang dilaporkan)', () => {
    const off = ringOffsets(simulate(0.4, 'lerp3d'))
    // lubang cincin r 0.27: model lama lewat di luar lubang di ketiga cincin
    for (const o of off) expect(o).toBeGreaterThan(0.5)
  })

  it.each([0.03, 0.05, 0.11, 0.25, 0.4, 0.7, 1.5])('laju %f progress/s: kamera lewat tengah ketiga cincin', (speed) => {
    // cukup lama sampai kamera (yang tertinggal) melewati cincin 3
    const off = ringOffsets(simulate(speed, 'follow', { seconds: Math.ceil(0.6 / speed) + 8 }))
    for (const o of off) {
      expect(Number.isNaN(o)).toBe(false)
      expect(o).toBeLessThan(0.01)
    }
  })

  it('frame rate bebas: 30 fps dan 144 fps memberi progress kamera yang sama', () => {
    const run = (fps) => {
      const f = new CameraFollow()
      f.update(0.2, 1, true)
      const ratio = 60 / fps
      for (let i = 0; i < fps * 2; i++) f.update(0.5, ratio)
      return f.pPosition
    }
    expect(Math.abs(run(30) - run(144))).toBeLessThan(1e-9)
  })

  it('rasa scroll normal tetap: lag progress sama dengan faktor asli 0.02, y kamera dekat model lama', () => {
    // laju auto-center / scroll pelan: jalur y baru menyimpang paling banyak 0.2 unit dari model lama
    const a = simulate(0.05, 'follow', { p0: 0.2, pStop: 0.76, seconds: 14 })
    const b = simulate(0.05, 'lerp3d', { p0: 0.2, pStop: 0.76, seconds: 14 })
    let worst = 0
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i].y - b[i].y))
    expect(worst).toBeLessThan(0.2)
    // keduanya tiba di titik istirahat ruang yang sama
    expect(Math.abs(a.at(-1).y - b.at(-1).y)).toBeLessThan(0.02)
    expect(Math.abs(a.at(-1).z - b.at(-1).z)).toBeLessThan(0.02)
    // progress kamera tertinggal persis seperti lerpFPS 0.02
    const f = new CameraFollow()
    f.update(0.3, 1, true)
    f.update(0.4, 1)
    expect(f.pPosition).toBeCloseTo(lerpFPS(0.3, 0.4, CAMERA_SMOOTH.position, 1), 12)
  })

  it('snap lompat langsung ke progress (scene baru terlihat)', () => {
    const f = new CameraFollow()
    f.update(0.1, 1, true)
    f.update(0.76, 1, true)
    expect(f.pPosition).toBe(0.76)
    expect(f.pTarget).toBe(0.76)
    expect(f.position.y).toBeCloseTo(-9.81, 1)
  })
})
