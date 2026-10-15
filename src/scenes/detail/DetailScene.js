import { Mesh, Group } from 'three'
import gsap from 'gsap'
import { BaseScene } from '../../engine/BaseScene.js'
import { loadGeometry, loadTexture } from '../../engine/Assets.js'
import { bus } from '../../engine/Bus.js'
import { CRYSTAL_COUNT } from '../sections.js'
import { MouseSim } from './MouseSim.js'
import {
  createBackground, createObjectMaterial, createLightShaft, createBokeh, createSparkles, createTrailParticles,
} from './parts.js'

// Warna dan angka forensik (blueprint 5.4, skill ref 01 bagian 2.5, ref 02 bagian 6.8).
// *Gain, objectExposure dan causticScale = tuning kita sendiri karena tekstur caustics/bokeh igloo diganti
// prosedural dan bake gelap kita lebih gelap. Dipilih lewat grid luminans 8x6 vs ref 08 (selisih rata-rata 6/255).
// objectExposure 1 = rumus asli (bake x 0.025..0.15), di bake kita hasilnya hampir hitam pekat.
export const DETAIL_LOOK = {
  bgDark: '#09121f',
  bgLight: '#6b7685',
  light: '#d1e3ff',
  little: '#2d3133',
  causticScale: 2.2,
  causticGain: 0.15,
  objectExposure: 1.4, // 2.5 terlalu terang dan menutupi panel teks vs ref 08
  shaftGain: 4,
  bokehGain: 5,
  sparkleGain: 1,
  trailGain: 3,
}

export const DETAIL = {
  sparkles: 250,
  trail: 10000, // jumlah asli igloo, tidak dikurangi (lihat laporan M6)
  cameraFar: 4, // kamera z 4 -> 2.5 dalam 2 s inOut1 saat buka, balik ke 4 dalam 0.6 s saat tutup
  cameraNear: 2.5,
  objectRadius: 0.95, // radius bounding sphere objek setelah dinormalisasi
  objectScale: [1.1, 1.2, 1.2], // skala per objek (igloo)
  objectPosition: [0.12, 0.08, 0],
  wobble: 0.035, // rad, goyang idle @ 0.3
}

/**
 * Scene detail proyek (M6): BaseScene dengan composer sendiri, dirender Engine hanya saat
 * uDetailProgress > 0. Isi: latar gradient navy, objek dalam kristal versi bake gelap + caustics,
 * light shaft, plane bokeh, 250 partikel berkelip, partikel jejak mouse (sim resolusi / 5).
 * Panel teks proyek ada di scene UI (DetailPanel), bukan di sini, jadi tidak kena transisi.
 */
export class DetailScene extends BaseScene {
  constructor() {
    super({ key: 'detail' }, { fov: 45 })
    this.camera.basePosition.set(0, 0, DETAIL.cameraFar)
    this.camera.baseTarget.set(0, 0, 0)
    this.camera.displacement.set(0, 0) // tanpa parallax
    this.camera.lerpPosition = 0.02
    this.camera.shake = 0.05
    this.camera.shakeSpeed = 0.05
    this.look = { ...DETAIL_LOOK }
    this.objects = []
    this.index = -1
    this.cameraZ = { value: DETAIL.cameraFar }
    this.sim = null
  }

