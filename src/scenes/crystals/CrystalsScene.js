import {
  Color, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, Vector2, Vector3, WebGLRenderTarget, HalfFloatType,
  LinearFilter, LinearMipmapLinearFilter, FrontSide, BackSide, PMREMGenerator, EquirectangularReflectionMapping, Raycaster,
} from 'three'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import gsap from 'gsap'
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh'
import { BaseScene } from '../../engine/BaseScene.js'
import { loadGeometry, loadTexture } from '../../engine/Assets.js'
import { makeLutTexture, LutMaterial } from '../../grade/Lut.js'
import { CRYSTAL_COUNT, crystalCenter } from '../sections.js'
import { CrystalMaterial, makeFlatTexture, makeIceUniforms, setFlatColor, patchInnerDepth } from './CrystalMaterial.js'
import { createBackground, createBlurryText, createShapes, createSmoke } from './Background.js'
import { MouseFrost } from './MouseFrost.js'
import { CrystalLabels } from './Labels.js'
import { RippleRing } from './LabelParts.js'
import { NudgeScheduler, nudgeEnvelope, pointInRect } from './nudge.js'
import { Plexus, PLEXUS } from './Plexus.js'
import { MsdfFont } from '../../text/MsdfFont.js'
import { bus } from '../../engine/Bus.js'
import content from '../../content/content.js'

const VERTICAL_OFFSET = -5.75 // jarak antar kristal (blueprint 5.3)

// 'custom' = refraksi 2-pass sendiri (target M5a). 'fallback' = transmission bawaan three
// (transmission 1, ior 1.18, thickness 2, roughness 0.65), objek dalam terlihat langsung. Spec poin 6.
export const REFRACTION = 'custom'

// Grade sendiri: S-curve ringan + geser dingin (bukan LUT igloo). Live: __igloo.engine.scenes[1].setGrade({...})
// Tuning tampilan es M5b (pucat seperti susu, rim terang, grain halus). Live: __igloo.engine.scenes[1].setLook({...})
//   flatA = warna datar yang dibiaskan dinding belakang di pass A, tintA/tintB = pengali cahaya terbias per pass,
//   milk = campuran ke warna susu sebanding roughness, jitter/lodBias = kekuatan grain dan buram mip.
// Keterbacaan (Okt 2026): absorb/density/deep = serapan Beer-Lambert sebanding tebal es asli (warna es dalam),
//   edge/backShade = gelap facet miring di dinding depan / belakang, clearcoat/coatRough = kilap tajam per facet.
// Ajakan klik (Okt 2026): glow* = kilau kristal saat hot (hover kristal / tombol OPEN), rim fresnel
//   pangkat glowRim kali glowGain + angkat rata glowLift, warna glowColor. hoverGlow / nudgeGlow = kuat kilau
//   saat hover penuh / di puncak ajakan.
export const ICE_LOOK = {
  flatA: '#A6ABB7', tintA: [1, 1, 1], tintB: [0.88, 0.9, 0.93], milk: 0.08, jitter: 0.5, lodBias: 2, envIntensity: 0.6,
  absorb: [0.5, 0.3, 0.16], density: 1.6, deep: '#2e3a4e', thickMax: 2.5, edge: 0.7, backShade: 0.6,
  clearcoat: 0.6, coatRough: 0.06,
  glowColor: '#dfeaff', glowRim: 3, glowGain: 0.75, glowLift: 0.05, hoverGlow: 1, nudgeGlow: 0.8,
}

