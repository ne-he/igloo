import { Group } from 'three'
import gsap from 'gsap'
import { clamp } from '../../engine/math.js'
import { InkText, InkLines, SoftPlate } from './uiParts.js'

// Cue scroll tengah bawah (pengganti hint kiri bawah "Scroll down to discover.", review pengguna Okt 2026).
// Teks mono SCROLL TO ENTER (sentuh: SWIPE UP TO ENTER) di atas garis vertikal tipis. Satu segmen pendek berjalan
// sepanjang garis berulang-ulang: turun untuk wheel, naik untuk swipe (arah gerak jari). Reveal teks sama dengan
// blok UI lain (uShow1 0.4 s + uShow2 0.75 s, scramble). Keterbacaan di atas salju pucat: pelat tinta lembut di
// belakang teks + bayangan 1 px tinta di teks dan garis (resep label fakta igloo).

export const SCROLL_CUE = {
  show1: 0.4,
  show2: 0.75,
  draw: 0.6, // detik garis tumbuh dari atas
  drawDelay: 0.15,
  hide: 0.3,
  period: 2.1, // detik satu putaran segmen
  travel: 0.72, // porsi putaran segmen bergerak (sisanya jeda)
  seg: 1.0, // em, panjang segmen
  trackAlpha: 0.55,
  // pelat di belakang teks (em ukuran teks), sama dengan label fakta
  padX: 0.95,
  padY: 0.72,
  soft: 1.1,
  radius: 0.35,
  plateAlpha: 0.4,
  // pulsa (peek / semua fakta ketemu)
  pulse: 1.5, // detik meluruh
  pulseSpeed: 1.6, // tambahan kecepatan segmen saat pulsa penuh
  pulseBlink: 0.7, // detik kedip teks (uBlink 0 -> 1)
}

const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

export class ScrollCue extends Group {
  /** @param {import('../../text/MsdfFont.js').MsdfFont} font */
  constructor(font, text) {
    super()
    this.name = 'ui_scrollCue'
    this.font = font
    this.size = 12
    this.layoutSpec = null
    this.wanted = false // keinginan terakhir setVisible
    this.draw = { value: 0 } // 0..1 panjang garis yang sudah tergambar
    this.phase = 0
    this.pulseT = 0
    this.up = false // arah segmen: false = turun (wheel), true = naik (swipe)
    this.reduced = false

    this.plate = new SoftPlate()
    this.plate.name = 'ui_cuePlate'
    this.plate.renderOrder = 30
    this.text = new InkText(font, { text, seed: 17, align: 'center', shadowAlpha: 0.5 })
    this.text.name = 'ui_cueText'
    this.text.setRenderOrder(32)
    this.track = new InkLines(1, { alpha: SCROLL_CUE.trackAlpha, shadowAlpha: 0.45 })
    this.track.name = 'ui_cueTrack'
    this.track.setRenderOrder(34)
    this.dot = new InkLines(1, { alpha: 1, shadowAlpha: 0.6 })
    this.dot.name = 'ui_cueDot'
    this.dot.setRenderOrder(36)
    this.add(this.plate, this.text, this.track, this.dot)
    this.text.uniforms.uShow1.value = 0
    this.text.uniforms.uShow2.value = 0
    this.plate.uniforms.uAlpha.value = 0
    this.visible = false
  }

  /** Posisi dari computeUILayout().cue (piksel CSS, y ke bawah). */
  resize(spec) {
    this.layoutSpec = spec
    this.size = spec.size
    this.text.relayout({ size: spec.size, letterSpacing: spec.letterSpacing, align: 'center' })
    this.text.position.set(Math.round(spec.x), -spec.baseline, 0)
    this._layoutPlate()
  }

  _layoutPlate() {
    const s = this.layoutSpec
    if (!s) return
    const C = SCROLL_CUE
    const w = this.text.layout.width
    const cap = this.font.capHeight * s.size
    const x0 = Math.round(s.x) - w / 2 - C.padX * s.size
    const x1 = Math.round(s.x) + w / 2 + C.padX * s.size
    this.plate.setBox(x0, s.baseline - cap - C.padY * s.size, x1, s.baseline + C.padY * s.size, C.soft * s.size, C.radius * s.size)
  }

  /** Kotak yang tidak boleh ditutup label fakta (pelat teks + garis), piksel CSS y ke bawah. */
  get rect() {
    const s = this.layoutSpec
    if (!s) return null
    const C = SCROLL_CUE
    const w = this.text.layout.width
    const cap = this.font.capHeight * s.size
    return {
      x0: s.x - w / 2 - C.padX * s.size,
      y0: s.baseline - cap - C.padY * s.size,
      x1: s.x + w / 2 + C.padX * s.size,
      y1: s.trackBottom,
    }
  }