  async build(engine) {
    this.engine = engine
    const g = engine.globals
    const names = Array.from({ length: CRYSTAL_COUNT }, (_, t) => t + 1)
    const [geos, maps, perlin] = await Promise.all([
      Promise.all(names.map((n) => loadGeometry(`inner${n}`))),
      Promise.all(names.map((n) => loadTexture(`inner${n}_dark_color.webp`, 'srgb').then(noFlip))),
      loadTexture('perlin.png', 'repeat'),
    ])
    this.sim = new MouseSim(engine.renderer)

    this.add(createBackground(g, this.look))
    this.objectGroup = new Group()
    this.objectGroup.position.fromArray(DETAIL.objectPosition)
    this.add(this.objectGroup)
    geos.forEach((geo, t) => {
      if (!geo.boundingSphere) geo.computeBoundingSphere()
      const bs = geo.boundingSphere
      // geometri dipakai bersama scene kristal: normalisasi lewat transform mesh, bukan geometri
      const mesh = new Mesh(geo, createObjectMaterial(g, { map: maps[t], perlin }, this.look))
      mesh.name = `detail_inner${t + 1}`
      const s = (DETAIL.objectRadius / bs.radius) * (DETAIL.objectScale[t] ?? 1) / 1.2
      const pivot = new Group()
      pivot.add(mesh)
      mesh.scale.setScalar(s)
      mesh.position.copy(bs.center).multiplyScalar(-s)
      pivot.visible = false
      this.objectGroup.add(pivot)
      this.objects.push(pivot)
    })
    this.shaft = createLightShaft(g, { perlin }, this.look)
    this.bokeh = createBokeh(g, { perlin }, this.look)
    this.sparkles = createSparkles(g, this.look, DETAIL.sparkles)
    this.trail = createTrailParticles(g, this.sim.uniform, this.look, DETAIL.trail)
    this.add(this.shaft, this.bokeh, this.sparkles, this.trail)

    bus.on('resize', ({ W, H, aspect }) => this.sim.setSize(W, H, aspect))
  }

  /** Tuning live (verifikasi side-by-side): __igloo.engine.detail.setLook({ objectExposure: 4, ... }). */
  setLook(params) {
    Object.assign(this.look, params)
    const L = this.look
    for (const o of this.objects) {
      const u = o.children[0].material.uniforms
      u.uExposure.value = L.objectExposure
      u.uCausticGain.value = L.causticGain
      u.uCausticScale.value = L.causticScale
    }
    this.shaft.material.uniforms.uGain.value = L.shaftGain
    this.bokeh.material.uniforms.uGain.value = L.bokehGain
    this.sparkles.material.uniforms.uGain.value = L.sparkleGain
    this.trail.material.uniforms.uGain.value = L.trailGain
  }

  /** Pilih objek proyek t (hanya satu yang terlihat). */
  setProject(t) {
    this.index = t
    this.objects.forEach((o, i) => (o.visible = i === t))
  }

  /** Animasi masuk: kamera z 4 -> 2.5 dalam 2 s inOut1, jejak mouse dikosongkan. instant = deep link. */
  playIn(t, { instant = false } = {}) {
    this.setProject(t)
    this.sim.clear()
    gsap.killTweensOf(this.cameraZ)
    if (instant) {
      this.cameraZ.value = DETAIL.cameraNear
      this.camera.basePosition.z = DETAIL.cameraNear
      this.camera.snap()
      return
    }
    this.cameraZ.value = DETAIL.cameraFar
    this.camera.basePosition.z = DETAIL.cameraFar
    this.camera.snap()
    gsap.to(this.cameraZ, { value: DETAIL.cameraNear, duration: 2, ease: 'inOut1' })
  }

  /** Animasi keluar: kamera balik ke z 4 dalam 0.6 s. */
  playOut() {
    gsap.killTweensOf(this.cameraZ)
    gsap.to(this.cameraZ, { value: DETAIL.cameraFar, duration: 0.6, ease: 'power2.inOut' })
  }

  update({ time, input }) {
    this.camera.basePosition.z = this.cameraZ.value
    const w = DETAIL.wobble
    this.objectGroup.rotation.set(Math.sin(time * 0.3) * w, Math.cos(time * 0.3 * 0.83 + 1.1) * w, 0)
    // posisi bokeh: x = -2.2 + sin(0.3 t) * 0.2, y = -0.87 + cos(0.24 t) * 0.2
    this.bokeh.position.x = -2.2 + Math.sin(0.3 * time) * 0.2
    this.bokeh.position.y = -0.87 + Math.cos(0.24 * time) * 0.2
    this.sim.update(performance.now(), input.position01)
  }
}

/** Bake Blender pakai UV glTF (origin kiri atas): jangan di-flip. */
function noFlip(tex) {
  if (tex.flipY) {
    tex.flipY = false
    tex.needsUpdate = true
  }
  return tex
}
