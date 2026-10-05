import { ShaderMaterial, BufferGeometry, Float32BufferAttribute, Mesh } from 'three'
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
        uProgress: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    })
  }
}
