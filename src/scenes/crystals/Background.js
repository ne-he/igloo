import {
  Mesh, ShaderMaterial, BufferGeometry, Float32BufferAttribute, PlaneGeometry, Color, AdditiveBlending,
} from 'three'
import '../../glsl/chunks.js'
import { createFullscreenTriangle } from '../../compositor/CompositeMaterial.js'

// Lapisan latar scene kristal (skill ref 02 bagian 6.4 sampai 6.7), semua desain/aset sendiri.
// Semua blur sudah di-bake di tekstur (tidak ada blur pass). Teks dan shape ditaruh di kedalaman
// paling jauh (z clip ~1) dengan depthTest, jadi selalu di belakang kristal.

/** Latar fullscreen: dua lookup perlin berlawanan arah -> gradient abu biru, grid titik berkelip, blue noise. */
export function createBackground(globals, { perlin, dot, blue }, shared) {
  const mat = new ShaderMaterial({
    uniforms: {
      ...globals,
      tPerlin: { value: perlin },
      tDot: { value: dot },
      tBlue: { value: blue },
      uBlueOffset: shared.uBlueOffset,
      uProgress: shared.uProgress,
      uColorLight: { value: new Color('#c9d0df') },
      uColorDark: { value: new Color('#545b6b') },
      uDark: { value: 0.5 },
      uDot: { value: 0.55 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.9999, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      #include <igloo_globals>
      #include <igloo_noise>
      uniform sampler2D tPerlin;
      uniform sampler2D tDot;
      uniform sampler2D tBlue;
      uniform vec2 uBlueOffset;
      uniform float uProgress;
      uniform vec3 uColorLight;
      uniform vec3 uColorDark;
      uniform float uDark;
      uniform float uDot;
      varying vec2 vUv;
      void main() {
        vec2 uv = vec2(vUv.x * uAspect, vUv.y) * 0.3;
        float t = uTime * 0.075;
        // dua lookup bergerak berlawanan, ikut scroll di y
        float p1 = texture2D(tPerlin, uv + vec2(t, -0.65 * uProgress)).r;
        float p2 = texture2D(tPerlin, uv * 1.37 + vec2(-t, 0.65 * uProgress) + 0.31).r;
        float f = smoothstep(0.15, 0.85, p1 * p2 * 2.0);
        vec3 col = mix(uColorLight, uColorDark, f * uDark);
        // grid titik: tile 45x, tiap titik punya fase hash sendiri, berkelip segitiga periode 10 s
        vec2 cell = uv * 45.0 + vec2(0.0, -uProgress * 10.0);
        float d = texture2D(tDot, cell).r;
        float h = hash12(floor(cell + 0.5));
        float tw = 1.0 - abs(fract(h + 0.1 * uTime) * 2.0 - 1.0);
        col += d * tw * tw * uDot;
        col += texture2D(tBlue, gl_FragCoord.xy / 128.0 + uBlueOffset).rgb * 0.05;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  })
  const mesh = createFullscreenTriangle(mat)
  mesh.renderOrder = -99
  mesh.name = 'crystals_bg'
  return mesh
}

/** Teks raksasa buram: quad di clip space, parallax per kedalaman, muncul-hilang oleh perlin. */
export function createBlurryText(globals, { atlas, perlin }, info, shared, count = 22, seed = 7) {
  let s = seed
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const pos = []
  const uv = []
  const centr = []
  const index = []
  for (let i = 0; i < count; i++) {
    const line = info.lines[Math.floor(rnd() * info.lines.length)]
    const c = [rnd() * 2 - 1, rnd(), Math.pow(rnd(), 1.5)]
    const a = line.aspect
    const base = i * 4
    const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]
    const uvs = [[line.u0, line.v0], [line.u1, line.v0], [line.u1, line.v1], [line.u0, line.v1]]
    for (let k = 0; k < 4; k++) {
      pos.push(corners[k][0] * a, corners[k][1], 0)
      uv.push(...uvs[k])
      centr.push(...c)
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.setAttribute('centr', new Float32BufferAttribute(centr, 3))
  g.setIndex(index)
  const mat = new ShaderMaterial({
    uniforms: {
      ...globals,
      tAtlas: { value: atlas },
      tPerlin: { value: perlin },
      uProgress: shared.uProgress,
      uSize: { value: 0.07 },
      uOpacity: { value: 0.14 },
      uColor: { value: new Color('#f2f5fb') },
    },
    vertexShader: /* glsl */ `
      #include <igloo_globals>
      uniform sampler2D tPerlin;
      uniform float uProgress;
      uniform float uSize;
      attribute vec3 centr;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        vUv = uv;
        float depth = centr.z;
        // treadmill vertikal: yang dekat (depth besar) bergerak lebih cepat saat scroll
        float y = fract(centr.y + uProgress * 1.25 * depth) * 2.8 - 1.4;
        float size = uSize * 2.5 * mix(1.0, 2.0, depth) * 0.5;
        vec2 c = vec2(centr.x * 1.15, y);
        vec2 p = c + position.xy * size * vec2(1.0 / uAspect, 1.0);
        float n = texture2D(tPerlin, centr.xy * 3.0 + vec2(0.075 * uTime) + depth * 10.0).r;
        vAlpha = smoothstep(0.35, 0.7, n) * mix(0.55, 1.0, depth);
        gl_Position = vec4(p, 0.9998, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tAtlas;
      uniform float uOpacity;
      uniform vec3 uColor;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        float a = texture2D(tAtlas, vUv).r * vAlpha * uOpacity;
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    depthWrite: false,
  })
  const mesh = new Mesh(g, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = -98
  mesh.name = 'crystals_blurrytext'
  return mesh
}

// 6 kartu polihedra buram (atlas 2 x 4 sel). x, y, z dunia di depan kamera tetap z = 5.
const SHAPES = [
  { pos: [-3.2, -1.2, -3.0], size: 2.2, cell: 1 },
  { pos: [3.4, -3.6, -3.6], size: 2.6, cell: 3 },
  { pos: [-3.8, -5.6, -4.2], size: 3.0, cell: 6 },
  { pos: [2.9, -7.4, -2.8], size: 2.0, cell: 4 },
  { pos: [-2.7, -9.2, -3.4], size: 2.4, cell: 7 },
  { pos: [3.6, -11.0, -4.0], size: 2.8, cell: 1 },
]

/** Shape buram: kartu additive, berputar ikut scroll, kamera sendiri (tidak ikut kamera scene). */
export function createShapes(globals, { shapes }, shared) {
  const pos = []
  const uv = []
  const centr = []
  const rand = []
  const index = []
  SHAPES.forEach((sh, i) => {
    const col = sh.cell % 2
    const row = Math.floor(sh.cell / 2)
    const u0 = col * 0.5
    const v1 = 1 - row * 0.25
    const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]
    const uvs = [[u0, v1 - 0.25], [u0 + 0.5, v1 - 0.25], [u0 + 0.5, v1], [u0, v1]]
    const r = (Math.sin(i * 12.9898 + 4.1) * 43758.5453) % 1
    for (let k = 0; k < 4; k++) {
      pos.push(corners[k][0] * sh.size, corners[k][1] * sh.size, 0)
      uv.push(...uvs[k])
      centr.push(...sh.pos)
      rand.push(Math.abs(r))
    }
    const b = i * 4
    index.push(b, b + 1, b + 2, b, b + 2, b + 3)
  })
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.setAttribute('centr', new Float32BufferAttribute(centr, 3))
  g.setAttribute('primrand', new Float32BufferAttribute(rand, 1))
  g.setIndex(index)
  const mat = new ShaderMaterial({
    uniforms: {
      ...globals,
      tShapes: { value: shapes },
      uProgress: shared.uProgress,
      uColor: { value: new Color('#dfe6f2') },
      uOpacity: { value: 0.4 },
    },
    vertexShader: /* glsl */ `
      #include <igloo_globals>
      uniform float uProgress;
      attribute vec3 centr;
      attribute float primrand;
      varying vec2 vUv;
      varying float vRand;
      void main() {
        vUv = uv;
        vRand = primrand;
        float ang = uProgress * 5.0 * mix(0.1, 0.5, primrand) + 0.2 * uTime * primrand;
        float c = cos(ang), s = sin(ang);
        vec3 p = vec3(c * position.x - s * position.y, s * position.x + c * position.y, 0.0);
        vec3 w = centr + p;
        w.x *= clamp(uAspect * 0.5, 0.65, 1.0);
        w.y += uProgress * 10.0;
        vec4 clip = projectionMatrix * vec4(w - vec3(0.0, 0.0, 5.0), 1.0);
        clip.z = clip.w * 0.9997;
        gl_Position = clip;
      }
    `,
    fragmentShader: /* glsl */ `
      #include <igloo_globals>
      uniform sampler2D tShapes;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      varying float vRand;
      void main() {
        float a = texture2D(tShapes, vUv).r;
        float t = uTime + vRand * 40.0;
        float shimmer = (0.5 + 0.5 * sin(t * 1.3)) * (0.5 + 0.5 * sin(t * 2.1 + 1.7)) * (0.5 + 0.5 * sin(t * 0.7 + 4.0));
        a *= max(0.1, shimmer) * uOpacity;
        gl_FragColor = vec4(uColor * a, 1.0);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  })
  const mesh = new Mesh(g, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = -97
  mesh.name = 'crystals_shapes'
  return mesh
}

/** Asap di belakang kristal: billboard 2.5 x 3.5, dua lookup wind noise dikali, hanya saat kristal di tengah. */
export function createSmoke(globals, { wind }) {
  const mat = new ShaderMaterial({
    uniforms: {
      ...globals,
      tWind: { value: wind },
      uShow: { value: 0 },
      uSeed: { value: 0 },
      uColor: { value: new Color('#dce1ea') },
      uOpacity: { value: 0.16 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      #include <igloo_globals>
      uniform sampler2D tWind;
      uniform float uShow;
      uniform float uSeed;
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() {
        float t = uTime + uSeed * 10.0;
        float n = texture2D(tWind, vUv * vec2(0.9, 0.6) + vec2(t * 0.012, -t * 0.03)).r;
        n *= texture2D(tWind, vUv * vec2(1.4, 1.1) + vec2(-t * 0.02, -t * 0.018) + uSeed).r;
        // masker cincin lembut: tipis di tengah, tebal di sekeliling, hilang di tepi kartu
        vec2 q = (vUv - 0.5) * 2.0;
        float r = length(q);
        float mask = smoothstep(1.0, 0.45, r) * mix(0.45, 1.0, smoothstep(0.1, 0.6, r));
        float a = clamp(n * 6.5, 0.0, 1.0) * mask * uShow * uOpacity;
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    depthWrite: false,
  })
  const mesh = new Mesh(new PlaneGeometry(2.5, 3.5), mat)
  mesh.renderOrder = 5
  mesh.name = 'crystal_smoke'
  return mesh
}
