import { Mesh, ShaderMaterial, CylinderGeometry, CircleGeometry, RingGeometry, AdditiveBlending, BackSide, DoubleSide } from 'three'
import { WIND_SMOKE } from './glsl.js'

// Asap terowongan, langit-langit, dan lantai ruang (skill ref 02 bagian 7.4). Semua resep sama:
// tiga lookup wind noise dikalikan, bedanya hanya pemetaan UV, kecepatan, dan fade. Geometri prosedural.
const PI = Math.PI

const PLAIN_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vPos;
  void main() {
    vUv = uv;
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/** Terowongan: silinder terbuka r 1.3 h 9 (64 x 32) dilihat dari dalam, alpha (v^3) * 3, tampil saat progress < 0.52. */
export function createTunnel(globals, { wind }) {
  const geo = new CylinderGeometry(1.3, 1.3, 9, 64, 32, true)
  const mat = new ShaderMaterial({
    uniforms: { ...globals, tWind: { value: wind }, uShow: { value: 1 } },
    vertexShader: PLAIN_VERT,
    fragmentShader: /* glsl */ `
      #include <igloo_globals>
      ${WIND_SMOKE}
      uniform float uShow;
      varying vec2 vUv;
      void main() {
        // asap mengalir ke atas (kamera turun), u membungkus keliling tanpa jahitan
        float v = windSmokeWrap(vUv.x, vUv.y * 3.0, -uTime * 0.6) * 0.5;
        float a = pow(v, 3.0) * 3.0;
        a *= smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0), clamp(a, 0.0, 1.0) * 0.7 * uShow);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: BackSide,
  })
  const mesh = new Mesh(geo, mat)
  mesh.name = 'tunnel'
  // membungkus poros dari bawah langit-langit ruang sampai di atas cincin pertama
  mesh.position.y = -5.0
  mesh.renderOrder = 3
  return mesh
}

/** Asap datar polar: cakram (langit-langit) atau annulus (lantai), additive, sisi kanan layar lebih terang. */
function flatSmoke(globals, wind, { strength, seed, flow }) {
  return new ShaderMaterial({
    uniforms: { ...globals, tWind: { value: wind }, uShow: { value: 1 }, uStrength: { value: strength }, uSeed: { value: seed } },
    vertexShader: PLAIN_VERT,
    fragmentShader: /* glsl */ `
      #include <igloo_globals>
      ${WIND_SMOKE}
      uniform float uShow;
      uniform float uStrength;
      uniform float uSeed;
      varying vec3 vPos;
      void main() {
        float r = length(vPos.xy) / 0.62;
        // putar pelan supaya asap terasa berpusar di sekitar poros
        float ang = uTime * ${flow.toFixed(3)};
        vec2 p = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * vPos.xy;
        float v = windSmoke(p * 1.6 + uSeed, vec2(0.04, -0.03), uTime) * 0.5;
        float a = pow(v * 1.6, 3.0);
        a *= smoothstep(1.0, 0.6, r) * smoothstep(0.15, 0.45, r);
        a *= mix(0.45, 1.35, gl_FragCoord.x / uResolution.x);
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a * uStrength * uShow, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  })
}

/** Asap langit-langit ruang: cakram r 0.62 skala 2 di y -9.4. */
export function createCeilingSmoke(globals, { wind }) {
  const geo = new CircleGeometry(0.62, 96)
  const mesh = new Mesh(geo, flatSmoke(globals, wind, { strength: 0.35, seed: 0.13, flow: 0.05 }))
  mesh.name = 'ceilingsmoke'
  mesh.rotation.x = PI / 2
  mesh.position.y = -9.4
  mesh.scale.set(2, 2, 1)
  mesh.renderOrder = 8
  return mesh
}

/** Asap lantai: annulus skala 5 di y -10.17, mengelilingi podium. */
export function createGroundSmoke(globals, { wind }) {
  const geo = new RingGeometry(0.2, 0.62, 128, 8)
  const mesh = new Mesh(geo, flatSmoke(globals, wind, { strength: 0.3, seed: 0.71, flow: -0.04 }))
  mesh.name = 'groundsmoke'
  mesh.rotation.x = -PI / 2
  mesh.position.y = -10.17
  mesh.scale.set(5, 5, 1)
  mesh.renderOrder = 8
  return mesh
}
