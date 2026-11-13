import { ShaderMaterial, BufferGeometry, Float32BufferAttribute, Mesh, Vector2 } from 'three'
import { loadTexture } from '../engine/Assets.js'
import '../glsl/chunks.js'
import { FULLSCREEN_VERT } from '../glsl/chunks.js'
import fragmentShader from './composite.frag?raw'

/** Fullscreen triangle (3 vertex, menutup layar tanpa diagonal seam seperti quad). */
export function createFullscreenTriangle(material) {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
  g.setAttribute('uv', new Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2))
  const mesh = new Mesh(g, material)
  mesh.frustumCulled = false
  return mesh
}

export class CompositeMaterial extends ShaderMaterial {
  constructor(globals) {
    super({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader,
      uniforms: {
        ...globals,
        tScene1: { value: null },
        tScene2: { value: null },
        tMask: { value: null },
        tBlue: { value: null },
        uBlueOffset: { value: new Vector2() },
        uProgress: { value: 0 },
        // cabang detail (M6): diisi Engine kalau scene detail terdaftar
        tDetail: { value: null },
        uDetailProgress: { value: 0 },
        uDetailProgress2: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    })
  }

  /**
   * Tekstur data: linear (bukan sRGB), repeat, tanpa mipmap. Lewat cache Assets dengan mode yang sama persis
   * dengan EntryScene / CrystalsScene, jadi satu request dan satu upload GPU dipakai bersama (dulu dimuat dua kali).
   * Mask = WebP lossless (piksel identik dengan PNG lama, 0.35 MB vs 0.47 MB).
   */
  async loadTextures() {
    const [mask, blue] = await Promise.all([
      loadTexture('transition_mask.webp', 'data-repeat'),
      loadTexture('blue_noise_128.png', 'data-repeat-nearest'),
    ])
    this.uniforms.tMask.value = mask
    this.uniforms.tBlue.value = blue
  }

  /** Offset blue noise acak tiap frame (dither temporal, menyembunyikan banding CA). */
  jitter() {
    this.uniforms.uBlueOffset.value.set(Math.random(), Math.random())
  }
}
