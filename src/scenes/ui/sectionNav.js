import { clamp, mod } from '../../engine/math.js'
import { SECTIONS, crystalCenter } from '../sections.js'

// Indeks section di tepi kanan (logika murni, dites di tests/scroll_ux.test.js).
// Titik istirahat tiap section diambil dari sections.js, bukan angka baru:
//   igloo    = initialAutocenter 0.495 (n 0.658, sama dengan titik istirahat intro)
//   crystals = pusat kristal pertama crystalCenter(0) = 0.25 (n 2.35)
//   entry    = finalAutocenter 0.76 (n 9.29, ruang link)

export const SECTION_JUMP = {
  base: 1.2, // detik, durasi dasar tween lompat
  perUnit: 0.3, // detik tambahan per unit scroll yang dilewati
  min: 1.8,
  max: 3.6,
}

/** Progress istirahat section (0..1) dari datanya sendiri. */
export function restProgress(section) {
  if (section.key === 'crystals') return crystalCenter(0)
  return section.finalAutocenter ?? section.initialAutocenter ?? 0.5
}

/**
 * Titik istirahat tiap section dalam n global (0..total).
 * @param {{key:string,height:number,initialAutocenter?:number,finalAutocenter?:number}[]} sections
 */
export function sectionRests(sections = SECTIONS) {
  let top = 0
  const out = sections.map((s) => {
    const n = top + restProgress(s) * (s.height + 1) - 1
    top += s.height
    return { key: s.key, n }
  })
  return out.map((r) => ({ ...r, n: mod(r.n, top) }))
}

/**
 * Section yang dianggap aktif dari state Scroll.map(): scene sekarang, atau scene berikutnya kalau
 * transisi sudah lewat setengah layar.
 * @returns {number} indeks section
 */
export function activeSection(state) {
  if (state.next && state.transition >= 0.5) return state.next.index
  return state.current.index
}

/**
 * Rencana lompat dari posisi n ke titik istirahat section `target`.
 * Arah dipilih supaya jalurnya tidak melewati titik istirahat section lain: 01 -> 02 maju lewat transisi
 * igloo ke kristal, 02 -> 03 maju menembus portal, 03 -> 01 maju lewat sambungan loop, dan kebalikannya mundur.
 * Kalau kedua arah sama-sama bersih (atau sama-sama melewati), ambil yang terpendek.
 * @returns {{dy:number, duration:number} | null} null kalau sudah di titik istirahat
 */
export function planSectionJump(n, target, rests, total) {
  const to = rests[target].n
  const fwd = mod(to - n, total)
  const back = mod(n - to, total)
  if (Math.min(fwd, back) < 1e-3) return null
  const eps = 1e-3
  const crosses = (dist, sign) => rests.some((r, i) => {
    if (i === target) return false
    const d = sign > 0 ? mod(r.n - n, total) : mod(n - r.n, total)
    return d > eps && d < dist - eps
  })
  const fwdClear = !crosses(fwd, 1)
  const backClear = !crosses(back, -1)
  let dy
  if (fwdClear !== backClear) dy = fwdClear ? fwd : -back
  else dy = fwd <= back ? fwd : -back
  const J = SECTION_JUMP
  return { dy, duration: clamp(J.base + J.perUnit * Math.abs(dy), J.min, J.max) }
}

/** Label tampilan: "01 IGLOO" (lebar) atau "01" (ringkas, ponsel). */
export function sectionLabel(i, label, compact = false) {
  const num = String(i + 1).padStart(2, '0')
  return compact ? num : `${num} ${label}`
}
