import gsap from 'gsap'
import { bus } from '../../engine/Bus.js'
import { mod } from '../../engine/math.js'
import { IdlePeek, PEEK, CueGate, loopDistance } from './idlePeek.js'
import { sectionRests, activeSection, planSectionJump } from './sectionNav.js'
import content from '../../content/content.js'

// Pengatur petunjuk scroll (tanpa mesh sendiri): cue SCROLL TO ENTER, idle peek kamera, lompat indeks section,
// dan hook semua fakta igloo ketemu. Dipanggil UIScene tiap frame. Logika keputusannya murni di idlePeek.js dan
// sectionNav.js (dites), file ini cuma menyambungkannya ke Scroll, bus, dan gsap.
//
// Gerak scroll milik guide (peek, lompat) memakai pola yang sama dengan DetailController: tween gsap dipasang di
// scroll.centering, jadi Scroll.update berhenti me-lerp, input pengguna (addDelta -> stopAutoCenter) langsung
// membatalkannya, dan timer diam auto-center ditahan selama tween.
//
// Apa yang dihitung "sudah berinteraksi" (cue pudar, peek mati): wheel / swipe / tombol panah saat scroll aktif,
// klik indeks, lompat langsung lewat Scroll.setN (handle debug __igloo.setScroll, deep link), perubahan posisi
// scroll yang bukan dari guide, dan handle debug yang mengambil alih kunci scroll (intro.manageScroll = false,
// dari __igloo.enableScroll). Script Playwright selalu lewat salah satu jalur ini, jadi peek tidak pernah jalan.

const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'])
const AT_REST = 0.02 // unit scroll dari posisi awal, dianggap masih di titik istirahat

const media = (q) => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null)

export class ScrollGuide {
  /**
   * @param {object} o
   * @param {import('../../engine/Engine.js').Engine} o.engine
   * @param {import('./ScrollCue.js').ScrollCue} o.cue
   * @param {import('./SectionIndex.js').SectionIndex} o.index
   * @param {() => boolean} o.detail true kalau detail proyek terbuka / sedang membuka
   */
  constructor({ engine, cue, index, detail }) {
    this.engine = engine
    this.cue = cue
    this.index = index
    this.isDetail = detail
    this.peek = new IdlePeek()
    this.gate = new CueGate()
    this.rests = sectionRests(engine.scroll.sections)
    this.tracking = false // mulai mengawasi interaksi (intro UI dimulai)
    this.start = 0 // posisi scroll saat intro UI dimulai (titik istirahat igloo)
    this.lastY = 0
    this.jumps = 0
    this.motion = null // tween gsap milik guide yang sedang memegang scroll.centering
    this.motionKind = null // 'peek' | 'jump'
    this.target = -1 // section tujuan lompat yang sedang berjalan
    this.active = 0
    this.cueVisible = false
    this.factsDone = false
    this.factsLeft = false // sudah keluar dari igloo sejak semua fakta ketemu (teks kembali normal)
    this.reducedMq = media('(prefers-reduced-motion: reduce)')
    this.touch = !!media('(pointer: coarse)')?.matches
    this.log = [] // jejak keputusan untuk verifikasi (dibatasi)
    this._applyText()

    bus.on('wheel', ({ deltaY, pinch }) => {
      if (pinch || !deltaY) return
      this._setTouch(false)
      this._userScroll('wheel')
    })
    bus.on('touch_drag', (d) => {
      if (d && d.y) this._userScroll('touch')
    })
    bus.on('keydown', (e) => {
      if (SCROLL_KEYS.has(e.key)) this._userScroll('key')
    })
    bus.on('pointer_down', (input) => {
      if (input.pointerType === 'touch' || input.pointerType === 'pen') this._setTouch(true)
    })
    // hook penghitung fakta igloo (agent fakta): semua ketemu, ajak scroll
    bus.on('igloo_facts_complete', () => this._factsComplete())
  }

  get reduced() {
    return !!this.reducedMq?.matches
  }

  _note(what) {
    if (this.log.length > 60) this.log.shift()
    this.log.push({ t: +this.engine.ticker.time.toFixed(2), what })
  }

