import gsap from 'gsap'

// Timeline kamera scene entry (skill ref 01 bagian 4.2, blueprint 5.5). Total 9.2 s, di-scrub oleh progress scene:
// detik timeline = progress * 9.2. Data murni + gsap, tanpa three, supaya gampang dicek.
export const TIMELINE_DURATION = 9.2

// Cincin di y -1.65 / -4.15 / -6.65, forcefield sedikit di atasnya (y -1.5 / -4 / -6.5).
export const RING_Y = [-1.65, -4.15, -6.65]
export const FORCEFIELD_Y = [-1.5, -4, -6.5]
// Cincin (+ asap trail/plasma) tampil selama progress di bawah angka ini (data asli).
export const RING_HIDE = [0.34, 0.43, 0.52]
// Jendela tampil forcefield cincin (data asli).
export const FORCEFIELD_WINDOWS = [[0.1, 0.34], [0.25, 0.43], [0.36, 0.52]]
// Glitch lewat cincin: uRingProximity 0 -> 1 -> 0 di sekitar detik timeline ini (data asli).
export const GLITCH_TIMES = [2.0, 2.95, 3.8]
// Terowongan asap tampil selama progress di bawah 0.52 (data asli).
export const TUNNEL_HIDE = 0.52

/**
 * Ease monoton lewat titik (x, y) dengan kemiringan 0 di kedua ujung (Fritsch-Carlson).
 * Dipakai untuk entry_ease_3 yang kurvanya tidak diketahui [?]: dipaksa lewat titik yang DITURUNKAN dari data,
 * yaitu bunyi portal memuncak di progress 0.28 / 0.375 / 0.465 = saat kamera tepat di y cincin, plus satu titik
 * dari ref 13 (diambil di istirahat 0.2): cincin 1 r 0.4 mengisi ~0.93 setengah tinggi layar dan cincin 2 ~0.43,
 * dua-duanya memberi jarak kamera ke cincin 1 sekitar 2.2, jadi kamera y ~0.55 di progress 0.2.
 */
export function monotoneEase(xs, ys) {
  const n = xs.length
  const d = []
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]))
  const m = new Array(n).fill(0)
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) continue
    const h0 = xs[i] - xs[i - 1]
    const h1 = xs[i + 1] - xs[i]
    m[i] = (3 * (h0 + h1)) / ((2 * h1 + h0) / d[i - 1] + (h1 + 2 * h0) / d[i])
  }
  return (t) => {
    if (t <= xs[0]) return ys[0]
    if (t >= xs[n - 1]) return ys[n - 1]
    let i = 0
    while (t > xs[i + 1]) i++
    const h = xs[i + 1] - xs[i]
    const s = (t - xs[i]) / h
    const s2 = s * s
    const s3 = s2 * s
    return (2 * s3 - 3 * s2 + 1) * ys[i] + (s3 - 2 * s2 + s) * h * m[i] +
      (-2 * s3 + 3 * s2) * ys[i + 1] + (s3 - s2) * h * m[i + 1]
  }
}

const CAM_Y0 = 1.5
const CAM_Y1 = -9.83
const DIVE_START = 0.2
const DIVE_DUR = 7
const REST_P = 0.2 // istirahat awal scene (sections.js initialAutocenter)
const REST_Y = 0.55 // turunan ref 13, lihat monotoneEase
/** Titik lewat cincin -> titik ease (waktu ternormalisasi tween turun, fraksi jarak turun). */
function diveKnots() {
  const xs = [0, (REST_P * TIMELINE_DURATION - DIVE_START) / DIVE_DUR]
  const ys = [0, (CAM_Y0 - REST_Y) / (CAM_Y0 - CAM_Y1)]
  ;[0.28, 0.375, 0.465].forEach((p, i) => {
    xs.push((p * TIMELINE_DURATION - DIVE_START) / DIVE_DUR)
    ys.push((CAM_Y0 - RING_Y[i]) / (CAM_Y0 - CAM_Y1))
  })
  xs.push(1)
  ys.push(1)
  return [xs, ys]
}
export const entryEase3 = monotoneEase(...diveKnots())

/**
 * Bangun timeline gsap (paused) yang menggerakkan objek state kamera.
 * Ease entry_ease / entry_ease_2 asli tidak diketahui [?]: diganti inOut2 (CustomEase yang didaftarkan Engine).
 * Target y: urutan -10 -> -9.81 -> -10.35 asli, tapi jadwal persisnya tidak tercatat [?]. Dipilih supaya
 * di titik istirahat 0.76 pandangan datar ke partikel (ref 14): -10 di detik 6.2, -9.81 di 7.2, -10.35 di 9.2.
 */
