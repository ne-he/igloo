import {
  Mesh, Points, ShaderMaterial, PlaneGeometry, SphereGeometry, CylinderGeometry, BufferGeometry,
  Float32BufferAttribute, AdditiveBlending, BackSide, DoubleSide,
} from 'three'
import { ROOM_GRADIENT, ENTRY_MATH, roomUniforms } from './glsl.js'

// Ruang link (skill ref 02 bagian 7.2, 7.3, 7.6): lantai, cincin halo, bola ruang, silinder teks buram,
// forcefield silinder di sekitar partikel, partikel ambien, coretan salju. Semua shader ditulis sendiri.
const PI = Math.PI
export const FLOOR_Y = -10.19
export const PARTICLES_Y = -9.785

/**
 * Lantai bergalur (tools/blender/build_entry.py): bake warna + glow biru di dasar alur (_glow) dengan riak,
 * ubin bertanda (_animationmask) bergoyang 0.03 rad di sumbu yang ikut berputar + naik turun 0.01,
 * digerakkan uRotationTime = 0.5 t + additionalTime. Bayangan palsu di bawah partikel, reveal radial.
 */
export function createFloor(globals, { geo, map }) {
  const mat = new ShaderMaterial({
    transparent: true,
    uniforms: {
      ...globals, ...roomUniforms(), tMap: { value: map },
      uRotationTime: { value: 0 }, uAlpha: { value: 0 }, uExposure: { value: 0.85 }, uGlow: { value: 1.4 },
    },
    vertexShader: /* glsl */ `
      ${ENTRY_MATH}
      uniform float uRotationTime;
      attribute float _iteration;
      attribute float _animationmask;
      attribute float _glow;
      varying vec2 vUv;
      varying vec3 vLocal;
      varying float vGlow;
      void main() {
        vUv = uv;
        vGlow = _glow;
        vec3 p = position;
        vLocal = p;
        if (_animationmask > 0.5) {
          float rt = uRotationTime;
          float it = _iteration;
          // tiap iterasi berputar pelan berlawanan arah, jadi pola tanda lantai terasa hidup
          float spin = rt * 0.035 * (mod(it, 2.0) < 0.5 ? 1.0 : -1.0);
          float cs = cos(spin), sn = sin(spin);
          p.xz = mat2(cs, -sn, sn, cs) * p.xz;
          // goyang: miring 0.03 rad di sumbu horizontal yang ikut berputar, plus naik turun 0.01
          float ph = rt * 1.3 + it * 1.9;
          vec3 axis = vec3(cos(ph), 0.0, sin(ph));
          p = rotAxis(axis, 0.03 * sin(rt * 0.9 + it * 2.1)) * p;
          p.y += 0.01 * sin(rt * 1.7 + it * 2.3);
          vLocal.xz = p.xz;
        }
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      #include <igloo_globals>
      #include <igloo_common>
      ${ROOM_GRADIENT}
      uniform sampler2D tMap;
      uniform float uAlpha;
      uniform float uExposure;
      uniform float uGlow;
      varying vec2 vUv;
      varying vec3 vLocal;
      varying float vGlow;
      void main() {
        vec3 c = texture2D(tMap, vUv).rgb * uExposure;
        float r = length(vLocal.xz);
        // bayangan palsu di bawah partikel, berkedip pelan dengan rona biru
        float sh = 1.0 - smoothstep(0.08, 0.55, r);
        c *= 1.0 - sh * 0.4 * (0.85 + 0.15 * sin(uTime * 2.3));
        c += sh * vec3(0.5, 0.7, 1.0) * 0.04;
        // glow biru di alur + riak sin(z * 5 + r * 10 - 0.75 t)
        float rip = sin(vLocal.z * 5.0 + r * 10.0 - 0.75 * uTime) * 0.5 + 0.5;
        c += vGlow * vec3(0.5, 0.7, 1.0) * (0.45 + 0.55 * rip) * uGlow;
        // geometri rendah (dinding bawah, celah) ikut kebiruan
        c += vec3(0.5, 0.7, 1.0) * smoothstep(0.0, -0.035, vLocal.y) * 0.25;
        // tepi lantai larut ke gradient ruang
        c = mix(c, roomGradient(gl_FragCoord.xy / uResolution), smoothstep(1.35, 1.85, r) * 0.7);
        float reveal = falloffSmooth(r * 3.0, 0.0, 6.0, 3.0, uAlpha);
        gl_FragColor = vec4(c, reveal);
      }
    `,
  })
  const mesh = new Mesh(geo, mat)
  mesh.name = 'floor'
  mesh.position.y = FLOOR_Y
  mesh.scale.setScalar(0.73)
  mesh.renderOrder = 2
  return mesh
}

