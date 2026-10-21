import {
  Scene, OrthographicCamera, WebGLRenderTarget, HalfFloatType, LineSegments, BufferGeometry, BufferAttribute, LineBasicMaterial,
} from 'three'
import { renderTargetType } from '../../engine/rtType.js'
import gsap from 'gsap'
import { bus } from '../../engine/Bus.js'
import { mod } from '../../engine/math.js'
import { MsdfFont } from '../../text/MsdfFont.js'
import { MsdfText } from '../../text/MsdfText.js'
import { layoutText } from '../../text/layout.js'
import { glyphTableTexture } from '../../text/textMaterial.js'
import { computeUILayout, UI_RATIOS, UI_BREAKPOINTS } from './layout.js'
import { FactLabel } from './FactLabel.js'
import content from '../../content/content.js'

// Scene UI (blueprint 4.1 dan 5.6): kamera orthographic dalam piksel CSS, origin kiri atas.
// Dirender Engine setelah composite tanpa clear, jadi kena bloom tapi TIDAK kena transisi scene.
//
// Catatan: di igloo, copyright (dan manifesto) hidup di dalam scene igloo lewat positionUI, jadi ikut
// LUT + wipe transisi. Untuk sekarang copyright ditaruh di sini; pindahkan ke IglooScene kalau
// pipeline teks in-scene sudah ada.

const FONT_URL = '/assets/fonts/plexmono-msdf'
const COLOR_TEXT = 0xffffff
// Baris "// Copyright" gelap seperti ref 01. Warna igloo (forensik 9.2) 0x3c3c54 terlalu tipis di atas gunung gelap:
// kontras WCAG di 5% piksel latar terburuk cuma 3.07 (igloo n 0.658), 3.74 (kristal n 3.35), 2.45 (entry).
// 0x1e1e2c (hue sama, luminans kira-kira separuh) memberi 4.73 / 5.76 / 3.78. Putih lebih buruk (1.6 sampai 3.2)
// karena latar di belakang baris ini terang. Diukur M8 lewat screenshot dengan baris judul disembunyikan.
const COLOR_TITLE = 0x1e1e2c
const LOGO_BOLD = 0.15 // Medium ditebalkan kira-kira ke Bold lewat ambang MSDF
const HINT_HIDE_DISTANCE = 0.59 // unit scroll dari posisi awal (forensik arsitektur 2.6)
const INTRO_AUTO_DELAY = 0.5 // detik, fallback kalau tidak ada intro igloo yang jalan (deep link, ?nointro)
const BLOCK_STAGGER = 0.1 // [?] jeda antar blok, angka igloo tidak tercatat
const SHOW1 = { duration: 0.4, ease: 'none' }
const SHOW2 = { duration: 0.75, ease: 'sine.out' }
// Tombol Close detail (M6). Kotak DIUKUR dari ref 08 (800 lebar, breakpoint small): 72 x 30 px -> 92 x 38 di 1024,
// jadi dalam em teks: 7.2 x 3. Tepi kanan = lebar - margin kiri breakpoint, tepi atas = margin atas - 0.3 em.
const CLOSE = { width: 7.2, height: 3, corner: 0.8, top: -0.3 }
// Ikon speaker di kanan teks Sound (em ukuran teks): jarak dari teks, tinggi ikon. Garis, bukan tekstur.
const SPEAKER = { gap: 0.7, height: 0.95 }
const HIT_PAD = 8 // px, area klik tombol di luar kotak teks

const soundLabel = (on) => `${content.ui.sound.label} ${on ? content.ui.sound.on : content.ui.sound.off}`

export class UIScene extends Scene {
  constructor() {
    super()
    this.name = 'ui'
    this.camera = new OrthographicCamera(0, 1, 0, -1, -10, 10)
    this.font = null
    this.texts = {}
    this.blocks = [] // urutan reveal
    this.layout = null
    this.introStarted = false
    this.introTl = null
    this.hintVisible = false
    this.scrollStart = 0
    this._autoIntro = null
    this.detailMode = false
    this.soundOn = false
    this.soundRect = null
    this.soundHover = false
  }

