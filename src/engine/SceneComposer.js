import { WebGLRenderTarget, HalfFloatType, LinearFilter } from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'

/**
 * Composer kecil per scene (blueprint 4.2): render scene ke RT HalfFloat linear, lalu
 * jalankan pass grade (LUT, entry post) secara ping-pong. `output` = tekstur hasil akhir.
 * Ukuran ikut layar. Sim (frost, partikel, fluid) punya RT ukuran tetap sendiri, tidak lewat sini.
 */
export class SceneComposer {
  constructor(renderer) {
    this.renderer = renderer
    const opts = { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false }
    this.rtScene = new WebGLRenderTarget(1, 1, { ...opts, depthBuffer: true })
    this.rtA = new WebGLRenderTarget(1, 1, { ...opts, depthBuffer: false })
    this.rtB = new WebGLRenderTarget(1, 1, { ...opts, depthBuffer: false })
    this.passes = [] // ShaderMaterial dengan uniform tDiffuse
    this.quad = new FullScreenQuad(null)
    this.output = this.rtScene.texture
  }

  addPass(material) {
    this.passes.push(material)
    return material
  }

  setSize(w, h) {
    this.rtScene.setSize(w, h)
    this.rtA.setSize(w, h)
    this.rtB.setSize(w, h)
  }

  render(scene, camera) {
    const r = this.renderer
    // EffectComposer pmndrs mematikan renderer.autoClear, jadi RT harus dibersihkan manual.
    // Tanpa ini frame menumpuk (asap, salju, tepi alpha jadi gumpalan putih).
    r.setRenderTarget(this.rtScene)
    r.clear()
    r.render(scene, camera)

    let read = this.rtScene
    let write = this.rtA
    for (const pass of this.passes) {
      pass.uniforms.tDiffuse.value = read.texture
      this.quad.material = pass
      r.setRenderTarget(write)
      this.quad.render(r)
      read = write
      write = write === this.rtA ? this.rtB : this.rtA
    }
    r.setRenderTarget(null)
    this.output = read.texture
    return this.output
  }

  dispose() {
    this.rtScene.dispose()
    this.rtA.dispose()
    this.rtB.dispose()
    this.quad.dispose()
  }
}
