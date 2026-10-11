import { Scene, OrthographicCamera, WebGLRenderTarget, HalfFloatType } from 'three'
import gsap from 'gsap'
import { bus } from '../../engine/Bus.js'
import { mod } from '../../engine/math.js'
import { MsdfFont } from '../../text/MsdfFont.js'
import { MsdfText } from '../../text/MsdfText.js'
import { layoutText } from '../../text/layout.js'
import { glyphTableTexture } from '../../text/textMaterial.js'
import { computeUILayout, UI_RATIOS } from './layout.js'
import content from '../../content/content.js'

// Scene UI (blueprint 4.1 dan 5.6): kamera orthographic dalam piksel CSS, origin kiri atas.
// Dirender Engine setelah composite tanpa clear, jadi kena bloom tapi TIDAK kena transisi scene.
//
// Catatan: di igloo, copyright (dan manifesto) hidup di dalam scene igloo lewat positionUI, jadi ikut
// LUT + wipe transisi. Untuk sekarang copyright ditaruh di sini; pindahkan ke IglooScene kalau
// pipeline teks in-scene sudah ada.

const FONT_URL = '/assets/fonts/plexmono-msdf'
const COLOR_TEXT = 0xffffff
const COLOR_TITLE = 0x3c3c54 // warna judul igloo (forensik 9.2), baris "// Copyright" gelap di ref 01
const LOGO_BOLD = 0.15 // Medium ditebalkan kira-kira ke Bold lewat ambang MSDF
const HINT_HIDE_DISTANCE = 0.59 // unit scroll dari posisi awal (forensik arsitektur 2.6)
const INTRO_AUTO_DELAY = 0.5 // detik, sementara sampai intro igloo (M3) memancarkan 'ui_intro'
const BLOCK_STAGGER = 0.1 // [?] jeda antar blok, angka igloo tidak tercatat
const SHOW1 = { duration: 0.4, ease: 'none' }
const SHOW2 = { duration: 0.75, ease: 'sine.out' }

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

    this.writeA11y()
    bus.on('resize', ({ width, height }) => this.resize(width, height))
    bus.on('ui_intro', () => this.intro())
  }

  /** Precompile + upload tekstur (sama seperti BaseScene.upload, versi kamera ortho). */
  async upload(renderer) {
    const saved = this.blocks.map((m) => m.uniforms.uShow1.value)
    for (const m of this.blocks) m.uniforms.uShow1.value = 1
    await renderer.compileAsync(this, this.camera)
    renderer.initTexture(this.font.texture)
    renderer.initTexture(glyphTableTexture(this.font))
    const rt = new WebGLRenderTarget(2, 2, { type: HalfFloatType })
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
  }

  update(frame) {
    if (!this.introStarted && !this._autoIntro) {
      this._autoIntro = gsap.delayedCall(INTRO_AUTO_DELAY, () => this.intro())
    }
    if (!this.introStarted) return
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
    this.blocks.forEach((mesh, i) => reveal(tl, mesh, i * BLOCK_STAGGER))
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
    add('p', soundLabel(false))
  }
}

function reveal(tl, mesh, at) {
  const u = mesh.uniforms
  tl.fromTo(u.uShow1, { value: 0 }, { value: 1, ...SHOW1 }, at)
  tl.fromTo(u.uShow2, { value: 0 }, { value: 1, ...SHOW2 }, at)
}
