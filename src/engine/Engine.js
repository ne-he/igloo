import {
  WebGLRenderer, Scene, OrthographicCamera, Vector2, HalfFloatType, WebGLRenderTarget, LinearFilter, ShaderMaterial,
  CustomBlending, AddEquation, OneFactor, OneMinusSrcAlphaFactor,
} from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SMAAPreset, BlendFunction } from 'postprocessing'
import gsap from 'gsap'
import { CustomEase } from 'gsap/CustomEase'
import { bus } from './Bus.js'
import { Ticker } from './Ticker.js'
import { Input } from './Input.js'
import { Scroll, SCROLL } from './Scroll.js'
import { SceneComposer } from './SceneComposer.js'
import { AdaptiveDPR } from './AdaptiveDPR.js'
import { renderTargetType } from './rtType.js'
import { CompositeMaterial, createFullscreenTriangle } from '../compositor/CompositeMaterial.js'

gsap.registerPlugin(CustomEase)
// Ease hasil bedah (blueprint 6.5).
CustomEase.create('inOut1', 'M0,0 C0.5,0 0.1,1 1,1')
CustomEase.create('inOut2', 'M0,0 C0.56,0 0,1 1,1')
CustomEase.create('inOut3', 'M0,0 C0.6,0 0,1 1,1')
CustomEase.create('inOut4', 'M0,0 C0.4,0 -0.06,1 1,1')
CustomEase.create('igloo_ease_1', 'M0,0 C0.662,0.073 0.047,1 1,1')
gsap.defaults({ ease: 'power2.inOut', duration: 0.6, overwrite: 'auto' })

// Bloom global (blueprint 2 nomor 7): threshold rendah di dunia pucat = rasa berkabut mahal.
export const BLOOM = { levels: 6, luminanceThreshold: 0.2, luminanceSmoothing: 0.025, intensity: 1, radius: 0.85 }

// UI tajam di layar DPR tinggi (M8). Scene 3D tetap di DPR 1.15 (blueprint 6.8), tapi kanvas dibuat di DPR asli
// (maks 2) dan UI digambar ke RT sendiri di resolusi itu, lalu ditumpuk di atas hasil composer yang di-upscale.
// UI_BLOOM_UNDERLAY: UI juga digambar sekali di resolusi 3D sebelum bloom, supaya teks UI tetap kena glow
// seperti igloo (UI pass sebelum bloom). Salinan tajam menutupi salinan buram itu.
export const UI_MAX_DPR = 2
export const UI_BLOOM_UNDERLAY = false