const FONT_URL = '/assets/fonts/plexmono-msdf'
const LABEL_SNAP = 0.02 // lompatan progress per frame di atas ini = teleport, label langsung ke status akhir
// Ukuran label kini dihitung Labels.js dalam piksel CSS (LABEL_PX). Rumus skala igloo + LABEL_FONT_FIT 0.75
// dulu membuat label ponsel cuma sekitar 10 px karena kamera portrait mundur.
const SETTLE_EPS = 0.003 // kristal dianggap diam di tengah kalau |pusat - progress| di bawah ini
const BUTTON_HIT_PX = 6 // kotak klik tombol OPEN diperbesar sekian px tiap sisi
const HOVER_RATE = 12 // 1/detik, kecepatan kilau hover naik turun
const FROST_RANGE = 0.2 // sim frost hanya jalan kalau kristal sedekat ini ke tengah (satuan progress)
// Detail view (M6, blueprint 5.4): klik kristal -> kamera zoom -3.5 (power3.in), putaran berhenti, plexus berkedip.
export const CRYSTAL_DETAIL = { zoom: -3.5, zoomIn: 1.25, zoomOut: 1.45 }

export const CRYSTAL_GRADE = { contrast: 1.12, pivot: 0.48, saturation: 0.62, blackPoint: 0.04, gamma: 1.45, shoulder: 0.8, tint: [0.0, 0.0, 0.004] }

/**
 * Scene 2: kristal portofolio (M5a). Layout dan kamera = data asli:
 * kristal t di y = (1 + t) * -5.75, kamera y = -23 * progress, fov = 45 - 5 * velocity scroll,
 * rotasi kristal = (centeredProgress - progress) * (11, 14, 6) * tanda acak + goyang 0.1 rad.
 *
 * Refraksi 2-pass per frame (skill ref 01 bagian 2.3), dijalankan tepat sebelum render composer
 * (sesudah engine meng-update kamera, jadi pass A dan B memakai matriks kamera yang sama):
 *   pass A -> _transmissionRT: kristal BackSide membiaskan warna datar #A6ABB7, objek dalam tampil,
 *             teks buram / shape / asap disembunyikan, latar tetap dirender.
 *   pass B -> composer biasa: kristal FrontSide membiaskan _transmissionRT, objek dalam disembunyikan.
 * Objek dalam hanya ada di pass A, jadi cuma terlihat lewat pembiasan.
 * M5b: mouse frost (raycast BVH firstHitOnly -> uv1 -> sim 512 per kristal), label MSDF 3D + TEMP,
 * plexus 18 titik. Label, plexus, dan raycast diposisikan di _lateUpdate (sesudah kamera di-update),
 * semuanya disembunyikan di pass A.
 */
export class CrystalsScene extends BaseScene {
  constructor(section) {
    super(section, { fov: 45 })
    this.background = new Color('#b9c0cd')
    this.camera.displacement.set(0.1, 0.05)
    this.camera.shake = 0.02
    this.camera.shakeSpeed = 0.1
    this.cameraZoom = 0
    this.crystals = []
    this.shared = { uProgress: { value: 0 }, uBlueOffset: { value: new Vector2() } }
    // handle verifikasi: showRT = tampilkan isi pass A, hideCrystals = kristal tidak dirender di pass B
    this.debug = { showRT: false, hideCrystals: false }
    this.look = { ...ICE_LOOK }
    this.raycaster = new Raycaster()
    this.raycaster.firstHitOnly = true
    this._hit = new Vector2()
    this._frame = { time: 0, dt: 0, pointer: new Vector2(), snap: true }
    this._lastProgress = null
    this._pointerSeen = false
    this._screenH = 768
    this._screenW = 1024
    // interaksi M6: kristal di bawah pointer (indeks atau -1), klik hanya saat interactive
    this.hovered = -1
    this.interactive = true
    // 1 = berputar normal, 0 = putaran berhenti (detail terbuka). _spinLag = detik goyang yang "tertahan".
    this.spin = { value: 1 }
    this._spinLag = 0
    // ajakan klik saat pengunjung diam (nudge.js). nudgeLog = riwayat ajakan untuk tools verifikasi.
    this.nudger = new NudgeScheduler()
    this.nudgeLog = []
    this._mqReduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
    this._mqCoarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null
  }