  _setTouch(on) {
    if (on === this.touch) return
    this.touch = on
    this._applyText()
  }

  _applyText() {
    const ui = content.ui
    const done = this.factsDone && !this.factsLeft
    const str = done
      ? (this.touch ? ui.scrollCueDoneTouch : ui.scrollCueDone)
      : (this.touch ? ui.scrollCueTouch : ui.scrollCue)
    this.cue.setText(str)
    this.cue.up = this.touch // segmen naik searah swipe, turun searah wheel
    if (typeof document !== 'undefined') {
      const p = document.querySelector('#a11y [data-scroll-cue]')
      if (p) p.textContent = str
    }
  }

  /** Intro UI dimulai: catat posisi awal dan mulai mengawasi lompat / perubahan posisi. */
  track() {
    const s = this.engine.scroll
    this.tracking = true
    this.start = s.y
    this.lastY = s.y
    this.jumps = s.jumps || 0
  }

  /** Intro UI selesai (dipanggil dari timeline intro UI): cue boleh tampil, jam peek mulai. */
  introDone() {
    if (!this.tracking) this.track()
    this.gate.arm()
    this.peek.arm(this.engine.ticker.time)
    this._note('introDone')
  }

  /** Interaksi apa pun yang memindahkan scroll: cue pudar, peek mati untuk sesi ini. */
  _interacted(why) {
    if (!this.peek.cancelled) this._note(`interacted:${why}`)
    this.gate.dismiss()
    this.peek.cancel()
  }

  _userScroll(kind) {
    this.gate.input()
    // wheel saat scroll terkunci (intro, detail) tidak menggerakkan apa pun, jadi belum dihitung
    if (this.engine.scroll.enabled) this._interacted(kind)
  }

  _factsComplete() {
    const st = this.engine.scroll.state
    if (st.current.key !== 'igloo' || st.next) return
    this.factsDone = true
    this.factsLeft = false
    this._applyText()
    this.gate.show()
    this._note('factsComplete')
    // pulsa sesudah reveal teks baru mulai, supaya kedipnya terlihat
    gsap.delayedCall(this.cueVisible ? 0 : 0.45, () => this.cue.pulse())
  }

  /** Lompat ke titik istirahat section i (klik indeks / tombol a11y). */
  jumpTo(i) {
    const s = this.engine.scroll
    if (!s.enabled || this.isDetail()) return false
    this._interacted('index')
    const plan = planSectionJump(mod(s.y, s.total), i, this.rests, s.total)
    if (!plan) return false
    this.target = i
    this._glide('jump', [{ to: s.y + plan.dy, duration: plan.duration, ease: 'inOut3' }])
    bus.emit('audio_play', { name: 'ui-short' })
    this._note(`jump:${i}:${plan.dy.toFixed(3)}:${plan.duration.toFixed(2)}`)
    return true
  }

  _startPeek() {
    const s = this.engine.scroll
    const P = PEEK
    const y0 = s.y
    this.peek.begin()
    this._note(`peek:${this.peek.count}`)
    this._glide('peek', [
      { to: y0 + P.amount, duration: P.out, ease: 'sine.inOut' },
      { to: y0, duration: P.back, ease: 'back.out(1.2)', at: P.out + P.hold },
    ])
    this.cue.pulse()
    gsap.delayedCall(P.out, () => this.motionKind === 'peek' && this.cue.pulse())
  }

  /** Tween posisi scroll lewat scroll.centering (lihat catatan di atas). legs: [{ to, duration, ease, at? }]. */
  _glide(kind, legs) {
    const s = this.engine.scroll
    this._stopMotion()
    s.stopAutoCenter()
    const o = { v: s.y }
    const tl = gsap.timeline({
      onUpdate: () => {
        if (s.centering === tl) s.y = s.target1 = s.target2 = o.v
      },
      onComplete: () => {
        if (s.centering === tl) s.centering = null
        if (this.motion === tl) this._motionEnded(false)
      },
    })
    for (const leg of legs) tl.to(o, { v: leg.to, duration: leg.duration, ease: leg.ease, overwrite: false }, leg.at ?? '>')
    s.centering = tl
    this.motion = tl
    this.motionKind = kind
  }

