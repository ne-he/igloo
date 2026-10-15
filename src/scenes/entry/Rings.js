import {
  Group, Mesh, ShaderMaterial, PlaneGeometry, RingGeometry, BufferGeometry, Float32BufferAttribute,
  AdditiveBlending, DoubleSide, Vector3,
} from 'three'
import { ROOM_GRADIENT, WIND_SMOKE, ENTRY_MATH, roomUniforms } from './glsl.js'
import { RING_Y, FORCEFIELD_Y } from './timeline.js'

// Portal: 3 cincin pecah + forcefield + plasma + asap trail (skill ref 02 bagian 7.1, 7.2, 7.4).
// Aset cincin: tools/blender/build_entry.py (ring_a 4 keping, ring_b 6 keping, atribut _centr/_rand).
// Urutan varian selang-seling b, a, b seperti layout asli. Semua shader ditulis sendiri.
const VARIANT = ['ring_b', 'ring_a', 'ring_b']
const PI = Math.PI

const RING_VERT = /* glsl */ `
  #include <igloo_globals>
  ${ENTRY_MATH}
  attribute vec3 _centr;
  attribute vec3 _rand;
  uniform float uNear;
  uniform float uExplode;
  varying vec2 vUv;
  varying float vDepth;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec3 c = _centr;
    vec3 p = position - c;
    // tiap keping berputar di sumbu acak: makin jauh dari kamera makin terlihat pecah
    vec4 cView = modelViewMatrix * vec4(c, 1.0);
    float far = smoothstep(1.5, 12.0, -cView.z);
    vec3 axis = normalize(_rand * 2.0 - 1.0 + 1e-3);
    float wob = sin(uTime * (0.6 + _rand.y) + _rand.x * 6.2832);
    p = rotAxis(axis, (0.5 * far + 0.1 * wob * uNear) * (_rand.z * 2.0 - 0.7)) * p;
    // saat kamera dekat keping membuka (miring di sumbu tangennya) dan terdorong keluar sepanjang centroid
    vec3 radial = normalize(vec3(c.xy, 0.0) + 1e-4);
    vec3 tang = vec3(-radial.y, radial.x, 0.0);
    p = rotAxis(tang, uNear * 0.3 * 3.14159 * (_rand.x - 0.5)) * p;
    vec3 cc = c + radial * uNear * mix(0.075, 0.15, _rand.z) * uExplode;
    cc.z += wob * 0.05 * uNear;
    // seluruh cincin ikut berputar di bidangnya, sedikit beda per keping
    float spin = uNear * 0.3 * 3.14159 * (0.5 + (_rand.y - 0.5) * 0.4);
    p = rotAxis(vec3(0.0, 0.0, 1.0), spin) * (cc + p);
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    vec4 mv = viewMatrix * world;
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`

const RING_FRAG = /* glsl */ `
  #include <igloo_globals>
  ${ROOM_GRADIENT}
  ${ENTRY_MATH}
  uniform sampler2D tMap;
  uniform sampler2D tGlow;
  uniform float uNear;
  uniform float uExposure;
  uniform float uGlow;
  varying vec2 vUv;
  varying float vDepth;
  varying vec3 vWorld;
  void main() {
    vec3 base = texture2D(tMap, vUv).rgb * uExposure;
    float g = texture2D(tGlow, vUv).r;
    vec2 s = gl_FragCoord.xy / uResolution;
    // cincin jauh larut ke gradient ruang (kabut tanpa scene.fog)
    vec3 col = mix(base, roomGradient(s), smoothstep(2.5, 10.0, vDepth) * 0.85);
    // masker glow: cahaya biru di muka dalam + celah, berdenyut noise, makin kuat saat kamera dekat
    float n = sineNoise(vWorld * 4.0 + vec3(0.0, uTime * 0.6, 0.0)) * 0.5 + 0.5;
    col += g * vec3(0.5, 0.7, 1.0) * (0.35 + 0.65 * n) * (0.35 + uNear) * 0.8 * uGlow;
    gl_FragColor = vec4(col, 1.0);
  }
`