  async build(engine) {
    this.engine = engine
    this.renderer = engine.renderer
    const g = engine.globals
    const names = Array.from({ length: CRYSTAL_COUNT }, (_, t) => t + 1)
    const linear = (f) => loadTexture(f, 'linear').then(flipForGltf)
    const srgb = (f) => loadTexture(f, 'srgb').then(flipForGltf)
    const [crystalGeos, innerGeos, normals, roughs, innerMaps, blue, perlin, dot, atlas, shapes, wind, env, atlasInfo,
      font, advect, triangles] =
      await Promise.all([
        Promise.all(names.map((n) => loadGeometry(`crystal${n}`))),
        Promise.all(names.map((n) => loadGeometry(`inner${n}`))),
        Promise.all(names.map((n) => linear(`crystal${n}_normal.webp`))),
        Promise.all(names.map((n) => linear(`crystal${n}_roughness.webp`))),
        Promise.all(names.map((n) => srgb(`inner${n}_color.webp`))),
        loadTexture('blue_noise_128.png', 'data-repeat-nearest'),
        loadTexture('perlin.png', 'repeat'),
        loadTexture('dot_pattern.png', 'repeat'),
        loadTexture('blurrytext_atlas.png', 'mask'),
        loadTexture('shapes_blurred.png', 'mask'),
        loadTexture('wind_noise.png', 'repeat'),
        this._loadEnv(engine.renderer),
        fetch('/assets/textures/blurrytext_atlas.json').then((r) => r.json()),
        MsdfFont.load(FONT_URL),
        loadTexture('crystals_advect.png', 'data-repeat'),
        loadTexture('triangles_tiling.png', 'repeat'),
      ])

    this.flat = makeFlatTexture(this.look.flatA)
    this.ice = makeIceUniforms({ flat: this.flat, blueNoise: blue, triangles, resolution: g.uResolution })
    this.ice.uBlueOffset = this.shared.uBlueOffset

    this.bg = createBackground(g, { perlin, dot, blue }, this.shared)
    this.blurryText = createBlurryText(g, { atlas, perlin }, atlasInfo, this.shared)
    this.shapes = createShapes(g, { shapes }, this.shared)
    this.add(this.bg, this.blurryText, this.shapes)

    for (let t = 0; t < CRYSTAL_COUNT; t++) {
      const group = new Group()
      group.position.y = (1 + t) * VERTICAL_OFFSET
      const material = REFRACTION === 'custom'
        ? new CrystalMaterial({ normalMap: normals[t], roughnessMap: roughs[t], envMap: env, ice: this.ice })
        : new MeshPhysicalMaterial({
          color: new Color('#e0e8ef'), roughness: 0.65, roughnessMap: roughs[t], normalMap: normals[t],
          normalScale: new Vector2(1, -1), envMap: env, envMapIntensity: 0.91, transmission: 1, ior: 1.18, thickness: 2,
        })
      const mesh = new Mesh(crystalGeos[t], material)
      mesh.name = `crystal${t + 1}`
      // BVH hanya untuk 3 mesh kristal: raycast firstHitOnly memberi uv1 titik kena untuk frost
      const geo = crystalGeos[t]
      if (!geo.boundsTree) geo.boundsTree = new MeshBVH(geo)
      mesh.raycast = acceleratedRaycast
      geo.computeBoundingBox()
      geo.computeBoundingSphere()
      let frost = null
      if (REFRACTION === 'custom') {
        frost = new MouseFrost(engine.renderer, advect)
        material.frost.tMouseFrost.value = frost.texture
        frost.onSwap = (tex) => {
          material.frost.tMouseFrost.value = tex
        }
      }
      const project = content.projects[t] || { title: `PORTFOLIO_CO_0${t + 1}`, date: '', temp: 0 }
      const labels = new CrystalLabels(font, project, geo.boundingBox, t + 1, content.ui.crystal)
      const ripple = new RippleRing()
      const plexus = new Plexus(geo.boundingSphere.radius, t + 1)
      // objek dalam: bake plester terang, digambar terakhir dengan depth dibersihkan dulu, jadi selalu tampil
      // di dalam kristalnya walau dinding rongga (normal menghadap ke dalam) ikut dirender BackSide di pass A
      const innerMat = new MeshBasicMaterial({ map: innerMaps[t], color: new Color(0.78, 0.79, 0.82) })
      if (REFRACTION === 'custom') patchInnerDepth(innerMat)
      const inner = new Mesh(innerGeos[t], innerMat)
      inner.name = `inner${t + 1}`
      inner.renderOrder = 10
      if (REFRACTION === 'custom') {
        inner.onBeforeRender = (renderer) => {
          renderer.state.buffers.depth.setMask(true)
          renderer.clearDepth()
        }
      }
      mesh.add(inner)
      const smoke = createSmoke(g, { wind })
      smoke.position.set(0, -0.35, -0.9)
      smoke.material.uniforms.uSeed.value = t * 0.37
      group.add(mesh, smoke, plexus)
      const sign = () => (Math.random() < 0.5 ? -1 : 1)
      this.crystals.push({
        group, mesh, inner, smoke, material, frost, labels, plexus, ripple, labelsOn: false, plexusOn: false,
        center: crystalCenter(t),
        spin: [11 * sign(), 14 * sign(), 6 * sign()],
        rand: 1.3 + t * 2.7, // fase goyang tetap (screenshot deterministik)
        hover: 0, // 0..1 kilau hover yang dihaluskan
        nudgeT: -1, // detik sejak ajakan mulai, -1 = tidak ada
        env: { ring: -1, glow: 0, text: false, done: true },
        center3: new Vector3(), // pusat bola batas kristal di dunia (cincin ajakan)
      })
      this.add(group, labels, ripple)
    }
    this._applyLook()
    bus.on('resize', ({ width, height }) => {
      this._screenW = width
      this._screenH = height
    })

    // klik = geser < 15 px dan tekan < 0.5 s (Input). Rute diurus main.js lewat event 'crystal_click'.
    // Tombol OPEN dicek langsung di posisi klik (tap sentuh singkat bisa lebih cepat dari satu frame hover).
    bus.on('click', (input) => {
      if (!this.active || !this.interactive) return
      const b = this._buttonAt(input.position11)
      const i = b >= 0 ? b : this.hovered
      if (i >= 0) bus.emit('crystal_click', { index: i })
    })
    // klik / sentuh di mana pun = pengunjung tidak diam, hitungan ajakan mulai lagi
    bus.on('pointer_down', () => this.nudger.poke(this._frame.time))

    this.lut = makeLutTexture(CRYSTAL_GRADE)
    this.grade = this.composer.addPass(new LutMaterial(this.lut, { gradientAlpha: 0 }))

    // RT pass A: resolusi internal penuh, HalfFloat, mipmap (three r165 membuat mip otomatis sesudah render).
    this._transmissionRT = new WebGLRenderTarget(1, 1, {
      type: engine.rtType ?? HalfFloatType, // fallback UnsignedByte di GPU tanpa render float
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
    })
    if (REFRACTION === 'custom') {
      // pass A dijalankan tepat sebelum render composer (pass B), sesudah engine meng-update kamera
      const renderB = this.composer.render.bind(this.composer)
      this.composer.render = (scene, camera) => {
        this._lateUpdate(camera)
        this.renderTransmission(camera)
        if (this.debug.showRT) {
          this.composer.output = this._transmissionRT.texture
          return this.composer.output
        }
        return renderB(scene, camera)
      }
    }
  }