  async build(engine) {
    this.engine = engine
    this.font = await MsdfFont.load(FONT_URL)
    const f = this.font
    const c = content
    const t = this.texts
    t.logo = new MsdfText(f, { text: c.brand.name, color: COLOR_TEXT, bold: LOGO_BOLD, seed: 11 })
    t.copyrightTitle = new MsdfText(f, { text: c.copyright.title, color: COLOR_TITLE, seed: 12 })
    t.copyrightText = new MsdfText(f, { text: c.copyright.text, color: COLOR_TEXT, seed: 13 })
    t.hint = new MsdfText(f, { text: c.ui.scrollHint, color: COLOR_TEXT, seed: 14 })
    t.sound = new MsdfText(f, { text: soundLabel(false), color: COLOR_TEXT, seed: 15 })
    t.close = new MsdfText(f, { text: c.ui.close || 'Close', color: COLOR_TEXT, seed: 16 })
    this.blocks = [t.logo, t.copyrightTitle, t.copyrightText, t.hint, t.sound]
    for (const [name, mesh] of Object.entries(t)) {
      mesh.name = `ui_${name}`
      mesh.uniforms.uShow1.value = 0
      mesh.uniforms.uShow2.value = 0
      this.add(mesh)
    }

    // Ukuran yang tidak bergantung breakpoint (em), dipakai computeUILayout.
    this._measures = {
      logoWidthEm: layoutText(f, c.brand.name, { letterSpacing: UI_RATIOS.logoLetterSpacing }).width,
      capHeight: f.capHeight,
      hintLines: layoutText(f, c.ui.scrollHint, { maxWidth: UI_RATIOS.hintMaxWidth }).lineCount,
    }

    // Bingkai sudut tombol Close: 4 siku, digambar ulang tiap resize (piksel)
    this.closeFrame = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: COLOR_TEXT, transparent: true, opacity: 0, depthTest: false, depthWrite: false }))
    this.closeFrame.name = 'ui_closeFrame'
    this.closeFrame.frustumCulled = false
    this.closeFrame.visible = false
    t.close.visible = false
    this.closeShow = { value: 0 }
    this.closeRect = null
    this.closeHover = false
    this.add(this.closeFrame)

    // Ikon speaker (M8): segmen garis, digambar ulang saat resize dan saat status bunyi berubah.
    // Opacity mengikuti uShow1 teks Sound, jadi ikut reveal/fade blok Sound.
    this.speaker = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: COLOR_TEXT, transparent: true, opacity: 0, depthTest: false, depthWrite: false }))
    this.speaker.name = 'ui_speaker'
    this.speaker.frustumCulled = false
    this.add(this.speaker)

    // Label fakta bata igloo (src/scenes/igloo/BrickFacts.js memancarkan 'igloo_fact' saat hover/tap bata)
    this.factLabel = new FactLabel(f)
    this.add(this.factLabel)
    bus.on('igloo_fact', (target) => this.factLabel.setTarget(target))

    this.writeA11y()
    bus.on('resize', ({ width, height }) => this.resize(width, height))
    bus.on('ui_intro', () => this.intro())
    bus.on('pointer_move', (input) => {
      this._hoverClose(input.position)
      this._hoverSound(input.position)
    })
    bus.on('click', (input) => {
      if (this.detailMode && this._inClose(input.position)) bus.emit('detail_close')
      else if (this._inSound(input.position)) bus.emit('audio_mute_toggle')
    })
    // AudioManager (src/audio/Audio.js) memberi tahu status bunyi, teks ditukar dengan scramble
    bus.on('audio_state', ({ enabled }) => this.setSoundOn(enabled))
  }

  /** Precompile + upload tekstur (sama seperti BaseScene.upload, versi kamera ortho). */
  async upload(renderer) {
    const saved = this.blocks.map((m) => m.uniforms.uShow1.value)
    for (const m of this.blocks) m.uniforms.uShow1.value = 1
    const closeVis = [this.texts.close.visible, this.closeFrame.visible]
    this.texts.close.visible = this.closeFrame.visible = true
    this.factLabel.forceVisible(true)
    await renderer.compileAsync(this, this.camera)
    this.factLabel.forceVisible(false)
    this.texts.close.visible = closeVis[0]
    this.closeFrame.visible = closeVis[1]
    renderer.initTexture(this.font.texture)
    renderer.initTexture(glyphTableTexture(this.font))
    const rt = new WebGLRenderTarget(2, 2, { type: renderTargetType(renderer, HalfFloatType) })
    renderer.setRenderTarget(rt)
    renderer.render(this, this.camera)
    renderer.setRenderTarget(null)
    rt.dispose()
    this.blocks.forEach((m, i) => (m.uniforms.uShow1.value = saved[i]))
  }

  resize(width, height) {
    const cam = this.camera
    cam.left = 0
    cam.right = width
    cam.top = 0
    cam.bottom = -height
    cam.updateProjectionMatrix()
    if (!this.font) return
    const L = computeUILayout(width, height, this._measures)
    this.layout = L
    const t = this.texts
    const place = (mesh, spec, extra = {}) => {
      mesh.relayout({ size: spec.size, lineHeight: spec.lineHeight, maxWidth: spec.maxWidth ?? Infinity, ...extra })
      mesh.position.set(spec.x, -spec.baseline, 0)
    }
    place(t.logo, L.logo, { letterSpacing: L.logo.letterSpacing })
    place(t.copyrightTitle, L.copyrightTitle)
    place(t.copyrightText, L.copyrightText)
    place(t.hint, L.hint)
    place(t.sound, L.sound)
    this._layoutClose(width)
    this._layoutSound()
    this.factLabel.resize(width, height, L.sound.size)
    // label fakta igloo tidak boleh menutup blok teks UI (kotak teks + 10 px)
    this.factLabel.avoid = [t.logo, t.copyrightTitle, t.copyrightText, t.hint, t.sound].map((m) => {
      const bx = m.box
      return { x0: m.position.x + bx.x - 10, y0: -(m.position.y + bx.y) - 10, x1: m.position.x + bx.x + bx.width + 10, y1: -(m.position.y + bx.y - bx.height) + 10 }
    })
  }

  /** Kotak klik tombol Sound (teks + ikon) dan geometri ikon speaker, piksel CSS y ke bawah. */
  _layoutSound() {
    const L = this.layout
    if (!L) return
    const fs = L.sound.size
    const text = this.texts.sound
    const h = SPEAKER.height * fs
    const capH = this.font.capHeight * fs
    const x0 = L.sound.x + text.layout.width + SPEAKER.gap * fs
    const cy = L.sound.baseline - capH / 2 // pusat vertikal ikon = tengah huruf kapital
    const seg = speakerSegments(this.soundOn, h)
    const pos = new Float32Array((seg.length / 2) * 3)
    for (let i = 0; i < seg.length / 2; i++) pos.set([x0 + seg[i * 2], -(cy - seg[i * 2 + 1]), 0], i * 3)
    this.speaker.geometry.setAttribute('position', new BufferAttribute(pos, 3))
    this.speaker.geometry.computeBoundingSphere()
    this.soundRect = { x0: L.sound.x, y0: L.sound.baseline - capH, x1: x0 + 1.25 * h, y1: L.sound.baseline }
  }

  _inSound(p) {
    const r = this.soundRect
    if (!r || !this.introStarted) return false
    return p.x >= r.x0 - HIT_PAD && p.x <= r.x1 + HIT_PAD && p.y >= r.y0 - HIT_PAD && p.y <= r.y1 + HIT_PAD
  }

  _hoverSound(p) {
    const on = this._inSound(p)
    if (on === this.soundHover) return
    this.soundHover = on
    this.engine?.setCursor('ui_sound', on)
    if (on) {
      // igloo: hover tombol sound = reveal ulang + "ui-long"
      gsap.fromTo(this.texts.sound.uniforms.uShow2, { value: 0 }, { value: 1, ...SHOW2 })
      bus.emit('audio_play', { name: 'ui-long' })
    }
  }

  /** Tukar teks "Sound: Off/On" dengan scramble (uShow2 0 -> 1) dan gambar ulang ikon. */
  setSoundOn(on) {
    on = !!on
    if (on === this.soundOn) return
    this.soundOn = on
    this.texts.sound.setText(soundLabel(on))
    this._layoutSound()
    if (this.introStarted) gsap.fromTo(this.texts.sound.uniforms.uShow2, { value: 0 }, { value: 1, ...SHOW2 })
    const btn = typeof document !== 'undefined' && document.querySelector('#a11y button[data-sound]')
    if (btn) {
      btn.textContent = soundLabel(on)
      btn.setAttribute('aria-pressed', String(on))
    }
  }

  _layoutClose(width) {
    const L = this.layout
    const B = UI_BREAKPOINTS[L.bp]
    const fs = B.text
    const w = CLOSE.width * fs
    const h = CLOSE.height * fs
    const x0 = width - B.left - w
    const y0 = B.top + CLOSE.top * fs
    this.closeRect = { x0, y0, x1: x0 + w, y1: y0 + h }
    const close = this.texts.close
    close.relayout({ size: fs })
    close.position.set(x0 + (w - close.layout.width) / 2, -(y0 + (h + this.font.capHeight * fs) / 2), 0)
    // 4 siku sudut, y dibalik (scene UI: y ke bawah = negatif)
    const c = CLOSE.corner * fs
    const x1 = x0 + w
    const Y0 = -y0
    const Y1 = -(y0 + h)
    const seg = [
      x0, Y0, x0 + c, Y0, x0, Y0, x0, Y0 - c,
      x1, Y0, x1 - c, Y0, x1, Y0, x1, Y0 - c,
      x0, Y1, x0 + c, Y1, x0, Y1, x0, Y1 + c,
      x1, Y1, x1 - c, Y1, x1, Y1, x1, Y1 + c,
    ]
    const pos = new Float32Array((seg.length / 2) * 3)
    for (let i = 0; i < seg.length / 2; i++) pos.set([seg[i * 2], seg[i * 2 + 1], 0], i * 3)
    this.closeFrame.geometry.setAttribute('position', new BufferAttribute(pos, 3))
    this.closeFrame.geometry.computeBoundingSphere()
  }

  _inClose(p) {
    const r = this.closeRect
    return !!r && p.x >= r.x0 - 8 && p.x <= r.x1 + 8 && p.y >= r.y0 - 8 && p.y <= r.y1 + 8
  }

  _hoverClose(p) {
    const on = this.detailMode && this._inClose(p)
    if (on === this.closeHover) return
    this.closeHover = on
    this.engine?.setCursor('ui_close', on)
    if (on) {
      // hover = reveal ulang (scramble) + bunyi panjang (igloo: "ui-long"), hook audio M8 lewat bus
      gsap.fromTo(this.texts.close.uniforms.uShow2, { value: 0 }, { value: 1, ...SHOW2 })
      gsap.fromTo(this.closeShow, { value: 0.4 }, { value: 1, duration: 0.4, ease: 'none' })
      bus.emit('audio_play', { name: 'ui-long' })
    }
  }

  /**
   * Mode detail (M6): copyright + hint disembunyikan, tombol Close muncul. Logo dan Sound tetap
   * (ref 08). instant = deep link, tanpa animasi.
   */
  setDetailMode(on, { instant = false } = {}) {
    if (on === this.detailMode) return
    this.detailMode = on
    const t = this.texts
    const hideable = [t.copyrightTitle, t.copyrightText, t.hint]
    const close = t.close
    if (on) {
      for (const m of hideable) fadeOut(m, instant)
      this.hintVisible = false
      close.visible = this.closeFrame.visible = true
      if (instant) {
        close.uniforms.uShow1.value = close.uniforms.uShow2.value = this.closeShow.value = 1
      } else {
        const tl = gsap.timeline()
        reveal(tl, close, 0)
        tl.fromTo(this.closeShow, { value: 0 }, { value: 1, duration: 0.6, ease: 'none' }, 0)
      }
    } else {
      this._hoverClose({ x: -1e9, y: -1e9 })
      fadeOut(close, instant)
      gsap.to(this.closeShow, {
        value: 0, duration: instant ? 0 : 0.3, ease: 'none',
        onComplete: () => {
          if (!this.detailMode) close.visible = this.closeFrame.visible = false
        },
      })
      // copyright kembali, hint diurus update() (muncul lagi hanya kalau dekat posisi awal)
      if (this.introStarted) {
        const tl = gsap.timeline()
        reveal(tl, t.copyrightTitle, 0)
        reveal(tl, t.copyrightText, BLOCK_STAGGER)
      }
    }
  }

  update(frame) {
    // Normalnya timeline intro igloo memancarkan 'ui_intro' di detik 4.5. Auto-start hanya fallback.
    if (!this.introStarted && !this._autoIntro && !this.engine?.intro?.running) {
      this._autoIntro = gsap.delayedCall(INTRO_AUTO_DELAY, () => this.intro())
    }
    // bingkai Close berkedip saat muncul (sin(show * 30))
    const cs = this.closeShow.value
    this.closeFrame.material.opacity = cs >= 1 ? 1 : cs * (0.85 + 0.15 * Math.sin(cs * 30))
    // ikon speaker ikut reveal teks Sound, berkedip seperti bingkai Close saat muncul
    const ss = this.texts.sound.uniforms.uShow1.value
    this.speaker.material.opacity = ss >= 1 ? 1 : ss * (0.85 + 0.15 * Math.sin(ss * 30))
    this.speaker.visible = ss > 0
    // label fakta bata: posisi diproyeksikan dari kamera igloo yang sudah dirender frame ini
    this.factLabel.update(Math.min(0.1, (frame.delta || 16.667) / 1000), !this.detailMode)
    if (!this.introStarted || this.detailMode) return
    // Hint hilang setelah scroll sekitar 0.59 unit dari posisi awal, muncul lagi kalau kembali
    // (jarak dihitung melingkar karena scroll berulang tiap 10.85).
    const s = frame.scroll
    const d = mod(s.y - this.scrollStart, s.total)
    this.setHintVisible(Math.min(d, s.total - d) < HINT_HIDE_DISTANCE)
  }

  /** Reveal semua blok berurutan: uShow1 0.4 s linear + uShow2 0.75 s sine.out, jeda per blok. */
  intro() {
    if (this.introStarted) return
    this.introStarted = true
    this._autoIntro?.kill()
    this.scrollStart = this.engine ? this.engine.scroll.y : 0
    this.hintVisible = true
    const tl = gsap.timeline()
    // deep link: intro UI jalan saat detail sudah terbuka, copyright + hint tetap tersembunyi
    const skip = this.detailMode ? [this.texts.copyrightTitle, this.texts.copyrightText, this.texts.hint] : []
    if (this.detailMode) this.hintVisible = false
    this.blocks.forEach((mesh, i) => {
      if (!skip.includes(mesh)) reveal(tl, mesh, i * BLOCK_STAGGER)
    })
    // igloo: reveal logo di intro memutar "logo" (hanya terdengar kalau Sound sudah On)
    bus.emit('audio_play', { name: 'logo' })
    this.introTl = tl
    return tl
  }

  setHintVisible(v) {
    if (v === this.hintVisible) return
    this.hintVisible = v
    const u = this.texts.hint.uniforms
    if (v) {
      reveal(gsap.timeline(), this.texts.hint, 0)
    } else {
      // igloo: hint yang hilang memutar "ui-short"
      bus.emit('audio_play', { name: 'ui-short' })
      gsap.to(u.uShow1, { value: 0, duration: 0.3, ease: 'none' })
      gsap.to(u.uShow2, { value: 0, duration: 0.3, ease: 'none' })
    }
  }

  /** Debug/verifikasi: bekukan intro di progress p (0..1) supaya scramble bisa difoto. */
  debugReveal(p) {
    this.intro()
    this.introTl.pause()
    this.introTl.progress(p)
  }

  /**
   * Cermin DOM tersembunyi untuk aksesibilitas dan SEO (canvas tidak punya teks).
   * Hanya mengisi section miliknya sendiri di <main id="a11y">, scene lain boleh menambah section lain.
   */
  writeA11y() {
    if (typeof document === 'undefined') return
    const main = document.getElementById('a11y')
    if (!main) return
    let sec = main.querySelector('section[data-ui]')
    if (!sec) {
      sec = document.createElement('section')
      sec.dataset.ui = ''
      main.prepend(sec)
    }
    sec.replaceChildren()
    const add = (tag, text) => {
      const el = document.createElement(tag)
      el.textContent = text
      sec.append(el)
    }
    add('h1', content.brand.name)
    add('p', content.copyright.title)
    add('p', content.copyright.text.replace(/\n/g, ' '))
    add('p', content.ui.scrollHint)
    // tombol sungguhan untuk keyboard dan pembaca layar (canvas tidak bisa difokus)
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.dataset.sound = ''
    btn.textContent = soundLabel(this.soundOn)
    btn.setAttribute('aria-pressed', String(this.soundOn))
    btn.addEventListener('click', () => bus.emit('audio_mute_toggle'))
    sec.append(btn)
  }
}

