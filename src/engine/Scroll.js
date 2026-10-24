import { clamp, lerpFPS, lerpFPSLimited, frictionFPS, mod } from './math.js'

// Konstanta scroll hasil bedah igloo.inc (blueprint 6.1). Satu unit = satu tinggi layar.
export const SCROLL = {
  wheel: 0.00075, // per piksel deltaY
  key: 0.1125, // 150 * wheel
  touch: 1.25, // drag satu layar penuh = 1.25 unit
  lerp1: 0.075, // target2 -> target1
  maxStep: 0.075, // langkah maksimum target1 per frame 60 fps
  lerp2: 0.15, // target1 -> y
  lead: 0.5625, // target2 tidak boleh mendahului y lebih dari ini
  settle: 0.000075,
  velocityFriction: 0.98,
  idleMs: 1400, // auto-center setelah diam selama ini
  transitionDuration: 2, // detik, meluncur ke tepi scene
}

/**
 * Scroll virtual tanpa ujung. Logika murni (tanpa DOM, tanpa gsap) supaya bisa dites angka.
 * sections: [{ key, height, initialAutocenter?, finalAutocenter?, autoCenter?(progress) }]
 *   autoCenter(progress) -> { progress, duration } | null, dipanggil saat diam di dalam scene.
 * tween: (from, to, duration, onUpdate, onComplete) -> { kill() }, disuntik dari Engine (gsap).
 */
export class Scroll {
  constructor(sections, { tween = null } = {}) {
    let top = 0
    this.sections = sections.map((s, index) => {
      const sec = { ...s, index, top }
      top += s.height
      return sec
    })
    this.total = top
    this.tween = tween
    this.y = 0
    this.target1 = 0
    this.target2 = 0
    this.velocity = 0
    this.enabled = false
    this.lastInputTime = 0
    this.centering = null
    this.jumps = 0 // jumlah lompat langsung setN, dibaca petunjuk scroll UI untuk mengenali scroll programatik
    this.state = this.map(0)
  }

  /** Posisi global n (0..total) ke progress scene ke-i. */
  progressToN(index, progress) {
    const s = this.sections[index]
    return s.top + progress * (s.height + 1) - 1
  }

  setN(n) {
    this.jumps++
    this.stopAutoCenter()
    const offset = n - mod(this.y, this.total)
    this.y += offset
    this.target1 = this.y
    this.target2 = this.y
    this.velocity = 0
    this.state = this.map(this.y)
  }

  addDelta(d, timeMs) {
    if (!this.enabled) return
    this.stopAutoCenter()
    this.target2 += d
    this.lastInputTime = timeMs
  }

  stopAutoCenter() {
    if (this.centering) {
      this.centering.kill?.()
      this.centering = null
    }
  }

  update(ratio, timeMs) {
    const yPrev = this.y
    if (!this.centering) {
      this.target1 = lerpFPSLimited(this.target1, this.target2, SCROLL.lerp1, SCROLL.maxStep, ratio)
      this.y = lerpFPS(this.y, this.target1, SCROLL.lerp2, ratio)
      this.target2 = clamp(this.target2, this.y - SCROLL.lead, this.y + SCROLL.lead)
      if (Math.abs(this.y - this.target2) < SCROLL.settle) {
        this.y = this.target1 = this.target2
      }
    }
    // Selama tween auto-center, timer diam ditahan supaya hitungan 1.4 s mulai dari akhir tween.
    if (this.centering) this.lastInputTime = timeMs
    this.velocity = clamp((this.velocity + Math.abs(this.y - yPrev)) * frictionFPS(SCROLL.velocityFriction, ratio), 0, 1)
    if (this.velocity < 0.001) this.velocity = 0
    this.state = this.map(this.y)

    if (this.enabled && !this.centering && this.tween && timeMs - this.lastInputTime > SCROLL.idleMs) {
      const plan = this.planAutoCenter(this.state.n)
      if (plan && Math.abs(plan.dy) > 1e-4) this._startCentering(plan, timeMs)
    }
    return this.state
  }

  _startCentering(plan, timeMs) {
    const from = this.y
    const to = this.y + plan.dy
    this.centering = this.tween(from, to, plan.duration, (v) => {
      this.y = this.target1 = this.target2 = v
    }, () => {
      this.centering = null
    })
    this.lastInputTime = timeMs
  }

  /**
   * Petakan posisi ke scene. Viewport menutup [n, n+1].
   * current = scene yang memuat n, next = scene berikutnya kalau viewport melewati tepi bawah current.
   * transition (uProgress) = porsi viewport yang sudah ditutup scene berikutnya.
   */
  map(y) {
    const n = mod(y, this.total)
    // Scene terakhir yang top-nya <= n. Toleransi 1e-6 karena mod float bisa menghasilkan
    // 2.3499999999999996 untuk 2.35 (tepat di tepi scene).
    let cur = this.sections[0]
    for (const s of this.sections) {
      if (s.top <= n + 1e-6) cur = s
    }
    const current = { index: cur.index, key: cur.key, progress: (n + 1 - cur.top) / (cur.height + 1) }
    const over = n + 1 - (cur.top + cur.height)
    let next = null
    let transition = 0
    if (over > 1e-6) {
      const nx = this.sections[(cur.index + 1) % this.sections.length]
      next = { index: nx.index, key: nx.key, progress: over / (nx.height + 1) }
      transition = over
    }
    return { n, current, next, transition }
  }

  /**
   * Rencana auto-center (blueprint 6.3). Mengembalikan { dy, duration } atau null.
   * Pure function dari posisi, jadi bisa dites tanpa waktu.
   */
  planAutoCenter(n) {
    const m = this.map(n)
    const cur = this.sections[m.current.index]
    const bottom = cur.top + cur.height
    if (m.next) {
      const nx = this.sections[m.next.index]
      const dForward = bottom - n // viewport atas = tepi, hanya scene berikutnya terlihat
      const dBack = bottom - (n + 1) // viewport bawah = tepi, hanya scene sekarang terlihat
      if (Math.abs(dForward) <= Math.abs(dBack)) {
        let dy = dForward
        let duration = SCROLL.transitionDuration
        if (nx.initialAutocenter != null) {
          const extra = nx.initialAutocenter * (nx.height + 1) - 1
          dy += extra
          duration += 2 * Math.abs(extra)
        }
        return { dy, duration }
      }
      let dy = dBack
      let duration = SCROLL.transitionDuration
      if (cur.finalAutocenter != null) {
        const landN = bottom - 1
        const targetN = cur.top + cur.finalAutocenter * (cur.height + 1) - 1
        const extra = targetN - landN
        dy += extra
        duration += 2 * Math.abs(extra)
      }
      return { dy, duration }
    }
    if (!cur.autoCenter) return null
    const plan = cur.autoCenter(m.current.progress)
    if (!plan) return null
    const targetN = cur.top + plan.progress * (cur.height + 1) - 1
    const dy = targetN - n
    return { dy, duration: typeof plan.duration === 'function' ? plan.duration(Math.abs(dy)) : plan.duration }
  }
}