  async _loadEnv(renderer) {
    // HDR equirect sendiri (tools/textures/gen_crystal_textures.py) -> PMREM
    const tex = await new RGBELoader().loadAsync('/assets/textures/crystals_env.hdr')
    tex.mapping = EquirectangularReflectionMapping
    const pmrem = new PMREMGenerator(renderer)
    const env = pmrem.fromEquirectangular(tex).texture
    tex.dispose()
    pmrem.dispose()
    return env
  }

  /** Pass A ke _transmissionRT lalu siapkan state pass B. */
  renderTransmission(camera) {
    const r = this.renderer
    const rt = this._transmissionRT
    const res = this.engine.globals.uResolution.value
    if (rt.width !== res.x || rt.height !== res.y) rt.setSize(res.x, res.y)

    this._setPass('A')
    const prev = r.getRenderTarget()
    r.setRenderTarget(rt)
    r.render(this, camera)
    r.setRenderTarget(prev)
    this._setPass('B')
  }

  _setPass(pass) {
    const a = pass === 'A'
    const rt = this._transmissionRT
    this.ice.tTransmission.value = a ? this.flat : rt.texture
    this.ice.uTransmissionSize.value.set(a ? 4 : rt.width, a ? 4 : rt.height)
    this.blurryText.visible = !a
    this.shapes.visible = !a
    const tint = a ? this.look.tintA : this.look.tintB
    this.ice.uIceTint.value.setRGB(tint[0], tint[1], tint[2])
    this.ice.uIceBack.value = a ? 1 : 0
    for (const c of this.crystals) {
      c.labels.visible = !a && c.labelsOn
      c.plexus.visible = !a && c.plexusOn
      c.ripple.visible = !a && c.env.ring >= 0 && c.env.ring < 1
      const side = a ? BackSide : FrontSide
      if (c.material.side !== side) {
        c.material.side = side
        c.material.needsUpdate = true
      }
      c.mesh.visible = a || !this.debug.hideCrystals
      c.inner.visible = a
      c.smoke.visible = !a
    }
  }