/** Bake Blender diekspor dengan UV glTF (origin kiri atas): tekstur tidak boleh di-flip. */
export function flipForGltf(tex) {
  if (tex.flipY) {
    tex.flipY = false
    tex.needsUpdate = true
  }
  return tex
}

export function createRings(globals, { geos, maps, glows }) {
  const group = new Group()
  group.name = 'rings'
  const rings = RING_Y.map((y, i) => {
    const v = VARIANT[i]
    const mat = new ShaderMaterial({
      uniforms: {
        ...globals, ...roomUniforms(),
        tMap: { value: maps[v] }, tGlow: { value: glows[v] },
        uNear: { value: 0 }, uExplode: { value: 2.0 }, uExposure: { value: 1.0 }, uGlow: { value: 1.0 },
      },
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
    })
    const mesh = new Mesh(geos[v], mat)
    mesh.name = `ring${i + 1}`
    mesh.position.y = y
    mesh.rotation.x = -PI / 2
    mesh.frustumCulled = false // vertex shader menggeser keping keluar dari bounding sphere asli
    mesh.renderOrder = 1
    group.add(mesh)
    return mesh
  })
  return { group, rings }
}

/**
 * Forcefield cincin: plane datar 1x1 skala 0.65, additive (0.7, 0.8, 1). Pita sin(noise * 13 + t - r * 10)
 * dari dua lapis clouds noise, aastep lewat fwidth, pola segitiga yang didistorsi noise, tepi melingkar,
 * lubang tengah yang membesar saat kamera mendekat.
 */