export function buildCameraTimeline(state) {
  const ease = 'inOut2'
  // overwrite false: default global Engine 'auto' bisa membunuh tween properti yang sama saat di-scrub mundur
  return gsap.timeline({ paused: true, defaults: { overwrite: false } })
    // posisi: (0, 1.5, -2) -> x,z 0 dalam 2.5 s, y -> -9.83 dalam 7 s dari 0.2, z -> -1.5 (3.5..7.2) -> -3 (7.2..9.2)
    .fromTo(state, { pz: -2 }, { pz: 0, duration: 2.5, ease: 'power2.inOut', immediateRender: false }, 0)
    .fromTo(state, { py: CAM_Y0 }, { py: CAM_Y1, duration: DIVE_DUR, ease: entryEase3, immediateRender: false }, DIVE_START)
    .fromTo(state, { pz: 0 }, { pz: -1.5, duration: 3.7, ease, immediateRender: false }, 3.5)
    .fromTo(state, { pz: -1.5 }, { pz: -3, duration: 2, ease: 'power2.inOut', immediateRender: false }, 7.2)
    // target: (0, -2.5, -1) -> y -10 -> -9.81 -> -10.35, z -> 0 bersamaan dengan kamera mundur
    .fromTo(state, { ty: -2.5 }, { ty: -10, duration: 6.0, ease: entryEase3, immediateRender: false }, DIVE_START)
    .fromTo(state, { ty: -10 }, { ty: -9.81, duration: 1.0, ease: 'power1.inOut', immediateRender: false }, 6.2)
    .fromTo(state, { ty: -9.81 }, { ty: -10.35, duration: 1.0, ease: 'power2.inOut', immediateRender: false }, 8.2)
    // target z -> 0 bersama posisi (2.5 s): tidak tercatat di data [?], tapi ref 13 (istirahat 0.2) menatap
    // tepat ke pusat cincin, jadi arah pandang sudah tegak lurus di sana
    .fromTo(state, { tz: -1 }, { tz: 0, duration: 2.5, ease: 'power2.inOut', immediateRender: false }, 0)
    // fov 22 -> 30 dalam 7.2 s
    .fromTo(state, { fov: 22 }, { fov: 30, duration: 7.2, ease: 'power2.inOut', immediateRender: false }, 0)
    // up (0,0,-1) diputar di Y 0 -> PI (5.25 s dari detik 1, power3.inOut), lalu dibaurkan ke +Y (3.7 s dari 3.5)
    .fromTo(state, { upRotation: 0 }, { upRotation: Math.PI, duration: 5.25, ease: 'power3.inOut', immediateRender: false }, 1)
    .fromTo(state, { upOriginal: 0 }, { upOriginal: 1, duration: 3.7, ease, immediateRender: false }, 3.5)
    // parallax mouse (0.01, 0.005) -> 0 di detik 4 (mulai turunnya tidak tercatat [?], dipilih 2.5)
    .fromTo(state, { dx: 0.01, dy: 0.005 }, { dx: 0, dy: 0, duration: 1.5, ease: 'power1.inOut', immediateRender: false }, 2.5)
}

export function initialCameraState() {
  return { px: 0, py: CAM_Y0, pz: -2, tx: 0, ty: -2.5, tz: -1, fov: 22, upRotation: 0, upOriginal: 0, dx: 0.01, dy: 0.005 }
}

/**
 * Kilat glitch: 0 jauh dari detik glitch, 1 tepat di detiknya, lebar +-0.15 detik timeline (lebar asli tidak
 * tercatat [?]). Harus nol di titik istirahat 0.2 (detik 1.84), kalau tidak frame istirahat ikut ter-blur.
 */
export function ringProximity(t, width = 0.15) {
  let v = 0
  for (const g of GLITCH_TIMES) {
    const x = Math.min(1, Math.abs(t - g) / width)
    v = Math.max(v, 1 - x * x * (3 - 2 * x))
  }
  return v
}

/** Jendela tampil dengan tepi lembut (fade masuk/keluar selebar `soft` progress). */
export function windowShow(p, a, b, soft = 0.025) {
  const s = (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)
  }
  return s(a, a + soft, p) * (1 - s(b - soft, b, p))
}