  /** Precompile dua varian sisi material es supaya pass A tidak compile di frame pertama. */
  async upload(renderer) {
    await super.upload(renderer)
    if (REFRACTION !== 'custom') return
    this._setPass('A')
    await renderer.compileAsync(this, this.camera)
    this._setPass('B')
  }

  /** Ganti parameter tampilan es live (lihat ICE_LOOK). */
  setLook(params) {
    Object.assign(this.look, params)
    this._applyLook()
  }

  _applyLook() {
    const l = this.look
    setFlatColor(this.flat, l.flatA)
    this.ice.uIceMilk.value = l.milk
    this.ice.uIceJitter.value = l.jitter
    this.ice.uIceLodBias.value = l.lodBias
    this.ice.uIceAbsorb.value.fromArray(l.absorb)
    this.ice.uIceDensity.value = l.density
    this.ice.uIceDeepColor.value.set(l.deep)
    this.ice.uIceThickMax.value = l.thickMax
    this.ice.uIceEdge.value = l.edge
    this.ice.uIceBackShade.value = l.backShade
    this.ice.uIceGlowColor.value.set(l.glowColor)
    this.ice.uIceGlowShape.value.set(l.glowRim, l.glowGain, l.glowLift)
    for (const c of this.crystals) {
      c.material.envMapIntensity = l.envIntensity
      if (c.material.isCrystalMaterial) {
        c.material.clearcoat = l.clearcoat
        c.material.clearcoatRoughness = l.coatRough
      }
    }
  }

  /** Ganti parameter grade live (tuning palet). */
  setGrade(params) {
    const next = makeLutTexture({ ...CRYSTAL_GRADE, ...params })
    this.grade.uniforms.tLUT.value = next
    this.lut.dispose()
    this.lut = next
  }

  onShow() {
    // igloo mengacak ulang arah putar tiap kali scene terlihat lagi
    for (const c of this.crystals) {
      c.spin = c.spin.map((v) => Math.abs(v) * (Math.random() < 0.5 ? -1 : 1) * (1 - Math.random() * 0.15))
    }
  }

  onHide() {
    this._setHovered(-1)
    // keluar dari scene kristal = kunjungan selesai, datang lagi = jatah ajakan baru
    this.nudger.update(this._frame.time, { index: -1, settled: false })
    for (const c of this.crystals) this._endNudge(c)
  }