  /** Ganti teks. Kalau sedang tampil, teks baru di-scramble ulang. */
  setText(str) {
    if (str === this.text.text) return
    this.text.setText(str)
    this._layoutPlate()
    if (this.wanted && this.text.uniforms.uShow1.value > 0) {
      gsap.fromTo(this.text.uniforms.uShow2, { value: 0 }, { value: 1, duration: SCROLL_CUE.show2, ease: 'sine.out' })
    }
  }

  /** Tampil (reveal scramble + garis tumbuh) atau sembunyi (pudar 0.3 s, garis ditarik). */
  setVisible(on, { instant = false } = {}) {
    if (on === this.wanted) return
    this.wanted = on
    const C = SCROLL_CUE
    const u = this.text.uniforms
    gsap.killTweensOf([u.uShow1, u.uShow2, this.draw])
    if (instant) {
      u.uShow1.value = u.uShow2.value = this.draw.value = on ? 1 : 0
      return
    }
    if (on) {
      this.phase = 0
      gsap.fromTo(u.uShow1, { value: 0 }, { value: 1, duration: C.show1, ease: 'none' })
      gsap.fromTo(u.uShow2, { value: 0 }, { value: 1, duration: C.show2, ease: 'sine.out' })
      gsap.fromTo(this.draw, { value: 0 }, { value: 1, duration: C.draw, delay: C.drawDelay, ease: 'power2.out' })
    } else {
      gsap.to([u.uShow1, u.uShow2], { value: 0, duration: C.hide, ease: 'none' })
      gsap.to(this.draw, { value: 0, duration: C.hide, ease: 'power1.in' })
    }
  }

  /** Pulsa sekali: teks berkedip + scramble ulang, garis lebih terang, segmen lebih cepat. */
  pulse() {
    const C = SCROLL_CUE
    this.pulseT = 1
    const u = this.text.uniforms
    gsap.fromTo(u.uBlink, { value: 0 }, { value: 1, duration: C.pulseBlink, ease: 'none' })
    if (u.uShow1.value > 0) gsap.fromTo(u.uShow2, { value: 0.35 }, { value: 1, duration: C.show2, ease: 'sine.out' })
  }

  /** Precompile: paksa semua bagian terlihat sesaat (UIScene.upload). */
  forceVisible(on) {
    if (on) {
      this._saved = [this.visible, this.text.uniforms.uShow1.value, this.draw.value]
      this.visible = true
      this.text.uniforms.uShow1.value = 1
      this.draw.value = 1
      this.update(0)
    } else if (this._saved) {
      ;[this.visible, this.text.uniforms.uShow1.value, this.draw.value] = this._saved
      this.update(0)
    }
  }

  /** @param {number} dt detik */
  update(dt) {
    const C = SCROLL_CUE
    const s = this.layoutSpec
    const show = this.text.uniforms.uShow1.value
    const draw = this.draw.value
    this.visible = !!s && (show > 0 || draw > 0)
    if (!this.visible) return
    this.pulseT = Math.max(0, this.pulseT - dt / C.pulse)
    const pulse = this.pulseT * this.pulseT

    this.plate.uniforms.uAlpha.value = (C.plateAlpha + 0.1 * pulse) * Math.min(1, show * 1.5)

    // garis: tumbuh dari atas ke bawah sepanjang draw
    const x = Math.round(s.x) + 0.5
    const top = s.trackTop
    const len = s.trackBottom - top
    this.track.begin()
    this.track.seg(x, top, x, top + len * draw)
    this.track.end()
    this.track.setOpacity(C.trackAlpha + 0.4 * pulse)

    // segmen berjalan: fase maju dengan kecepatan + pulsa, bergerak di porsi `travel`, lalu jeda
    this.phase = (this.phase + (dt / C.period) * (1 + C.pulseSpeed * pulse)) % 1
    const seg = C.seg * s.size
    let a0
    let a1
    let alpha
    if (this.reduced) {
      // gerak dikurangi: segmen diam di ujung arah gerak
      a1 = len
      a0 = len - seg
      alpha = 1
    } else {
      const p = clamp(this.phase / C.travel, 0, 1)
      const e = 0.5 - 0.5 * Math.cos(Math.PI * p)
      a1 = e * len
      a0 = Math.max(0, a1 - seg)
      alpha = smooth(0, 0.12, p) * (1 - smooth(0.8, 1, p))
    }
    const reach = len * draw
    a0 = Math.min(a0, reach)
    a1 = Math.min(a1, reach)
    const y0 = this.up ? s.trackBottom - a1 : top + a0
    const y1 = this.up ? s.trackBottom - a0 : top + a1
    this.dot.begin()
    if (y1 - y0 > 0.5) this.dot.seg(x, y0, x, y1)
    this.dot.end()
    this.dot.setOpacity(alpha * Math.min(1, show * 1.5))
  }

  dispose() {
    this.text.dispose()
    this.plate.dispose()
    this.track.dispose()
    this.dot.dispose()
  }
}
