import { WebGLRenderer, Scene, OrthographicCamera, Vector2, HalfFloatType } from 'three'
import { EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SMAAPreset, BlendFunction } from 'postprocessing'
import gsap from 'gsap'
import { CustomEase } from 'gsap/CustomEase'
import { bus } from './Bus.js'
import { Ticker } from './Ticker.js'
import { Input } from './Input.js'
import { Scroll, SCROLL } from './Scroll.js'
import { SceneComposer } from './SceneComposer.js'
import { AdaptiveDPR } from './AdaptiveDPR.js'
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

    // Scene utama = satu fullscreen triangle dengan shader composite.
    this.composite = new CompositeMaterial(this.globals)
    this.mainScene = new Scene()
    this.mainScene.add(createFullscreenTriangle(this.composite))
    this.mainCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)

    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
      multisampling: 0,
    })
    this.composer.addPass(new RenderPass(this.mainScene, this.mainCamera))
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
    scene.composer = new SceneComposer(this.renderer)
    this.scenes.push(scene)
    return scene
  }

  async init() {
    // Bangun semua scene paralel, lalu precompile satu per satu (blueprint 2 nomor 15).
    await Promise.all([...this.scenes.map((s) => s.build(this)), this.composite.loadTextures()])
    this.resize()
    for (const s of this.scenes) await s.upload(this.renderer)
    await this.renderer.compileAsync(this.mainScene, this.mainCamera)
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
    for (const s of this.scenes) {
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
    const t1 = this._renderSection(cur, st.current.progress, frame)
    const t2 = next ? this._renderSection(next, st.next.progress, frame) : t1

    this.composite.uniforms.tScene1.value = t1
    this.composite.uniforms.tScene2.value = t2
    this.composite.uniforms.uProgress.value = st.transition
    this.composite.jitter()
    this.composer.render(ticker.delta / 1000)
  }
}