  _setHovered(i) {
    if (i === this.hovered) return
    this.hovered = i
    // feedback hover = cursor pointer di canvas + kilau kristal + tombol OPEN tersorot (tanpa animasi skala)
    this.engine?.setCursor('crystal', i >= 0)
  }

  /** Indeks kristal yang tombol OPEN-nya ada di bawah titik p (NDC -1..1, y ke atas), -1 kalau tidak ada. */
  _buttonAt(p) {
    const padX = (2 * BUTTON_HIT_PX) / this._screenW
    const padY = (2 * BUTTON_HIT_PX) / this._screenH
    for (let t = 0; t < this.crystals.length; t++) {
      const l = this.crystals[t].labels
      const r = l.buttonRect
      if (r && l.visible && pointInRect(p.x, p.y, { x0: r.x0 - padX, y0: r.y0 - padY, x1: r.x1 + padX, y1: r.y1 + padY })) {
        return t
      }
    }
    return -1
  }

  /** Kotak tombol OPEN kristal t dalam px CSS (y ke bawah), untuk tools verifikasi. null = belum tampil. */
  buttonRectPx(t) {
    const r = this.crystals[t]?.labels.buttonRect
    if (!r) return null
    const W = this._screenW
    const H = this._screenH
    return { x0: (r.x0 + 1) * 0.5 * W, x1: (r.x1 + 1) * 0.5 * W, y0: (1 - r.y1) * 0.5 * H, y1: (1 - r.y0) * 0.5 * H }
  }

  _endNudge(c) {
    c.nudgeT = -1
    c.env = { ring: -1, glow: 0, text: false, done: true }
    c.labels.setNudge(false)
  }

  /**
   * Jadwal + amplop ajakan klik (nudge.js). Kunjungan = kristal terdekat selama scene aktif dan interaktif.
   * settled = kristal itu diam tepat di tengah, scroll aktif, tidak sedang scroll, tidak auto-center.
   */
  _updateNudge(dt, time) {
    const sc = this._frame.scroll
    let visit = -1
    let best = Infinity
    this.crystals.forEach((c, t) => {
      const d = Math.abs(c.center - this.progress)
      if (d < best) {
        best = d
        visit = t
      }
    })
    if (!this.active || !this.interactive) visit = -1
    // diam = tidak ada sisa scroll yang belum dijalani (y sudah sampai target), bukan velocity = 0:
    // velocity meluruh sekitar 2 s sesudah auto-center selesai, hitungan 3 s harus mulai dari selesainya
    const settled = visit >= 0 && !!sc && sc.enabled && !sc.centering && Math.abs(sc.y - sc.target2) < 1e-4
      && best < SETTLE_EPS
    const reduced = !!this._mqReduced?.matches
    if (this.nudger.update(time, { index: visit, settled })) {
      const c = this.crystals[visit]
      const touch = this.engine.input.pointerType !== 'mouse' || !!this._mqCoarse?.matches
      c.nudgeT = 0
      c.labels.prepareNudge({ touch, reduced })
      this.nudgeLog.push({ index: visit, time, touch, reduced, count: this.nudger.count })
    }
    this.crystals.forEach((c, t) => {
      if (c.nudgeT < 0) return
      // scroll / detail / kristal lain di tengah: ajakan dihentikan (teks pudar, cincin hilang)
      if (!settled || visit !== t) {
        this._endNudge(c)
        return
      }
      c.env = nudgeEnvelope(c.nudgeT, reduced)
      c.labels.setNudge(c.env.text)
      if (c.env.done) this._endNudge(c)
      else c.nudgeT += dt
    })
  }

