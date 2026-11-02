// Fakta bata igloo, logika murni tanpa three (dites di tests/facts.test.js): pembagian fakta ke bata,
// hitungan fakta yang sudah dibuka, dan jadwal kilau biru ajakan.
// Titik = centroid bata ({x, y, z}) di ruang dunia.

import { mulberry32 } from '../../text/layout.js'

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2

/** Arah centroid tiap titik dari pusat kubah, di-dot dengan arah pusat ke kamera (1 = menghadap tepat). */
export function facingScores(points, view) {
  const n = points.length
  if (!n) return []
  const center = points.reduce((c, p) => ({ x: c.x + p.x / n, y: c.y + p.y / n, z: c.z + p.z / n }), { x: 0, y: 0, z: 0 })
  const unit = (v) => {
    const l = Math.hypot(v.x, v.y, v.z) || 1
    return { x: v.x / l, y: v.y / l, z: v.z / l }
  }
  const toView = unit({ x: view.x - center.x, y: view.y - center.y, z: view.z - center.z })
  return points.map((p) => {
    const d = unit({ x: p.x - center.x, y: p.y - center.y, z: p.z - center.z })
    return d.x * toView.x + d.y * toView.y + d.z * toView.z
  })
}

/**
 * Tiap fakta tepat di SATU bata (tidak ada fakta dobel, permintaan 24 Okt 2026). Urutan fakta = urutan pilih:
 * fakta pertama di bata yang paling menghadap titik pandang `view`, lalu menyebar dengan farthest point sampling
 * di antara bata yang menghadap (dot >= minFacing, lihat facingScores). Kalau fakta lebih banyak dari bata yang
 * menghadap, sisanya mengisi lapis berikutnya (ambang dot turun `step` per lapis, tetap menyebar dari semua bata
 * yang sudah terpilih) sampai bata belakang. Jadi saat jumlah fakta = jumlah bata (70, 26 Okt 2026) tiap bata
 * kebagian tepat satu fakta dan fakta awal daftar tetap di bata depan yang paling terlihat. Fakta yang sudah
 * ada tidak pindah bata kalau daftar fakta bertambah. Bata yang tidak terpilih = -1 (melayang saat hover, tanpa
 * label). Deterministik.
 * @param {{x:number,y:number,z:number}[]} points centroid bata (ruang dunia, sama dengan view)
 * @param {{x:number,y:number,z:number}} view posisi kamera di titik istirahat
 * @returns {number[]} indeks fakta per titik, -1 kalau bata tanpa fakta
 */
export function assignUniqueFacts(points, factCount, view, { minFacing = 0.5, step = 0.1 } = {}) {
  const out = points.map(() => -1)
  if (!factCount || !points.length) return out
  const n = points.length
  const facing = facingScores(points, view)
  const want = Math.min(factCount, n)
  const chosen = []
  const taken = new Uint8Array(n)
  const gap = new Array(n).fill(Infinity) // jarak kuadrat ke bata terpilih terdekat
  const take = (i) => {
    chosen.push(i)
    taken[i] = 1
    for (let k = 0; k < n; k++) gap[k] = Math.min(gap[k], dist2(points[k], points[i]))
  }
  for (let tier = 0; chosen.length < want; tier++) {
    const min = minFacing - tier * step
    // lapis terakhir (ambang di bawah -1) = semua bata yang tersisa
    const cand = []
    for (let i = 0; i < n; i++) if (!taken[i] && (min <= -1 || facing[i] >= min)) cand.push(i)
    if (!cand.length) continue
    if (!chosen.length) take(cand.reduce((a, b) => (facing[b] > facing[a] ? b : a)))
    while (chosen.length < want) {
      let best = -1
      for (const i of cand) {
        if (taken[i]) continue
        if (best < 0 || gap[i] > gap[best] + 1e-9) best = i
      }
      if (best < 0) break
      take(best)
    }
  }
  chosen.forEach((i, f) => (out[i] = f))
  return out
}

/** Nomor fakta untuk kepala kartu: (3, 12) -> '03/12'. Lebar digit ikut total, minimal 2. */
export function factNumber(n, total) {
  const w = Math.max(2, String(total).length)
  return `${String(n).padStart(w, '0')}/${String(total).padStart(w, '0')}`
}

/**
 * Teks penghitung fakta: 'FOUND 3/12', setelah semua ketemu 'ALL 12 FOUND'.
 * Cuma dipakai FactCounter.js, yang sejak 26 Okt 2026 tidak dipasang lagi (penghitung dibuang, file disimpan).
 * @param {{found: string, complete: string}} strings content.ui.facts, `{total}` di complete diganti jumlah fakta
 */
export function counterText(count, total, strings) {
  if (total > 0 && count >= total) return strings.complete.replace('{total}', String(total))
  return `${strings.found} ${count}/${total}`
}

/**
 * Fakta yang sudah dibuka pengunjung (kartu tampil cukup lama, sesi saja, tanpa storage). Tiap fakta dihitung
 * sekali. Dipakai untuk menghentikan kilau ajakan (glimmerCandidates).
 */
