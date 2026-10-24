// Logika murni petunjuk scroll (dites di tests/scroll_ux.test.js): kapan kamera "mengintip" ke depan, dan kapan
// cue SCROLL TO ENTER terlihat. Tanpa three, tanpa gsap, tanpa DOM. Waktu dalam detik engine (gsap.ticker).
//
// Latar belakang (review pengguna Okt 2026): banyak orang tidak sadar situs ini di-scroll, cuma klik-klik igloo.
// Jadi setelah intro UI selesai: cue di tengah bawah, dan kalau 6 s belum ada scroll sama sekali, scroll maju
// sedikit lalu kembali (paling banyak 2 kali per sesi).

export const PEEK = {
  firstDelay: 6, // detik sesudah intro UI selesai sampai peek pertama
  gap: 9, // detik sesudah peek pertama selesai sampai peek kedua
  max: 2, // paling banyak per sesi
  amount: 0.24, // unit scroll ke depan: n 0.658 -> 0.898 (progress igloo 0.495 -> 0.567), transisi baru mulai di 1.35
  out: 1.15, // detik maju (sine.inOut)
  hold: 0.3, // detik diam di puncak
  back: 1.35, // detik kembali (back.out, sedikit memantul seperti pegas)
}

export class IdlePeek {
  constructor(o = PEEK) {
    this.o = o
    this.readyAt = null // waktu peek berikutnya boleh jalan (null = intro UI belum selesai)
    this.count = 0
    this.running = false
    this.cancelled = false // pengguna sudah scroll / scroll diambil alih kode lain: tidak ada peek lagi
  }

  /** Intro UI selesai pada waktu t. */
  arm(t) {
    if (this.readyAt == null) this.readyAt = t + this.o.firstDelay
  }

  /** Scroll sungguhan, lompat programatik, atau scroll dikunci debug: peek mati untuk sesi ini. */
  cancel() {
    this.cancelled = true
  }

  /**
   * Boleh mulai peek sekarang? Syarat yang belum terpenuhi (detail terbuka, pointer ditekan, scroll terkunci)
   * hanya menunda, peek jalan begitu syaratnya bersih lagi.
   * @param {number} t
   * @param {{enabled:boolean, atRest:boolean, detail?:boolean, reduced?:boolean, intro?:boolean, busy?:boolean}} c
   */
  due(t, c) {
    if (this.cancelled || this.running || this.readyAt == null || this.count >= this.o.max) return false
    if (!c.enabled || !c.atRest || c.detail || c.reduced || c.intro || c.busy) return false
    return t >= this.readyAt
  }

  begin() {
    this.running = true
    this.count++
  }

  /** Peek selesai (kembali ke posisi awal atau dibatalkan input) pada waktu t. */
  end(t) {
    this.running = false
    this.readyAt = t + this.o.gap
  }

  /** Lama satu peek (maju + diam + kembali), detik. */
  static span(o = PEEK) {
    return o.out + o.hold + o.back
  }
}

export const CUE = {
  leaveFar: 0.59, // unit scroll dari posisi awal: dianggap sudah pergi (angka hint lama, forensik arsitektur 2.6)
  returnNear: 0.12, // unit scroll: dianggap kembali ke posisi awal
  returnIdle: 3, // detik diam di posisi awal sebelum cue muncul lagi
}

/** Jarak melingkar posisi y ke posisi awal (scroll berulang tiap `total`). */
export function loopDistance(y, start, total) {
  const d = ((y - start) % total + total) % total
  return Math.min(d, total - d)
}

/**
 * Gerbang visibilitas cue. Cue muncul setelah intro UI, hilang di scroll sungguhan pertama, dan muncul lagi
 * hanya kalau pengguna sudah pergi (lebih dari leaveFar), kembali ke posisi awal, lalu diam returnIdle detik.
 */
export class CueGate {
  constructor(o = CUE) {
    this.o = o
    this.armed = false
    this.dismissed = false
    this.left = false
    this.idle = 0
  }

  arm() {
    this.armed = true
  }

  /** Scroll sungguhan atau lompat programatik. */
  dismiss() {
    this.dismissed = true
    this.idle = 0
  }

  /** Input apa pun (wheel, sentuh, tombol) mereset hitungan diam. */
  input() {
    this.idle = 0
  }

  /** Paksa tampil lagi (semua fakta igloo ketemu): dianggap belum pernah scroll. */
  show() {
    this.dismissed = false
    this.left = false
  }

  /**
   * @param {number} dt detik
   * @param {{dist:number, inIgloo:boolean, moving:boolean, detail?:boolean}} c
   * @returns {boolean} cue terlihat
   */
  update(dt, c) {
    if (!this.armed) return false
    if (c.dist > this.o.leaveFar || !c.inIgloo) this.left = true
    this.idle = c.moving ? 0 : this.idle + dt
    if (this.dismissed && this.left && c.inIgloo && c.dist < this.o.returnNear && this.idle >= this.o.returnIdle) {
      this.dismissed = false
      this.left = false
    }
    return !this.dismissed && c.inIgloo && !c.detail
  }
}