export function createForcefields(globals, { clouds, triangles }) {
  const geo = new PlaneGeometry(1, 1).rotateX(-PI / 2)
  return FORCEFIELD_Y.map((y, i) => {
    const mat = new ShaderMaterial({
      uniforms: {
        ...globals, tClouds: { value: clouds }, tTri: { value: triangles },
        uShow: { value: 0 }, uHole: { value: 0.15 }, uSeed: { value: i * 0.37 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        #include <igloo_globals>
        uniform sampler2D tClouds;
        uniform sampler2D tTri;
        uniform float uShow;
        uniform float uHole;
        uniform float uSeed;
        varying vec2 vUv;
        void main() {
          vec2 c = vUv - 0.5;
          float r = length(c) * 2.0;
          if (r > 1.0 || uShow <= 0.0) discard;
          float t = uTime;
          float n = texture2D(tClouds, vUv * 0.7 + vec2(t * 0.013, -t * 0.009) + uSeed).r;
          n *= texture2D(tClouds, vUv * 1.3 - vec2(t * 0.011, t * 0.017) + uSeed * 1.7).r * 1.6;
          float bands = sin(n * 13.0 + t - r * 10.0);
          float w = fwidth(bands);
          float b = smoothstep(0.45 - w, 0.45 + w, bands);
          vec2 tuv = vUv * 1.6 + (n - 0.4) * 0.04;
          float tri = texture2D(tTri, tuv).r;
          float rim = smoothstep(0.8, 0.97, r) * (1.0 - smoothstep(0.97, 1.0, r));
          float hole = smoothstep(uHole, uHole + 0.18, r);
          // pita dan segitiga tipis saja, tepi melingkar yang paling terbaca (cahaya biru di bibir dalam cincin)
          float a = (b * 0.07 + tri * b * 0.15 + rim * 0.55) * hole * smoothstep(1.0, 0.94, r);
          gl_FragColor = vec4(vec3(0.7, 0.8, 1.0) * a * uShow, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    })
    const mesh = new Mesh(geo, mat)
    mesh.name = `forcefield${i + 1}`
    mesh.position.y = y
    mesh.scale.setScalar(0.65)
    mesh.renderOrder = 6
    return mesh
  })
}

/** Plasma: cakram polar tipis di bawah tiap cincin, pita sempit asap biru additive, tampil saat kamera dekat. */
export function createPlasma(globals, { wind }) {
  const geo = new RingGeometry(0.2, 0.62, 128, 6).rotateX(-PI / 2)
  return RING_Y.map((y, i) => {
    const mat = new ShaderMaterial({
      uniforms: { ...globals, tWind: { value: wind }, uShow: { value: 0 }, uSeed: { value: i * 0.53 } },
      vertexShader: /* glsl */ `
        varying vec3 vPos;
        void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        #include <igloo_globals>
        ${WIND_SMOKE}
        uniform float uShow;
        uniform float uSeed;
        varying vec3 vPos;
        void main() {
          float r = length(vPos.xz);
          float v = windSmoke(vPos.xz * 1.4 + uSeed, vec2(0.05, -0.08), uTime) * 0.5;
          float bd = (r - 0.43) / 0.08; // kuadrat eksplisit: pow() basis negatif = NaN di GLSL
          float band = exp(-bd * bd);
          float a = (pow(clamp(v * 1.7, 0.0, 2.0), 4.0) * 0.8 + 0.12) * band;
          gl_FragColor = vec4(vec3(0.65, 0.8, 1.0) * a * uShow, 1.0);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    })
    const mesh = new Mesh(geo, mat)
    mesh.name = `plasma${i + 1}`
    mesh.position.y = y + 0.05
    mesh.renderOrder = 5
    return mesh
  })
}

/** Dua pita melengkung di sekitar cincin (geometri dibangun di sini, tidak ada file). */
function ribbonGeometry() {
  const pos = []
  const uv = []
  const index = []
  const SEG = 48
  const ACROSS = 4
  let base = 0
  for (const [a0, flip] of [[0.4, 1], [0.4 + PI, -1]]) {
    for (let i = 0; i <= SEG; i++) {
      const s = i / SEG
      const ang = a0 + s * 2.3
      const R = 0.75 + 0.6 * s
      const h = (-0.25 + 0.9 * Math.pow(s, 1.4)) * flip * 0.8
      const radial = new Vector3(Math.cos(ang), 0, Math.sin(ang))
      // arah lebar pita: campuran vertikal dan radial supaya terpilin pelan sepanjang busur
      const across = new Vector3(0, 1, 0).multiplyScalar(Math.cos(s * 2.0)).addScaledVector(radial, Math.sin(s * 2.0) * 0.8).normalize()
      const width = 0.18 + 0.22 * Math.sin(s * PI)
      for (let j = 0; j <= ACROSS; j++) {
        const t = j / ACROSS - 0.5
        const p = radial.clone().multiplyScalar(R).add(new Vector3(0, h, 0)).addScaledVector(across, t * width)
        pos.push(p.x, p.y, p.z)
        uv.push(s, j / ACROSS)
      }
    }
    for (let i = 0; i < SEG; i++) {
      for (let j = 0; j < ACROSS; j++) {
        const a = base + i * (ACROSS + 1) + j
        const b = a + ACROSS + 1
        index.push(a, b, a + 1, b, b + 1, a + 1)
      }
    }
    base += (SEG + 1) * (ACROSS + 1)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.setIndex(index)
  return g
}

/** Asap trail: alpha = min(1, (v * 2.75)^3), pudar terhadap kedalaman 0.5..2..15, warna (0.85, 0.9, 1). */
export function createSmokeTrails(globals, { wind }) {
  const geo = ribbonGeometry()
  return RING_Y.map((y, i) => {
    const mat = new ShaderMaterial({
      uniforms: { ...globals, tWind: { value: wind }, uShow: { value: 1 }, uSeed: { value: i * 0.29 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying float vDepth;
        void main() {
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        #include <igloo_globals>
        ${WIND_SMOKE}
        uniform float uShow;
        uniform float uSeed;
        varying vec2 vUv;
        varying float vDepth;
        void main() {
          float v = windSmoke(vUv * vec2(2.0, 0.6) + uSeed, vec2(-0.06, 0.02), uTime) * 0.5;
          float a = min(1.0, pow(v * 2.75, 3.0));
          a *= smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.6, vUv.x) * sin(vUv.y * 3.14159);
          a *= smoothstep(0.5, 2.0, vDepth) * (1.0 - smoothstep(6.0, 15.0, vDepth));
          gl_FragColor = vec4(vec3(0.85, 0.9, 1.0), a * 0.55 * uShow);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    })
    const mesh = new Mesh(geo, mat)
    mesh.name = `smoketrail${i + 1}`
    mesh.position.y = y
    mesh.renderOrder = 7
    return mesh
  })
}