/**
 * Segmen garis ikon speaker (piksel, x ke kanan dari tepi kiri ikon, y ke atas dari pusat).
 * Badan kotak + corong, lalu 2 busur gelombang (On) atau tanda silang (Off).
 */
function speakerSegments(on, h) {
  const s = h / 2
  const seg = []
  const poly = (list) => {
    for (let i = 0; i < list.length; i++) {
      const a = list[i]
      const b = list[(i + 1) % list.length]
      seg.push(a[0], a[1], b[0], b[1])
    }
  }
  poly([[0, -0.3 * s], [0.35 * s, -0.3 * s], [0.35 * s, 0.3 * s], [0, 0.3 * s]]) // badan
  poly([[0.35 * s, 0.3 * s], [0.9 * s, 0.85 * s], [0.9 * s, -0.85 * s], [0.35 * s, -0.3 * s]]) // corong
  if (on) {
    for (const r of [0.55 * s, 1.0 * s]) {
      const n = 6
      for (let i = 0; i < n; i++) {
        const a0 = -0.8 + (1.6 * i) / n
        const a1 = -0.8 + (1.6 * (i + 1)) / n
        seg.push(0.9 * s + Math.cos(a0) * r, Math.sin(a0) * r, 0.9 * s + Math.cos(a1) * r, Math.sin(a1) * r)
      }
    }
  } else {
    const x0 = 1.3 * s
    const x1 = 2.0 * s
    seg.push(x0, -0.35 * s, x1, 0.35 * s, x0, 0.35 * s, x1, -0.35 * s)
  }
  return seg
}

function fadeOut(mesh, instant) {
  const u = mesh.uniforms
  if (instant) {
    gsap.killTweensOf([u.uShow1, u.uShow2])
    u.uShow1.value = u.uShow2.value = 0
    return
  }
  gsap.to(u.uShow1, { value: 0, duration: 0.3, ease: 'none' })
  gsap.to(u.uShow2, { value: 0, duration: 0.3, ease: 'none' })
}

function reveal(tl, mesh, at) {
  const u = mesh.uniforms
  tl.fromTo(u.uShow1, { value: 0 }, { value: 1, ...SHOW1 }, at)
  tl.fromTo(u.uShow2, { value: 0 }, { value: 1, ...SHOW2 }, at)
}