export class FactTracker {
  constructor(total) {
    this.total = total
    this.found = new Set()
    this.completed = false
  }

  get count() {
    return this.found.size
  }

  has(fact) {
    return this.found.has(fact)
  }

  /**
   * Tandai fakta ke-`fact` (0..total-1) sudah ditemukan.
   * @returns {{isNew: boolean, count: number, total: number, justCompleted: boolean}}
   *   justCompleted true tepat sekali, saat fakta terakhir ditemukan
   */
  mark(fact) {
    const total = this.total
    if (!(fact >= 0 && fact < total) || this.found.has(fact)) return { isNew: false, count: this.count, total, justCompleted: false }
    this.found.add(fact)
    const justCompleted = !this.completed && this.found.size >= total
    if (justCompleted) this.completed = true
    return { isNew: true, count: this.count, total, justCompleted }
  }
}

// Kilau biru ajakan: tiap 3 sampai 5 detik (jarak antar awal kilau, acak deterministik) satu bata acak menyala
// biru dari dalam selama `duration`, naik turun halus, mengajak pengunjung meng-hover bata. first = jeda kilau
// pertama setelah hover aktif, fadeOut = detik pudar kalau hover dimatikan di tengah kilau (scroll pergi, detail
// dibuka). stopAfter (26 Okt 2026): kilau berhenti untuk sesi ini setelah pengunjung membuka sekian kartu fakta
// berbeda. Dulu kilau menandai "fakta yang belum ketemu", tapi nanti tiap bata punya fakta, jadi itu tidak bermakna.
export const GLIMMER = { first: 1.6, minGap: 3, maxGap: 5, duration: 1.3, fadeOut: 0.25, seed: 2026, stopAfter: 3 }

/**
 * Bata kandidat kilau ajakan: bata berfakta selain yang sedang di-hover dan selain yang kartunya sudah dibuka.
 * Kosong kalau pengunjung sudah membuka `stopAfter` kartu berbeda di sesi ini (ajakan selesai, kilau yang sedang
 * jalan dibiarkan selesai oleh Glimmer).
 * @param {number[]} factBricks indeks bata yang punya fakta
 * @param {{current?: number, opened?: number, isOpened?: (brick: number) => boolean, stopAfter?: number}} [o]
 *   current = bata yang di-hover (-1 tidak ada), opened = jumlah kartu fakta berbeda yang sudah dibuka
 */
export function glimmerCandidates(factBricks, { current = -1, opened = 0, isOpened = () => false, stopAfter = GLIMMER.stopAfter } = {}) {
  if (opened >= stopAfter) return []
  return factBricks.filter((i) => i !== current && !isOpened(i))
}

/** Selubung kilau untuk t 0..1: 0 -> 1 -> 0 lewat sin kuadrat (masuk dan keluar halus), 0 di luar rentang. */
export const glimmerEnvelope = (t) => (t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t) ** 2)

/** Penjadwal kilau (logika murni). update() tiap frame, baca .index (bata, -1 = tidak ada) dan .amount (0..1). */
export class Glimmer {
  constructor(o = {}) {
    this.o = { ...GLIMMER, ...o }
    this.rand = mulberry32(this.o.seed)
    this.index = -1
    this.amount = 0
    this.t = 0 // detik sejak kilau sekarang mulai
    this.wait = this.o.first // detik sampai kilau berikutnya boleh mulai
    this.last = -1 // bata kilau terakhir, tidak dipilih dua kali berturut-turut kalau ada pilihan lain
  }

  /**
   * @param {number} dt detik
   * @param {boolean} enabled boleh berkilau sekarang (sama dengan syarat hover fakta: titik istirahat, bukan intro)
   * @param {number[]} candidates indeks bata yang boleh berkilau (glimmerCandidates), kosong = tidak ada kilau baru
   */
  update(dt, enabled, candidates) {
    const o = this.o
    if (!enabled) {
      // pudar cepat lalu jadwal diulang dari awal, kilau berikutnya menunggu `first` lagi
      this.amount = Math.max(0, this.amount - dt / o.fadeOut)
      if (this.amount <= 0) this.index = -1
      this.wait = o.first
      return this
    }
    if (this.index >= 0) {
      this.t += dt
      const k = this.t / o.duration
      this.amount = glimmerEnvelope(k)
      if (k >= 1) {
        this.index = -1
        this.amount = 0
      }
    }
    this.wait -= dt
    if (this.wait <= 0 && this.index < 0 && candidates.length) {
      const pool = candidates.length > 1 ? candidates.filter((i) => i !== this.last) : candidates
      this.index = this.last = pool[Math.min(pool.length - 1, Math.floor(this.rand() * pool.length))]
      this.t = 0
      this.amount = 0
      this.wait = o.minGap + (o.maxGap - o.minGap) * this.rand()
    }
    return this
  }
}