// Tumpuk RT UI (warna linear premultiplied) ke layar: encode sRGB di sini karena output composer sudah sRGB.
function createUIOverlayMaterial() {
  return new ShaderMaterial({
    uniforms: { tUI: { value: null } },
    vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform sampler2D tUI;
varying vec2 vUv;
void main() {
  vec4 u = texture2D(tUI, vUv);
  if (u.a < 0.001) discard;
  gl_FragColor = vec4(u.rgb / u.a, 1.0);
  #include <colorspace_fragment>
  gl_FragColor = vec4(gl_FragColor.rgb * u.a, u.a);
}`,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    depthTest: false,
    depthWrite: false,
  })
}

/**
 * Engine: satu renderer WebGL2, satu loop (gsap.ticker), scene per section ke RT sendiri,
 * composite fullscreen, lalu Bloom + SMAA (encode sRGB) ke layar. Engine tidak meng-import scene:
 * scene didaftarkan dari main.js dan bicara lewat bus + uniform global.
 */
export class Engine {
  constructor(container, sections) {
    this.container = container
    this.renderer = new WebGLRenderer({
      antialias: false,
      depth: false,
      stencil: false,
      alpha: false,
      powerPreference: 'high-performance',
    })
    this.renderer.setPixelRatio(1)
    this.renderer.setClearColor(0x000000, 1)
    container.appendChild(this.renderer.domElement)

    const dpr = window.devicePixelRatio || 1
    this.baseDpr = dpr <= 2 ? Math.min(dpr, 1.15) : Math.min(dpr, 1.5)
    this.currentDpr = this.baseDpr
    // DPR kanvas + UI: asli (maks 2), tidak ikut adaptive DPR scene 3D
    this.uiDpr = Math.max(this.baseDpr, Math.min(dpr, UI_MAX_DPR))
    // Tipe RT aman (HalfFloat, atau UnsignedByte kalau GPU tidak bisa render float). Dicek sekali, log sekali.
    this.rtType = renderTargetType(this.renderer, HalfFloatType)

    // Uniform global bersama: objek {value} yang sama di-spread ke semua material.
    this.globals = {
      uTime: { value: 0 },
      uResolution: { value: new Vector2(1, 1) },
      uAspect: { value: 1 },
      uDtRatio: { value: 1 },
    }

    this.ticker = new Ticker()
    this.input = new Input(this.renderer.domElement)
    this.scroll = new Scroll(sections, { tween: this._tween })
    this.adaptive = new AdaptiveDPR(() => this.resize())
    this.scenes = []
    // Scene detail proyek (M6): BaseScene dengan composer sendiri, dirender hanya saat uDetailProgress > 0.
    this.detail = null
    // Pemilik yang minta cursor pointer di canvas (kristal, tombol Close, chip link). Satu Set supaya
    // beberapa penulis tidak saling menimpa style.cursor.
    this._cursorOwners = new Set()
    // Timeline intro (src/intro/IntroTimeline.js), dipasang main.js. UI dan handle debug membacanya.
    this.intro = null

    // Scene utama = satu fullscreen triangle dengan shader composite.
    this.composite = new CompositeMaterial(this.globals)
    this.mainScene = new Scene()
    this.mainScene.add(createFullscreenTriangle(this.composite))
    this.mainCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)

    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: this.rtType,
      depthBuffer: false,
      stencilBuffer: false,
      multisampling: 0,
    })
    this.composer.addPass(new RenderPass(this.mainScene, this.mainCamera))
    // UI pass (blueprint 4.1): scene ortho piksel digambar di atas composite tanpa clear, jadi UI
    // kena bloom tapi tidak kena transisi. Mati sampai scene UI didaftarkan lewat setUI().
    this.ui = null
    this.uiPass = new RenderPass(new Scene(), this.mainCamera)
    this.uiPass.clear = false
    this.uiPass.ignoreBackground = true
    this.uiPass.enabled = false
    this.composer.addPass(this.uiPass)
    // RT UI resolusi asli + quad penumpuk (lihat UI_MAX_DPR)
    this.uiRT = new WebGLRenderTarget(1, 1, {
      type: this.rtType, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false, depthBuffer: false,
    })
    this.uiOverlay = new FullScreenQuad(createUIOverlayMaterial())
    this.uiOverlay.material.uniforms.tUI.value = this.uiRT.texture
    this._uiRes = new Vector2(1, 1)
    this._savedRes = new Vector2()
    this.bloom = new BloomEffect({ ...BLOOM, mipmapBlur: true, blendFunction: BlendFunction.SCREEN })
    this.composer.addPass(new EffectPass(this.mainCamera, this.bloom))
    this.composer.addPass(new EffectPass(this.mainCamera, new SMAAEffect({ preset: SMAAPreset.HIGH })))

    this._bindInput()
    this._onResize = () => this.resize()
    window.addEventListener('resize', this._onResize)
    this._render = this._render.bind(this)
  }

  // Tween auto-center pakai gsap + CustomEase inOut3, disuntik ke Scroll.
  _tween = (from, to, duration, onUpdate, onComplete) => {
    const o = { v: from }
    return gsap.to(o, { v: to, duration, ease: 'inOut3', overwrite: false, onUpdate: () => onUpdate(o.v), onComplete })
  }

  _bindInput() {
    const now = () => this.ticker.time * 1000
    bus.on('wheel', ({ deltaY, pinch }) => {
      if (!pinch) this.scroll.addDelta(deltaY * SCROLL.wheel, now())
    })
    bus.on('touch_drag', (d01) => this.scroll.addDelta(d01.y * SCROLL.touch, now()))
    bus.on('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'PageDown') this.scroll.addDelta(SCROLL.key, now())
      if (e.key === 'ArrowUp' || e.key === 'PageUp') this.scroll.addDelta(-SCROLL.key, now())
    })
  }

  addScene(scene) {
    scene.composer = new SceneComposer(this.renderer, this.rtType)
    this.scenes.push(scene)
    return scene
  }

  /**
   * Daftarkan scene UI (Scene dengan .camera ortho, build(engine), upload(renderer), update(frame)).
   * Engine tetap tidak meng-import scene UI, main.js yang membuatnya.
   */
  setUI(ui) {
    this.ui = ui
    this.uiPass.mainScene = ui
    this.uiPass.mainCamera = ui.camera
    this.uiPass.enabled = UI_BLOOM_UNDERLAY
    return ui
  }

  /**
   * Daftarkan scene detail (M6). Composite membaca outputnya sebagai tDetail, dicampur lewat
   * uDetailProgress / uDetailProgress2 (uniform composite, digerakkan DetailController).
   */
  setDetail(scene) {
    scene.composer = new SceneComposer(this.renderer, this.rtType)
    this.detail = scene
    return scene
  }

  /** Minta / lepas cursor pointer di canvas atas nama `owner`. */
  setCursor(owner, on) {
    const had = this._cursorOwners.size > 0
    if (on) this._cursorOwners.add(owner)
    else this._cursorOwners.delete(owner)
    const has = this._cursorOwners.size > 0
    if (had !== has) this.renderer.domElement.style.cursor = has ? 'pointer' : ''
  }

  /**
   * Bongkar engine: hentikan loop, panggil dispose() tiap scene yang punya (scroll, detail, UI), lalu lepas
   * RT dan pass milik engine. Belum dipanggil dari mana pun (dipersiapkan untuk HMR / unmount).
   */
  dispose() {
    this.ticker.stop()
    bus.off('render', this._render)
    window.removeEventListener('resize', this._onResize)
    for (const s of [...this.scenes, this.detail, this.ui]) {
      if (!s) continue
      if (typeof s.dispose === 'function') s.dispose()
      s.composer?.dispose?.()
    }
    this.uiRT.dispose()
    this.uiOverlay.material.dispose()
    this.uiOverlay.dispose()
    this.composer.dispose()
    this.renderer.dispose()
  }

  async init() {
    // Bangun semua scene paralel, lalu precompile satu per satu (blueprint 2 nomor 15).
    const ui = this.ui ? [this.ui.build(this)] : []
    const detail = this.detail ? [this.detail.build(this)] : []
    await Promise.all([...this.scenes.map((s) => s.build(this)), ...ui, ...detail, this.composite.loadTextures()])
    this.resize()
    // tahap precompile, dilaporkan ke loader ASCII (LoaderProgress) sebagai pecahan 0..1
    const uploads = [...this.scenes, this.detail, this.ui].filter(Boolean)
    let done = 0
    bus.emit('init_progress', 0)
    for (const s of uploads) {
      await s.upload(this.renderer)
      bus.emit('init_progress', ++done / (uploads.length + 1))
    }
    await this.renderer.compileAsync(this.mainScene, this.mainCamera)
    bus.emit('init_progress', 1)
  }

  start() {
    bus.on('render', this._render)
    this.ticker.start()
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth)
    const h = Math.max(1, this.container.clientHeight)
    this.currentDpr = this.baseDpr * this.adaptive.multiplier
    const W = Math.max(1, Math.floor(w * this.currentDpr))
    const H = Math.max(1, Math.floor(h * this.currentDpr))
    this.composer.setSize(W, H, false)
    // composer.setSize ikut mengubah ukuran kanvas ke W x H. Kanvas dikembalikan ke DPR UI (asli): pass terakhir
    // composer menggambar fullscreen ke kanvas, jadi gambar 3D otomatis di-upscale, buffer internal tetap W x H.
    const UW = Math.max(W, Math.floor(w * this.uiDpr))
    const UH = Math.max(H, Math.floor(h * this.uiDpr))
    this.renderer.setSize(UW, UH, false)
    this.uiRT.setSize(UW, UH)
    this._uiRes.set(UW, UH)
    for (const s of this.detail ? [...this.scenes, this.detail] : this.scenes) {
      s.composer.setSize(W, H)
      s.camera.resize(w / h)
    }
    this.globals.uResolution.value.set(W, H)
    this.globals.uAspect.value = w / h
    bus.emit('resize', { width: w, height: h, W, H, aspect: w / h })
  }

  _renderSection(scene, progress, frame) {
    scene.progress = progress
    scene.update(frame)
    scene.camera.update(this.input.position11, frame.time, frame.ratio)
    return scene.composer.render(scene, scene.camera)
  }

  _render(ticker) {
    const { ratio, time } = ticker
    this.globals.uTime.value = time
    this.globals.uDtRatio.value = ratio
    this.adaptive.update(time, ticker.avgFps, ticker.sampleCount)

    const st = this.scroll.update(ratio, time * 1000)
    const cur = this.scenes[st.current.index]
    const next = st.next ? this.scenes[st.next.index] : null
    for (const s of this.scenes) s.active = s === cur || s === next

    const frame = { time, ratio, delta: ticker.delta, scroll: this.scroll, input: this.input, engine: this }
    const u = this.composite.uniforms
    const dp = this.detail ? u.uDetailProgress.value : 0
    // Detail terbuka penuh: scene scroll tidak dirender dan tidak di-update sama sekali (hemat GPU).
    // Composite tidak membaca tScene1/tScene2 saat uDetailProgress = 1, jadi tekstur lama aman dibiarkan.
    if (dp < 1) {
      const t1 = this._renderSection(cur, st.current.progress, frame)
      const t2 = next ? this._renderSection(next, st.next.progress, frame) : t1
      u.tScene1.value = t1
      u.tScene2.value = t2
    }
    u.uProgress.value = st.transition
    if (this.detail) {
      this.detail.active = dp > 0
      if (dp > 0) u.tDetail.value = this._renderSection(this.detail, dp, frame)
    }
    this.composite.jitter()
    if (this.ui) this.ui.update(frame)
    this.composer.render(ticker.delta / 1000)
    if (this.ui) this._renderUI()
  }

  /** UI ke RT resolusi asli, lalu ditumpuk ke kanvas (lihat UI_MAX_DPR). */
  _renderUI() {
    const r = this.renderer
    // shader UI yang membaca gl_FragCoord / uResolution (klip panel detail) harus melihat ukuran RT UI
    const res = this.globals.uResolution.value
    this._savedRes.copy(res)
    res.copy(this._uiRes)
    r.setRenderTarget(this.uiRT)
    r.setClearColor(0x000000, 0)
    r.clear(true, false, false)
    r.render(this.ui, this.ui.camera)
    r.setClearColor(0x000000, 1)
    res.copy(this._savedRes)
    r.setRenderTarget(null)
    this.uiOverlay.render(r)
  }
}