  /**
   * Detail dibuka untuk kristal t (dipanggil DetailController). delay = setengah durasi pemusatan scroll.
   * Kamera zoom -3.5 dalam 1.25 + delay s power3.in, putaran berhenti, parallax mati, plexus berkedip.
   * instant = deep link: langsung ke state akhir.
   */
  detailIn(t, delay = 0, { instant = false } = {}) {
    this.interactive = false
    this._setHovered(-1)
    // satu kristal sudah dibuka di sesi ini (klik, tombol, atau deep link): ajakan berhenti untuk sisa sesi
    this.nudger.markOpened()
    for (const c of this.crystals) this._endNudge(c)
    gsap.killTweensOf([this, this.spin, this.camera])
    const dur = CRYSTAL_DETAIL.zoomIn + delay
    if (instant) {
      this.cameraZoom = CRYSTAL_DETAIL.zoom
      this.spin.value = 0
      this.camera.touchAmount = 0
      this.camera.snap()
      return
    }
    gsap.to(this, { cameraZoom: CRYSTAL_DETAIL.zoom, duration: dur, ease: 'power3.in' })
    gsap.to(this.spin, { value: 0, duration: dur, ease: 'power2.out' })
    gsap.to(this.camera, { touchAmount: 0, duration: dur, ease: 'power2.out' })
    this.flashPlexus(t)
  }

  /** Detail ditutup: zoom balik dalam 1.45 s power3.out, putaran dan parallax kembali. */
  detailOut() {
    gsap.killTweensOf([this, this.spin, this.camera])
    gsap.to(this, { cameraZoom: 0, duration: CRYSTAL_DETAIL.zoomOut, ease: 'power3.out' })
    gsap.to(this.spin, { value: 1, duration: CRYSTAL_DETAIL.zoomOut, ease: 'power2.inOut' })
    gsap.to(this.camera, {
      touchAmount: 1, duration: CRYSTAL_DETAIL.zoomOut, ease: 'power2.inOut',
      onComplete: () => (this.interactive = true),
    })
  }

  /** Kedip plexus saat klik (igloo "hoverTimeline"): garis 3 x 0.075 s + 0.25 s, titik terang 1 -> 0 dalam 0.35 s. */
  flashPlexus(t) {
    const c = this.crystals[t]
    if (!c) return
    const lines = c.plexus.lines.material.uniforms.uOpacity
    const points = c.plexus.points.material.uniforms.uColor.value
    const base = new Color('#666666')
    const flash = { line: 0, point: 1 }
    const apply = () => {
      lines.value = PLEXUS.opacity * (1 + 2.5 * flash.line)
      points.copy(base).lerp(new Color(1, 1, 1), flash.point)
    }
    const tl = gsap.timeline({ onUpdate: apply, onComplete: apply })
    for (let i = 0; i < 3; i++) {
      tl.set(flash, { line: 1 }, i * 0.075 * 2)
      tl.set(flash, { line: 0 }, i * 0.075 * 2 + 0.075)
    }
    tl.fromTo(flash, { line: 1 }, { line: 0, duration: 0.25, ease: 'power2.out', immediateRender: false }, 0.45)
    tl.to(flash, { point: 0, duration: 0.35, ease: 'power2.out' }, 0)
    apply()
  }

