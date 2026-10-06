import gsap from 'gsap'
import { BaseScene } from '../../engine/BaseScene.js'
import { makeLutTexture, LutMaterial } from '../../grade/Lut.js'
import { createSky, createIglooStandIn } from './look.js'
import { createGround, createTerrain, createPatches, createMountains, createSnow, createSmoke, MousePoint } from './valley.js'

// Grade sendiri untuk scene igloo (bukan LUT igloo asli). Di-tune terhadap statistik warna ref 03
// lewat tools/verify/palette.py. Bisa diubah live: __igloo.engine.scenes[0].setGrade({...}).
export const IGLOO_GRADE = { blackPoint: 0.35, gamma: 1.3, shoulder: 0.64, saturation: 0.42, tint: [0.006, 0.004, -0.022] }

/**
 * Scene 1: igloo. M2 = lembah dengan aset bake sendiri (tanah, terrain x5, patch x2, gunung x5),
 * salju, asap angin, glow mouse di salju, LUT. Igloo masih pengganti (bata datang di M3).
 * Jalur kamera = data asli (blueprint 6.4): timeline 21 s di-scrub progress.
 * Titik istirahat p = 0.495 -> kamera (-13.49, 2.65, 14.43) menatap (0, 1.24, 0).
 * Fallback tanpa bake: createGround/createMountain prosedural di look.js.
 */
export class IglooScene extends BaseScene {
  constructor(section) {
    super(section, { fov: 30 })
    this.camera.displacement.set(0.07, 0.025)
    this.camera.shake = 0.01
    this.camera.shakeSpeed = 0.5
    this.camera.zoomFactor = 1.25
    this.mouse = new MousePoint()
  }

  async build(engine) {
    const g = engine.globals
    this.add(createSky(g))
    const [ground, terrain, patches, mountains, smoke] = await Promise.all([
      createGround(g, this.mouse.value), createTerrain(g), createPatches(g), createMountains(g), createSmoke(g),
    ])
    this.add(ground, terrain, patches, mountains, smoke, createSnow(g))
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

  update({ input, ratio }) {
    this.timeline.progress(this.progress)
    this.camera.basePosition.set(this.cam.px, this.cam.py, this.cam.pz)
    this.camera.baseTarget.set(0, this.cam.ty, 0)
    this.mouse.update(this.camera, input.position11, ratio)
  }
}
