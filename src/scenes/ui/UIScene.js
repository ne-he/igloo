import {
  Scene, OrthographicCamera, WebGLRenderTarget, HalfFloatType, LineSegments, BufferGeometry, BufferAttribute, LineBasicMaterial,
} from 'three'
import gsap from 'gsap'
import { bus } from '../../engine/Bus.js'
import { mod } from '../../engine/math.js'
import { MsdfFont } from '../../text/MsdfFont.js'
import { MsdfText } from '../../text/MsdfText.js'
import { layoutText } from '../../text/layout.js'
import { glyphTableTexture } from '../../text/textMaterial.js'
import { computeUILayout, UI_RATIOS, UI_BREAKPOINTS } from './layout.js'
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
const INTRO_AUTO_DELAY = 0.5 // detik, fallback kalau tidak ada intro igloo yang jalan (deep link, ?nointro)
const BLOCK_STAGGER = 0.1 // [?] jeda antar blok, angka igloo tidak tercatat
const SHOW1 = { duration: 0.4, ease: 'none' }
const SHOW2 = { duration: 0.75, ease: 'sine.out' }
// Tombol Close detail (M6). Kotak DIUKUR dari ref 08 (800 lebar, breakpoint small): 72 x 30 px -> 92 x 38 di 1024,
// jadi dalam em teks: 7.2 x 3. Tepi kanan = lebar - margin kiri breakpoint, tepi atas = margin atas - 0.3 em.
const CLOSE = { width: 7.2, height: 3, corner: 0.8, top: -0.3 }

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

    this.writeA11y()
    bus.on('resize', ({ width, height }) => this.resize(width, height))
    bus.on('ui_intro', () => this.intro())
    bus.on('pointer_move', (input) => this._hoverClose(input.position))
    bus.on('click', (input) => {
      if (this.detailMode && this._inClose(input.position)) bus.emit('detail_close')
    })
  }

  /** Precompile + upload tekstur (sama seperti BaseScene.upload, versi kamera ortho). */
  async upload(renderer) {
    const saved = this.blocks.map((m) => m.uniforms.uShow1.value)
    for (const m of this.blocks) m.uniforms.uShow1.value = 1
    const closeVis = [this.texts.close.visible, this.closeFrame.visible]
    this.texts.close.visible = this.closeFrame.visible = true
    await renderer.compileAsync(this, this.camera)
    this.texts.close.visible = closeVis[0]
    this.closeFrame.visible = closeVis[1]
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
    this._layoutClose(width)
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
