// Logika murni label kristal (tanpa three, dites di tests/crystals_ux.test.js):
// jadwal ajakan saat pengunjung diam, amplop animasinya, geser blok label supaya tetap di layar,
// dan uji titik di dalam kotak tombol.
//
// Masalah dari review pengunjung asli (Okt 2026): orang tidak sadar kristal bisa diklik. Jadi kalau satu
// kristal sudah di tengah (auto-center selesai) dan pengunjung tidak mengklik selama NUDGE.idle detik,
// cincin cahaya menjalar keluar dari kristal sekali dan teks kecil "CLICK THE ICE" muncul di dekat tombol.
// Diulang paling cepat tiap NUDGE.every detik, maks NUDGE.max kali per kunjungan kristal, berhenti total
// begitu satu kristal pernah dibuka di sesi ini.

export const NUDGE = {
  idle: 3, // detik diam di tengah sebelum ajakan pertama
  every: 8, // detik minimum antar awal ajakan
  max: 3, // ajakan per kunjungan kristal
  ring: 1.9, // detik cincin menjalar
  textIn: 0.2, // detik sesudah mulai, teks mulai reveal
  textOut: 3.6, // detik sesudah mulai, teks mulai pudar
  glowPeak: 0.4, // detik puncak kilau kristal (saat cincin keluar dari siluet)
  glowEnd: 1.6,
  duration: 4, // total, termasuk pudar teks
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Jadwal ajakan. Kunjungan = kristal terdekat yang sama selama scene kristal aktif. Hitungan diam mulai
 * saat kristal diam di tengah (settled), di-reset oleh klik / sentuh dan oleh scroll (settled false),
 * jumlah ajakan per kunjungan tidak di-reset oleh scroll kecil yang kembali ke kristal yang sama.
 */
export class NudgeScheduler {
  constructor(cfg = {}) {
    this.cfg = { ...NUDGE, ...cfg }
    this.opened = false
    this.visit = -1
    this.count = 0
    this.idleFrom = null
    this.lastAt = -Infinity
  }

  /**
   * @param {number} time detik
   * @param {object} o
   * @param {number} o.index kristal kunjungan sekarang, -1 = tidak ada (scene tidak aktif / detail)
   * @param {boolean} o.settled kristal itu diam tepat di tengah, tidak sedang scroll / auto-center
   * @returns {boolean} true = mulai ajakan sekarang
   */
  update(time, { index, settled }) {
    if (index !== this.visit) {
      this.visit = index
      this.count = 0
      this.idleFrom = null
      this.lastAt = -Infinity
    }
    if (this.opened || index < 0 || !settled) {
      this.idleFrom = null
      return false
    }
    if (this.idleFrom === null) this.idleFrom = time
    const c = this.cfg
    if (time - this.idleFrom < c.idle || this.count >= c.max || time - this.lastAt < c.every) return false
    this.lastAt = time
    this.count++
    return true
  }

  /** Klik / sentuh di mana pun: hitungan diam mulai lagi dari nol. */
  poke(time) {
    if (this.idleFrom !== null) this.idleFrom = time
  }

  /** Satu kristal dibuka (klik, tombol, deep link): ajakan berhenti untuk sisa sesi. */
  markOpened() {
    this.opened = true
  }
}

/**
 * Amplop satu ajakan pada detik t sejak mulai.
 * reduced = prefers-reduced-motion: tanpa cincin dan tanpa kilau, teks saja.
 * @returns {{ring: number, glow: number, text: boolean, done: boolean}} ring = progres cincin 0..1 (-1 = tidak ada)
 */
export function nudgeEnvelope(t, reduced = false, cfg = NUDGE) {
  const done = t >= cfg.duration
  const text = t >= cfg.textIn && t < cfg.textOut
  if (reduced) return { ring: -1, glow: 0, text, done }
  const ring = t >= 0 && t < cfg.ring ? t / cfg.ring : -1
  const glow = smooth(0, cfg.glowPeak, t) * (1 - smooth(cfg.glowPeak, cfg.glowEnd, t))
  return { ring, glow, text, done }
}

/**
 * Geser satu dimensi supaya rentang [lo, hi] masuk ke [min, max]. Kalau rentang lebih lebar dari ruang,
 * sisi kiri (min) yang dipertahankan, jadi awal teks tetap terbaca.
 */
export function clampShift(lo, hi, min, max) {
  if (hi - lo >= max - min) return min - lo
  if (lo < min) return min - lo
  if (hi > max) return max - hi
  return 0
}

/** Titik (x, y) di dalam kotak {x0, y0, x1, y1} yang diperbesar pad. Kotak null = tidak ada tombol. */
export function pointInRect(x, y, r, pad = 0) {
  return !!r && x >= r.x0 - pad && x <= r.x1 + pad && y >= r.y0 - pad && y <= r.y1 + pad
}
