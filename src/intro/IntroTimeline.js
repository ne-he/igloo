import gsap from 'gsap'
import { bus } from '../engine/Bus.js'

// Intro scene igloo (blueprint 6.5, skill ref 01 bagian 5.3). Timeline dibangun dalam keadaan pause,
// lalu play() dipanggil main.js saat loader mulai hilang. Semua uniform berakhir di nilai default
// ("sudah tampil penuh"), jadi frame istirahat setelah intro identik dengan frame tanpa intro.
export const INTRO = {
  restProgress: 0.495, // onStart: scroll dipusatkan ke titik istirahat igloo
  uiAt: 4.5, // emit 'ui_intro' (logo, hint, tombol suara)
  unlockAt: 5, // igloo menunggu 5 s sebelum enableScroll()
  bloomFrom: 1.5, // bloom intro 1.5, turun ke 1 di detik 2.5
}

const DEFAULT_EASE = 'power2.inOut' // default GSAP igloo (blueprint 6.5) untuk tween tanpa ease tercatat

export class IntroTimeline {
  /**
   * engine: Engine (scroll, bloom, ui). scene: IglooScene (introControls()).
   * Konstruktor TIDAK mengubah state apa pun: semua tween immediateRender false.
   */
  constructor(engine, scene) {
    this.engine = engine
    this.scene = scene
    this.c = scene.introControls()
    this.running = false // true dari play() sampai selesai, UI menunda auto-start selama ini
    this.manageScroll = true // false kalau handle debug mengambil alih kunci scroll
    this._prepared = false
    this.timeline = this._build()
  }

  get duration() {
    return this.timeline.duration()
  }

  _build() {
    const c = this.c
    const tl = gsap.timeline({ paused: true, onComplete: () => (this.running = false) })
    // fromTo eksplisit + immediateRender false: state awal diurus setInitial(), seek mundur tetap balik ke "from".
    const ft = (target, from, to, vars, at) =>
      tl.fromTo(target, { value: from }, { value: to, ease: DEFAULT_EASE, overwrite: false, immediateRender: false, ...vars }, at)
    const show = (obj, on, at) => tl.set(obj, { visible: on, immediateRender: false }, at)

    // 0: outline materialize, shockwave cage, cage alpha ke 0.4, mesh igloo masih tersembunyi
    ft(c.outlineMaterialize, 0, 1, { duration: 2.5, ease: 'power3.inOut' }, 0)
    ft(c.cageProgress, 0, 1, { duration: 4, ease: 'sine.inOut' }, 0)
    ft(c.cageAlpha, 0, 0.4, { duration: 0.1, ease: 'none' }, 0)
    show(c.cage, true, 0)
    // 0.5: angka intro mulai berganti
    show(c.digits, true, 0.5)
    ft(c.digitsProgress, 0, 1, { duration: 4, ease: 'sine.out' }, 0.5)
    // 0.7: gunung muncul, gelombang segitiga lembah dari tengah
    ft(c.mountainAlpha, 0, 1, { duration: 3 }, 0.7)
    ft(c.progress, 0, 1, { duration: 7.5, ease: 'inOut1' }, 0.7)
    ft(c.progress2, 0, 1, { duration: 7.5, ease: 'inOut3' }, 0.7)
    // 1.0: gradient LUT
    ft(c.gradientAlpha, 0, 1, { duration: 4, ease: 'sine.inOut' }, 1)
    // 1.1: igloo tampil, dibangun atas ke bawah dengan pita scan biru
    show(c.igloo, true, 1.1)
    ft(c.iglooMaterialize, 0, 1, { duration: 2.25, ease: 'igloo_ease_1' }, 1.1)
    // 1.5: langit dari warna intro ke gradient
    ft(c.skyProgress, 0, 1, { duration: 3 }, 1.5)
    // 1.75: angka intro memudar, disembunyikan di 3.75
    ft(c.digitsAlpha, 1, 0, { duration: 2 }, 1.75)
    show(c.digits, false, 3.75)
    // 2.0: parallax, outline pudar, napas bata, asap + salju, kamera turun dari atas (introWeight)
    ft(c.touchAmount, 0, 1, { duration: 5 }, 2)
    ft(c.outlineAlpha, 1, 0, { duration: 3, ease: 'inOut4' }, 2)
    ft(c.breath, 0, 1, { duration: 2, ease: 'none' }, 2)
    ft(c.smokeAlpha, 0, 1, { duration: 3 }, 2)
    ft(c.snowAlpha, 0, 1, { duration: 4 }, 2)
    ft(c.introWeight, 0, 1, { duration: 5.5, ease: 'inOut1' }, 2)
    // 2.1: cage pudar, disembunyikan di 5.1
    ft(c.cageAlpha, 0.4, 0, { duration: 3 }, 2.1)
    show(c.cage, false, 5.1)
    // 2.5: bloom intro turun ke normal
    tl.fromTo(this.engine.bloom, { intensity: INTRO.bloomFrom },
      { intensity: 1, duration: 2, ease: 'sine.inOut', overwrite: false, immediateRender: false }, 2.5)
    // 4.5: UI intro, 5.0: scroll dibuka
    tl.call(() => bus.emit('ui_intro'), null, INTRO.uiAt)
    tl.call(() => this._unlock(), null, INTRO.unlockAt)
    return tl
  }