/**
 * Cincin halo: plane berputar 0.2 rad/s, annulus 0.3..0.5 dengan celah tipis, putih x2 (HDR, kena bloom),
 * berkedip halus, additive. Dipasang di ketinggian langit-langit supaya busurnya tampil di atas layar (ref 14).
 */
export function createHaloRing(globals) {
  const mat = new ShaderMaterial({
    uniforms: { ...globals, uShow: { value: 0 }, uRotation: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      #include <igloo_globals>
      uniform float uShow;
      uniform float uRotation;
      varying vec2 vUv;
      void main() {
        vec2 c = vUv - 0.5;
        float r = length(c);
        float a = atan(c.y, c.x) + uRotation;
        float ring = smoothstep(0.3, 0.36, r) * (1.0 - smoothstep(0.44, 0.5, r));
        // inti tipis paling terang + celah sudut kecil yang ikut berputar
        float cd = (r - 0.41) / 0.018; // kuadrat eksplisit: pow() basis negatif = NaN di GLSL
        float core = exp(-cd * cd);
        float gap = smoothstep(0.02, 0.09, abs(sin(a * 1.5)));
        float flick = 0.92 + 0.08 * sin(uTime * 7.3 + sin(uTime * 2.1) * 3.0);
        float v = (ring * 0.35 + core) * gap * flick;
        gl_FragColor = vec4(vec3(2.0) * v * uShow, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  })
  const mesh = new Mesh(new PlaneGeometry(1, 1).rotateX(PI / 2), mat)
  mesh.name = 'haloring'
  mesh.position.y = -9.42
  mesh.scale.setScalar(0.95)
  mesh.renderOrder = 9
  return mesh
}

/** Bola ruang r 100 BackSide di y -12.15: gradient diagonal ruang + grid titik berkelip (200 x 100 di UV). */
export function createLightRoom(globals) {
  const mat = new ShaderMaterial({
    uniforms: { ...globals, ...roomUniforms(), uDots: { value: 0.35 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      #include <igloo_globals>
      #include <igloo_noise>
      ${ROOM_GRADIENT}
      uniform float uDots;
      varying vec2 vUv;
      void main() {
        vec3 col = roomGradient(gl_FragCoord.xy / uResolution);
        vec2 cell = vUv * vec2(200.0, 100.0);
        vec2 f = fract(cell) - 0.5;
        float h = hash12(floor(cell));
        float dotMask = 1.0 - smoothstep(0.05, 0.11, length(f));
        // tiap titik punya fase sendiri, hanya sebagian yang berkelip
        float tw = pow(max(0.0, sin(uTime * (0.4 + h * 0.8) + h * 40.0)), 6.0) * step(0.55, h);
        col += dotMask * tw * uDots;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: BackSide,
    depthWrite: false,
  })
  const mesh = new Mesh(new SphereGeometry(100, 64, 32), mat)
  mesh.name = 'lightroom'
  mesh.position.y = -12.15
  mesh.renderOrder = -100
  mesh.frustumCulled = false
  return mesh
}

/** 29 quad teks di dinding silinder r 1, tinggi 0..1.2, atribut rand per quad, UV ke atlas teks buram. */
function textCylinderGeometry(lines, seed) {
  let s = seed
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const pos = []
  const uv = []
  const rand = []
  const index = []
  const H = 0.05
  for (let i = 0; i < 29; i++) {
    const line = lines[Math.floor(rnd() * lines.length)]
    const w = H * line.aspect
    const a0 = rnd() * PI * 2
    const y = 0.05 + rnd() * 1.1
    const da = w // radius 1: panjang busur = sudut
    const r = rnd()
    const steps = 3
    const base = i * (steps + 1) * 2
    for (let k = 0; k <= steps; k++) {
      const a = a0 + (da * k) / steps
      const u = line.u0 + ((line.u1 - line.u0) * k) / steps
      pos.push(Math.cos(a), y, Math.sin(a), Math.cos(a), y + H, Math.sin(a))
      uv.push(u, line.v0, u, line.v1)
      rand.push(r, r)
    }
    for (let k = 0; k < steps; k++) {
      const a = base + k * 2
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2))
  g.setAttribute('rand', new Float32BufferAttribute(rand, 1))
  g.setIndex(index)
  return g
}

// Layout asli 4 silinder teks: (y, skala)
const TEXT_CYLINDERS = [
  [-10.33, [1.75, 1.75, 1.75]],
  [-10.33, [3.5, 3.5, 3.5]],
  [-9.5, [2, 9, 2]],
  [-9.5, [3.3, 8, 3.3]],
]

export function createTextCylinders(globals, { atlas, info }) {
  return TEXT_CYLINDERS.map(([y, scale], i) => {
    const mat = new ShaderMaterial({
      uniforms: { ...globals, tAtlas: { value: atlas }, uShow: { value: 0 }, uOpacity: { value: 0.22 } },
      vertexShader: /* glsl */ `
        attribute float rand;
        varying vec2 vUv;
        varying float vRand;
        varying float vY;
        void main() {
          vUv = uv;
          vRand = rand;
          vY = position.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        #include <igloo_globals>
        uniform sampler2D tAtlas;
        uniform float uShow;
        uniform float uOpacity;
        varying vec2 vUv;
        varying float vRand;
        varying float vY;
        void main() {
          float a = texture2D(tAtlas, vUv).r;
          // muncul-hilang per baris + kedip halus
          float on = smoothstep(0.2, 0.6, sin(uTime * (0.2 + vRand * 0.3) + vRand * 30.0) * 0.5 + 0.5);
          a *= on * (0.85 + 0.15 * sin(uTime * 13.0 + vRand * 90.0));
          a *= smoothstep(0.0, 0.2, vY) * smoothstep(1.25, 0.9, vY);
          gl_FragColor = vec4(vec3(0.95, 0.97, 1.0), a * uOpacity * uShow);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    })
    const mesh = new Mesh(textCylinderGeometry(info.lines, 11 + i * 7), mat)
    mesh.name = `textcylinder${i + 1}`
    mesh.position.y = y
    mesh.scale.set(...scale)
    mesh.rotation.y = i * 1.3
    mesh.renderOrder = 4
    return mesh
  })
}

/**
 * Forcefield ruang: silinder terbuka r 1 h 3 skala 0.28 di y -10.13 mengelilingi slot partikel. Dua lapis sine noise
 * -> pita sin(noise * 15 - 7t)^4, pola segitiga (uv * 6, didistorsi), fresnel 1 - N.V dengan lantai 25%, pudar ke atas.
 */
export function createRoomForcefield(globals, { triangles }) {
  const mat = new ShaderMaterial({
    uniforms: { ...globals, tTri: { value: triangles }, uShow: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vPos;
      void main() {
        vUv = uv;
        vPos = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      #include <igloo_globals>
      ${ENTRY_MATH}
      uniform sampler2D tTri;
      uniform float uShow;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      varying vec3 vPos;
      void main() {
        float n = sineNoise(vPos * 2.3 + vec3(0.0, uTime * 0.3, 0.0)) * 0.6 + sineNoise(vPos * 4.1 - uTime * 0.2) * 0.4;
        float bands = pow(sin(n * 15.0 - 7.0 * uTime) * 0.5 + 0.5, 4.0);
        float tri = texture2D(tTri, vUv * vec2(6.0, 3.0) + n * 0.08).r;
        float fres = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float edge = mix(0.25, 1.0, smoothstep(0.0, 0.9, fres));
        float fade = 1.0 - smoothstep(0.35, 1.0, vUv.y);
        float a = (bands * 0.35 + tri * (0.15 + bands) * 0.6) * edge * fade;
        gl_FragColor = vec4(vec3(0.7, 0.8, 1.0) * a * uShow * 0.7, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  })
  const mesh = new Mesh(new CylinderGeometry(1, 1, 3, 64, 6, true), mat)
  mesh.name = 'roomforcefield'
  mesh.position.y = -10.13
  mesh.scale.setScalar(0.28)
  mesh.renderOrder = 10
  return mesh
}

function boxPoints(count, size, seed) {
  let s = seed
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  const pos = []
  const rand = []
  for (let i = 0; i < count; i++) {
    pos.push((rnd() - 0.5) * size[0], (rnd() - 0.5) * size[1], (rnd() - 0.5) * size[2])
    rand.push(rnd(), rnd(), rnd(), rnd())
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pos, 3))
  g.setAttribute('rand', new Float32BufferAttribute(rand, 4))
  return g
}

/** 60 partikel ambien di kotak 2.5 x 0.5 x 2.5 di atas lantai: melayang sinus, berkedip, cakram lembut, additive. */
export function createAmbientParticles(globals) {
  const mat = new ShaderMaterial({
    uniforms: { ...globals, uShow: { value: 0 } },
    vertexShader: /* glsl */ `
      #include <igloo_globals>
      attribute vec4 rand;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        float t = uTime;
        p += vec3(sin(t * 0.21 + rand.x * 6.28), sin(t * 0.17 + rand.y * 6.28) * 0.4, cos(t * 0.19 + rand.z * 6.28)) * 0.08;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vAlpha = 0.55 + 0.45 * sin(t * (1.5 + rand.w * 2.0) + rand.x * 20.0);
        gl_PointSize = mix(7.0, 12.0, rand.w) * uResolution.y * 0.002;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uShow;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c) * 2.0;
        // cakram lembut dengan sisi atas sedikit lebih terang (arah cahaya ruang)
        float a = (1.0 - smoothstep(0.2, 1.0, d)) * mix(0.6, 1.0, 0.5 - c.y);
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a * vAlpha * uShow * 0.5, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  const pts = new Points(boxPoints(60, [2.5, 0.5, 2.5], 4242), mat)
  pts.name = 'ambientparticles'
  pts.position.y = -9.61
  pts.frustumCulled = false
  pts.renderOrder = 11
  return pts
}

/** 200 coretan salju di kotak 3 x 8 x 3 (y -3.5): jatuh berpusar dengan bungkus treadmill, sprite diputar dan dipipihkan. */
export function createSnowStreaks(globals) {
  const mat = new ShaderMaterial({
    uniforms: { ...globals, uShow: { value: 1 } },
    vertexShader: /* glsl */ `
      #include <igloo_globals>
      attribute vec4 rand;
      varying float vAngle;
      varying float vPow;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        float t = uTime;
        p.y = mod(p.y - t * mix(0.5, 1.1, rand.x) + 4.0, 8.0) - 4.0;
        float sw = t * mix(0.3, 0.7, rand.y) + rand.z * 6.28;
        p.xz += vec2(cos(sw), sin(sw)) * 0.25;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float depth = -mv.z;
        vAlpha = smoothstep(4.0, 3.2, abs(p.y)) * smoothstep(0.2, 0.8, depth);
        vAngle = rand.w * 6.28 + t * 0.2;
        vPow = mix(2.0, 4.0, rand.y);
        gl_PointSize = clamp(60.0 * (uResolution.y / 800.0) / max(depth, 0.1), 2.0, 96.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uShow;
      varying float vAngle;
      varying float vPow;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float cs = cos(vAngle), sn = sin(vAngle);
        c = mat2(cs, -sn, sn, cs) * c;
        // pipihkan jadi goresan: tipis di x, panjang di y
        float a = pow(max(0.0, 1.0 - abs(c.x) * 14.0), vPow) * pow(max(0.0, 1.0 - abs(c.y) * 2.0), 1.5);
        gl_FragColor = vec4(vec3(1.0) * a * vAlpha * 0.3 * uShow, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  const pts = new Points(boxPoints(200, [3, 8, 3], 777), mat)
  pts.name = 'snowstreaks'
  pts.position.y = -3.5
  pts.frustumCulled = false
  pts.renderOrder = 12
  return pts
}
