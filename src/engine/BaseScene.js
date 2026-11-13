import { Scene, WebGLRenderTarget, HalfFloatType } from 'three'
import { BaseCamera } from './BaseCamera.js'
import { renderTargetType } from './rtType.js'

/** compileAsync dengan `target` terpasang (varian shader yang sama dengan render ke RT), target lama dikembalikan. */
export function compileToTarget(renderer, scene, camera, target) {
  const prev = renderer.getRenderTarget()
  renderer.setRenderTarget(target)
  const done = renderer.compileAsync(scene, camera)
  renderer.setRenderTarget(prev)
  return done
}

/**
 * Satu section = satu Scene dengan kamera dan composer sendiri.
 * Subclass mengisi: async build(engine), update(frame), onShow(), onHide().
 * update() hanya dipanggil saat scene terlihat (scene di luar layar tidak di-update sama sekali).
 */
export class BaseScene extends Scene {
  constructor(section, { fov = 45 } = {}) {
    super()
    this.key = section.key
    this.section = section
    this.camera = new BaseCamera(fov)
    this.composer = null // dipasang Engine
    this.progress = 0
    this._active = false
    // true = upload() tidak butuh ukuran layar, jadi Engine.init boleh menjalankannya begitu build() selesai,
    // sementara scene lain masih mengunduh. Scene yang upload-nya membaca aspect / layout mengisi false.
    this.uploadEarly = true
  }

  get active() {
    return this._active
  }

  set active(v) {
    if (v === this._active) return
    this._active = v
    if (v) {
      this.camera.snap()
      this.onShow()
    } else {
      this.onHide()
    }
  }

  async build(_engine) {}
  update(_frame) {}
  onShow() {}
  onHide() {}

  /**
   * Precompile (blueprint 6.7): paksa semua objek visible, compileAsync, upload semua tekstur,
   * render sekali ke RT 2x2, lalu kembalikan flag. Menghilangkan patah saat scene pertama kali muncul.
   */
  async upload(renderer) {
    const saved = []
    this.traverse((o) => {
      saved.push([o, o.visible, o.frustumCulled])
      o.visible = true
      o.frustumCulled = false
    })
    // Kunci cache program three ikut render target (outputColorSpace): scene selalu dirender ke RT, jadi compile
    // juga harus dengan RT terpasang. Dulu compile tanpa target = varian layar yang tidak pernah dipakai, lalu
    // render 2x2 di bawah meng-compile varian RT secara sinkron (memblok). Target hanya dibaca saat compile()
    // sinkron di awal compileAsync, jadi langsung dikembalikan sebelum menunggu.
    const rt = new WebGLRenderTarget(2, 2, { type: renderTargetType(renderer, HalfFloatType) })
    await compileToTarget(renderer, this, this.camera, rt)
    performance.mark?.(`upload:${this.key}:compiled`)
    this.traverse((o) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []
      for (const m of mats) {
        for (const key of Object.keys(m)) {
          const v = m[key]
          if (v && v.isTexture) renderer.initTexture(v)
        }
        for (const u of Object.values(m.uniforms || {})) {
          if (u.value && u.value.isTexture) renderer.initTexture(u.value)
        }
      }
    })
    performance.mark?.(`upload:${this.key}:textures`)
    renderer.setRenderTarget(rt)
    renderer.render(this, this.camera)
    renderer.setRenderTarget(null)
    rt.dispose()
    for (const [o, vis, culled] of saved) {
      o.visible = vis
      o.frustumCulled = culled
    }
  }
}