  /** State tepat di detik 0 (cermin nilai "from" timeline). */
  setInitial() {
    const c = this.c
    const set = (u, x) => [].concat(u).forEach((o) => (o.value = x))
    set(c.outlineMaterialize, 0)
    set(c.outlineAlpha, 1)
    set(c.cageProgress, 0)
    set(c.cageAlpha, 0)
    set(c.digitsProgress, 0)
    set(c.digitsAlpha, 1)
    set(c.mountainAlpha, 0)
    set(c.progress, 0)
    set(c.progress2, 0)
    set(c.gradientAlpha, 0)
    set(c.iglooMaterialize, 0)
    set(c.skyProgress, 0)
    set(c.touchAmount, 0)
    set(c.breath, 0)
    set(c.smokeAlpha, 0)
    set(c.snowAlpha, 0)
    set(c.introWeight, 0)
    c.cage.visible = true
    c.digits.visible = false
    c.igloo.visible = false
    this.engine.bloom.intensity = INTRO.bloomFrom
    this._prepared = true
  }

  /** Kunci scroll + pasang state awal sebelum frame pertama (dipanggil sebelum engine.start()). */
  prepare() {
    this.running = true
    if (this.manageScroll) this.engine.scroll.enabled = false
    // onStart igloo: pusatkan scroll ke titik istirahat, kamera intro langsung tanpa damping
    const scroll = this.engine.scroll
    scroll.setN(scroll.progressToN(this.engine.scenes.indexOf(this.scene), INTRO.restProgress))
    this.scene.camera.snap()
    this.setInitial()
  }

  /** Mulai dari detik 0 (dipanggil saat loader hilang). */
  play() {
    this.prepare()
    this.timeline.restart(false, true)
    return this
  }

  /** Lewati intro (deep link, ?nointro): langsung state akhir, scroll terbuka, UI pakai fallback. */
  skip() {
    this.timeline.progress(1, true)
    this.running = false
    this._unlock()
    return this
  }

  /** Selesaikan intro yang sedang jalan (dipakai handle debug sebelum screenshot istirahat). */
  finish() {
    if (!this.running) return
    this.timeline.progress(1, true)
    this.running = false
    if (this.engine.ui && !this.engine.ui.introStarted) bus.emit('ui_intro')
    this._unlock()
  }

  _unlock() {
    if (this.manageScroll) this.engine.scroll.enabled = true
  }

  /**
   * Debug: bekukan intro di detik t (deterministik). Kamera di-snap, reveal UI ikut detik t - 4.5.
   * Timeline tetap pause, jadi play() harus dipanggil untuk jalan lagi.
   */
  seek(t) {
    this.timeline.pause()
    if (!this._prepared || !this.running) {
      this.prepare()
      this.timeline.seek(0, true) // tween yang sudah pernah jalan ikut kembali ke nilai "from"
    }
    this.timeline.seek(t, true)
    this.scene.camera.snap()
    this.scene.igloo?.bricks?.snap()
    const ui = this.engine.ui
    if (ui) {
      if (t >= INTRO.uiAt) {
        ui.intro() // pastikan introTl ada
        ui.debugReveal(Math.min(1, (t - INTRO.uiAt) / ui.introTl.duration()))
      } else if (ui.introTl) {
        ui.introTl.pause()
        ui.introTl.progress(0)
      }
    }
    return this
  }

  progress(p) {
    return this.seek(p * this.duration)
  }
}

/** Intro dilewati untuk deep link (path selain root) dan, di dev, kalau ada ?nointro. */
export function shouldSkipIntro(loc = window.location, dev = import.meta.env.DEV) {
  const base = import.meta.env.BASE_URL || '/'
  const path = loc.pathname.replace(/index\.html$/, '')
  if (path !== base) return true
  return !!dev && new URLSearchParams(loc.search).has('nointro')
}
