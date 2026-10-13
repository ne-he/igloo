import {
  Color, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, Vector2, WebGLRenderTarget, HalfFloatType,
  LinearFilter, LinearMipmapLinearFilter, FrontSide, BackSide, PMREMGenerator, EquirectangularReflectionMapping,
} from 'three'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import { BaseScene } from '../../engine/BaseScene.js'
import { loadGeometry, loadTexture } from '../../engine/Assets.js'
import { makeLutTexture, LutMaterial } from '../../grade/Lut.js'
import { CRYSTAL_COUNT, crystalCenter } from '../sections.js'
import { CrystalMaterial, makeFlatTexture, makeIceUniforms } from './CrystalMaterial.js'
import { createBackground, createBlurryText, createShapes, createSmoke } from './Background.js'

const VERTICAL_OFFSET = -5.75 // jarak antar kristal (blueprint 5.3)

// 'custom' = refraksi 2-pass sendiri (target M5a). 'fallback' = transmission bawaan three
// (transmission 1, ior 1.18, thickness 2, roughness 0.65), objek dalam terlihat langsung. Spec poin 6.
export const REFRACTION = 'custom'

// Grade sendiri: S-curve ringan + geser dingin (bukan LUT igloo). Live: __igloo.engine.scenes[1].setGrade({...})
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
 * Label, TEMP, plexus, mouse frost = M5b (belum di sini).
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
  }

  async build(engine) {
    this.engine = engine
    this.renderer = engine.renderer
    const g = engine.globals
    const names = Array.from({ length: CRYSTAL_COUNT }, (_, t) => t + 1)
    const linear = (f) => loadTexture(f, 'linear').then(flipForGltf)
    const srgb = (f) => loadTexture(f, 'srgb').then(flipForGltf)
    const [crystalGeos, innerGeos, normals, roughs, innerMaps, blue, perlin, dot, atlas, shapes, wind, env, atlasInfo] =
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
      ])

    this.flat = makeFlatTexture('#A6ABB7')
    this.ice = makeIceUniforms({ flat: this.flat, blueNoise: blue })
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
      // objek dalam: bake plester terang, digambar terakhir dengan depth dibersihkan dulu, jadi selalu tampil
      // di dalam kristalnya walau dinding rongga (normal menghadap ke dalam) ikut dirender BackSide di pass A
      const inner = new Mesh(innerGeos[t], new MeshBasicMaterial({ map: innerMaps[t], color: new Color(0.78, 0.79, 0.82) }))
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
      group.add(mesh, smoke)
      const sign = () => (Math.random() < 0.5 ? -1 : 1)
      this.crystals.push({
        group, mesh, inner, smoke, material,
        center: crystalCenter(t),
        spin: [11 * sign(), 14 * sign(), 6 * sign()],
        rand: 1.3 + t * 2.7, // fase goyang tetap (screenshot deterministik)
      })
      this.add(group)
    }

    this.lut = makeLutTexture(CRYSTAL_GRADE)
    this.grade = this.composer.addPass(new LutMaterial(this.lut, { gradientAlpha: 0 }))

    // RT pass A: resolusi internal penuh, HalfFloat, mipmap (three r165 membuat mip otomatis sesudah render).
    this._transmissionRT = new WebGLRenderTarget(1, 1, {
      type: HalfFloatType,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
    })
    if (REFRACTION === 'custom') {
      // pass A dijalankan tepat sebelum render composer (pass B), sesudah engine meng-update kamera
      const renderB = this.composer.render.bind(this.composer)
      this.composer.render = (scene, camera) => {
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
    for (const c of this.crystals) {
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

  update({ time, scroll }) {
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
    for (const c of this.crystals) {
      const d = c.center - this.progress
      const [sx, sy, sz] = c.spin
      const wob = Math.sin(time * 0.3 + c.rand) * 0.1
      c.mesh.rotation.set(d * sx + wob, d * sy + wob, d * sz)
      // asap hanya saat kristal di tengah
      c.smoke.material.uniforms.uShow.value = Math.max(0, 1 - Math.abs(d) * 20)
    }
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
