import gsap from 'gsap'
import { BaseScene } from '../../engine/BaseScene.js'
import { makeLutTexture, LutMaterial } from '../../grade/Lut.js'
import { createSky, createGround, createMountain, createIglooStandIn } from './look.js'

// Grade sendiri untuk scene igloo (bukan LUT igloo asli). Di-tune terhadap statistik warna ref 03
// lewat tools/verify/palette.py (6 sapuan, skor 66 -> 13.8 pada 5 Okt 2026). Bisa diubah live: __igloo.engine.scenes[0].setGrade({...}).
export const IGLOO_GRADE = { blackPoint: 0.35, gamma: 1.3, shoulder: 0.64, saturation: 0.42, tint: [0.006, 0.004, -0.022] }

// Gunung jauh di belakang igloo (arah pandang kamera istirahat), skala dan jarak bervariasi.
const MOUNTAINS = [
  { pos: [34, -1, -44], scale: 1.4, rotY: 0.4, seed: 1.3 },
  { pos: [80, -3, -70], scale: 2.6, rotY: 1.1, seed: 4.7 },
  { pos: [-6, -2, -78], scale: 2.2, rotY: 2.2, seed: 8.1 },
  { pos: [120, -4, -10], scale: 3.2, rotY: 0.9, seed: 2.2 },
  { pos: [40, -6, -150], scale: 5, rotY: 0.2, seed: 6.6 },
]

/**
 * Scene 1: igloo. M0.5 = palette test (langit, kabut, gunung, tanah, igloo pengganti, LUT).
 * Jalur kamera = data asli (blueprint 6.4): timeline 21 s di-scrub progress.
 * Titik istirahat p = 0.495 -> kamera (-13.49, 2.65, 14.43) menatap (0, 1.24, 0).
 */
export class IglooScene extends BaseScene {
  constructor(section) {
    super(section, { fov: 30 })
    this.camera.displacement.set(0.07, 0.025)
    this.camera.shake = 0.01
    this.camera.shakeSpeed = 0.5
    this.camera.zoomFactor = 1.25
  }

  async build(engine) {
    const g = engine.globals
    this.add(createSky(g))
    this.add(createGround(g))
    for (const m of MOUNTAINS) {
      const mesh = createMountain(g, { seed: m.seed })
      mesh.position.set(...m.pos)
      mesh.scale.setScalar(m.scale)
      mesh.rotation.y = m.rotY
      this.add(mesh)
    }
    this.igloo = createIglooStandIn(g)
    this.add(this.igloo)

    this.lut = makeLutTexture(IGLOO_GRADE)
    this.grade = this.composer.addPass(new LutMaterial(this.lut, { gradientAlpha: 1 }))

    this.cam = { px: -13.25, py: 11.5, pz: 13.25, ty: 15 }
    this.timeline = gsap.timeline({ paused: true })
      .to(this.cam, { py: 2.5, ty: 1, duration: 14, ease: 'power2.out' }, 0)
      .to(this.cam, { px: -15.25, pz: 23.25, duration: 14, ease: 'power1.inOut' }, 7)
  }

  /** Ganti parameter grade live (dipakai saat tuning palet). */
  setGrade(params) {
    const next = makeLutTexture({ ...IGLOO_GRADE, ...params })
    this.grade.uniforms.tLUT.value = next
    this.lut.dispose()
    this.lut = next
  }

  update() {
    this.timeline.progress(this.progress)
    this.camera.basePosition.set(this.cam.px, this.cam.py, this.cam.pz)
    this.camera.baseTarget.set(0, this.cam.ty, 0)
  }
}