  update({ time, scroll, delta, input }) {
    const camY = 4 * VERTICAL_OFFSET * this.progress
    this.camera.basePosition.set(0, camY, 5 + this.cameraZoom)
    this.camera.baseTarget.set(0, camY, 0)
    const fov = 45 - 5 * Math.abs(scroll.velocity)
    if (Math.abs(this.camera.fov - fov) > 1e-4) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }
    this.shared.uProgress.value = this.progress
    // blue noise temporal: offset acak baru tiap frame (refraksi + latar)
    this.shared.uBlueOffset.value.set(Math.random(), Math.random())
    const f = this._frame
    f.time = time
    f.dt = Math.min(0.1, delta / 1000)
    f.scroll = scroll
    // frost baru aktif sesudah pointer pernah bergerak: posisi awal (0, 0) = tengah layar, bukan mouse asli
    if (!this._pointerSeen && (input.position11.x !== 0 || input.position11.y !== 0)) this._pointerSeen = true
    f.pointer.copy(input.position11)
    f.snap = this._lastProgress === null || Math.abs(this.progress - this._lastProgress) > LABEL_SNAP
    this._lastProgress = this.progress
    // putaran berhenti saat detail: fase goyang ditahan sebanyak waktu yang "hilang" (spin < 1).
    // Saat spin = 1 lag tetap 0, jadi frame beku (freeze) identik dengan sebelum M6.
    this._spinLag += f.dt * (1 - this.spin.value)
    const wobTime = time - this._spinLag
    for (const c of this.crystals) {
      const d = c.center - this.progress
      const [sx, sy, sz] = c.spin
      const wob = Math.sin(wobTime * 0.3 + c.rand) * 0.1
      c.mesh.rotation.set(d * sx + wob, d * sy + wob, d * sz)
      // asap hanya saat kristal di tengah
      c.smoke.material.uniforms.uShow.value = Math.max(0, 1 - Math.abs(d) * 20)
    }
  }

  /**
   * Dipanggil tepat sebelum pass A, sesudah engine meng-update kamera: raycast frost, sim frost,
   * label (menempel ke bbox kristal yang sudah berputar, menghadap kamera), plexus.
   */
  _lateUpdate(camera) {
    const f = this._frame
    const now = performance.now()
    const pointScale = this.engine.globals.uResolution.value.y / 1300
    const reduced = !!this._mqReduced?.matches
    camera.updateMatrixWorld()
    this.raycaster.setFromCamera(f.pointer, camera)
    this._updateNudge(f.dt, f.time)
    let hovered = -1
    this.crystals.forEach((c, t) => {
      c.group.updateMatrixWorld(true)
      const near = Math.abs(c.center - this.progress) < FROST_RANGE
      if (c.frost && near) {
        let hit = null
        const hits = this._pointerSeen ? this.raycaster.intersectObject(c.mesh, false) : []
        if (hits.length && hits[0].uv1) hit = this._hit.copy(hits[0].uv1)
        if (hits.length) hovered = t
        c.frost.update(now, hit)
      }
      const offsetY = c.group.position.y - camera.position.y
      // sorot tombol = hover (dihaluskan dari frame lalu) atau kedip ajakan
      c.labels.update({
        camera, mesh: c.mesh, offsetY, time: f.time, dt: f.dt, width: this._screenW, height: this._screenH,
        snap: f.snap, enabled: Math.abs(offsetY) < 3, hot: Math.max(c.hover, c.env.glow), reduced,
      })
      c.labelsOn = c.labels.visible
      c.plexus.update(f.dt, offsetY, pointScale)
      c.plexusOn = c.plexus.visible
      // cincin ajakan: dari balik siluet kristal (0.55 radius bola batas) menjalar ke 1.35 radius
      const sph = c.mesh.geometry.boundingSphere
      c.center3.copy(sph.center).applyMatrix4(c.mesh.matrixWorld)
      c.ripple.set(c.center3, camera.quaternion, sph.radius * 0.55, sph.radius * 1.35, c.env.ring)
    })
    // tombol OPEN menang atas kristal di belakangnya (kotak tombol dari frame ini)
    if (this._pointerSeen) {
      const b = this._buttonAt(f.pointer)
      if (b >= 0) hovered = b
    }
    this._setHovered(this.interactive ? hovered : -1)
    // kilau kristal: hover dihaluskan (frame-rate independent), ajakan memberi denyut sendiri
    const k = 1 - Math.exp(-f.dt * HOVER_RATE)
    const L = this.look
    this.crystals.forEach((c, t) => {
      c.hover += ((this.hovered === t ? 1 : 0) - c.hover) * k
      c.material.frost.uIceGlow.value = Math.max(c.hover * L.hoverGlow, c.env.glow * L.nudgeGlow)
    })
  }
}

/** Bake Blender diekspor dengan UV glTF (origin kiri atas): tekstur tidak boleh di-flip. */
function flipForGltf(tex) {
  if (tex.flipY) {
    tex.flipY = false
    tex.needsUpdate = true
  }
  return tex
}