  _stopMotion() {
    if (!this.motion) return
    const tl = this.motion
    const s = this.engine.scroll
    if (s.centering === tl) s.centering = null
    tl.kill()
    this._motionEnded(true)
  }

  _motionEnded(killed) {
    const kind = this.motionKind
    this.motion = null
    this.motionKind = null
    if (kind === 'peek') this.peek.end(this.engine.ticker.time)
    if (kind === 'jump') this.target = -1
    this.lastY = this.engine.scroll.y
    if (killed) this._note(`${kind}:killed`)
  }

  /** Dipanggil UIScene.update tiap frame. */
  update(frame, dt) {
    const e = this.engine
    const s = e.scroll
    const st = s.state
    // tween guide dibunuh dari luar (input pengguna lewat stopAutoCenter, setN, detail): bereskan
    if (this.motion && s.centering !== this.motion) {
      this.motion.kill()
      this._motionEnded(true)
    }
    if (this.tracking) {
      // lompat langsung (setN) atau posisi berubah tanpa guide = interaksi / scroll diambil kode lain
      if ((s.jumps || 0) !== this.jumps) {
        this.jumps = s.jumps || 0
        this._interacted('setN')
      }
      if (!this.motion && Math.abs(s.y - this.lastY) > 1e-6) this._interacted('moved')
      this.lastY = s.y
      // handle debug mengambil alih kunci scroll (__igloo.enableScroll): peek tidak boleh mengganggu
      if (e.intro && e.intro.manageScroll === false && !this.peek.cancelled) {
        this.peek.cancel()
        this._note('peek:debugScroll')
      }
    }

    const detail = this.isDetail()
    const inIgloo = st.current.key === 'igloo' && !st.next
    const dist = loopDistance(s.y, this.start, s.total)
    const ownMotion = !!this.motion
    const moving = (!ownMotion && s.velocity > 0) || (!!s.centering && !ownMotion)
    if (this.factsDone && !inIgloo && !this.factsLeft) {
      this.factsLeft = true
      this._applyText()
    }

    // cue
    this.cue.reduced = this.reduced
    const cueOn = this.gate.update(dt, { dist, inIgloo: inIgloo || this.motionKind === 'peek', moving, detail })
    if (cueOn !== this.cueVisible) {
      this.cueVisible = cueOn
      this.cue.setVisible(cueOn)
      if (!cueOn) bus.emit('audio_play', { name: 'ui-short' }) // igloo: hint yang hilang memutar "ui-short"
      this._note(cueOn ? 'cue:show' : 'cue:hide')
    }

    // peek
    const atRest = inIgloo && dist < AT_REST && !s.centering && s.velocity === 0
    const ctx = { enabled: s.enabled, atRest, detail, reduced: this.reduced, intro: !!e.intro?.running, busy: !!e.input?.isDown }
    if (this.peek.due(frame.time, ctx)) this._startPeek()

    // indeks: tujuan lompat langsung jadi aktif, selain itu ikut scene yang menutupi layar
    this.active = this.target >= 0 ? this.target : activeSection(st)
    this.index.setActive(this.active)
  }

  /** Ringkasan untuk tools/verify/ux_scroll.py (lewat window.__igloo.engine.ui.guide). */
  debugState() {
    const s = this.engine.scroll
    return {
      n: s.state.n,
      y: s.y,
      start: this.start,
      cueVisible: this.cueVisible,
      cueText: this.cue.text.text,
      cueShow: this.cue.text.uniforms.uShow1.value,
      dismissed: this.gate.dismissed,
      peekCount: this.peek.count,
      peekRunning: this.peek.running,
      peekCancelled: this.peek.cancelled,
      peekReadyAt: this.peek.readyAt,
      time: this.engine.ticker.time,
      motion: this.motionKind,
      active: this.active,
      touch: this.touch,
      log: this.log.slice(-20),
    }
  }
}
