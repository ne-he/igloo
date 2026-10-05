import { clamp } from '../engine/math.js'

// Urutan dan tinggi section (blueprint 6.2). Data murni, dipakai Scroll dan test.
export const CRYSTAL_COUNT = 3

/** Progress tengah kristal ke-t: (1 + t) / (jumlah + 1). Tinggi scene kristal = jumlah kristal. */
export const crystalCenter = (t, count = CRYSTAL_COUNT) => (1 + t) / (count + 1)

export const SECTIONS = [
  {
    key: 'igloo',
    height: 2.35,
    initialAutocenter: 0.495,
    finalAutocenter: 0.495,
    // igloo tidak punya autoCenter di dalam scene
  },
  {
    key: 'crystals',
    height: CRYSTAL_COUNT,
    autoCenter(progress) {
      let best = crystalCenter(0)
      for (let t = 1; t < CRYSTAL_COUNT; t++) {
        const c = crystalCenter(t)
        if (Math.abs(c - progress) < Math.abs(best - progress)) best = c
      }
      return { progress: best, duration: (dn) => clamp(dn * 6, 1.6, 2.4) }
    },
  },
  {
    key: 'entry',
    height: 5.5,
    initialAutocenter: 0.2,
    finalAutocenter: 0.76,
    autoCenter(progress) {
      if (progress <= 0.15) return null
      return { progress: 0.76, duration: (dn) => clamp(dn * 4, 2, 20) }
    },
  },
]
