import {
  ShaderMaterial, Mesh, PlaneGeometry, Points, BufferGeometry, BufferAttribute, Color, AdditiveBlending,
} from 'three'
import '../../glsl/chunks.js'
import { createFullscreenTriangle } from '../../compositor/CompositeMaterial.js'
import { mulberry32 } from '../../text/layout.js'

// Bagian scene detail (skill ref 02 bagian 6.8, ref 01 bagian 2.5). Shader dan kode sendiri,
// tekstur caustics dan bokeh igloo diganti fungsi prosedural (tidak ada aset baru).

// Pola caustics prosedural: tepi sel voronoi bergerak (F2 - F1 kecil = garis terang), 0..1.
const CAUSTIC_GLSL = /* glsl */ `
vec2 detailHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float caustic(vec2 p, float t) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = 0.5 + 0.4 * sin(t + 6.2831 * detailHash22(i + g));
      float d = length(g + o - f);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  float e = 1.0 - smoothstep(0.0, 0.28, f2 - f1);
  // dasar 0.15 seperti tekstur caustics (tidak hitam pekat), garis terang di tepi sel
  return 0.15 + 0.85 * e * e * e;
}
`

/** Latar: gradient diputar -0.66 rad, mix(#09121f, #6b7685, uv.y^3 * 0.5) + noise hash 1% anti-banding. */
export function createBackground(globals, look) {
  const mat = new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 1.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      #include <igloo_globals>
      #include <igloo_noise>
      uniform vec3 uDark;
      uniform vec3 uLight;
      varying vec2 vUv;
      void main() {
        vec2 uv = (vUv - 0.5) * vec2(uAspect, 1.0) * 0.5;
        float c = cos(-0.66);
        float s = sin(-0.66);
        // rotasi gaya mat2(c, -s, s, c) * uv (kolom GLSL): sisi terang di kanan atas, cocok dengan ref 08
        uv = vec2(c * uv.x + s * uv.y, -s * uv.x + c * uv.y) + 0.5;
        float y = clamp(uv.y, 0.0, 1.0);
        vec3 col = mix(uDark, uLight, y * y * y * 0.5);
        col += (hash12(gl_FragCoord.xy + fract(uTime) * 97.0) - 0.5) * 0.01;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    uniforms: { ...globals, uDark: { value: new Color(look.bgDark) }, uLight: { value: new Color(look.bgLight) } },
    depthTest: false,
    depthWrite: false,
  })
  const mesh = createFullscreenTriangle(mat)
  mesh.name = 'detail_bg'
  mesh.renderOrder = -99
  return mesh
}

/** Objek proyek: bake gelap x perlin bernapas (0.025..0.15) + caustics min(dua lapis) * color.b * 30. */
export function createObjectMaterial(globals, { map, perlin }, look) {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      #include <igloo_globals>
      ${CAUSTIC_GLSL}
      uniform sampler2D tMap;
      uniform sampler2D tPerlin;
      uniform float uCausticScale;
      uniform float uCausticGain;
      uniform float uExposure;
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vec3 col = texture2D(tMap, vUv).rgb;
        float breath = mix(0.025, 0.15, texture2D(tPerlin, vWorld.xy * 0.4 + vec2(0.021, 0.013) * uTime).r);
        vec2 p = vWorld.xy * uCausticScale;
        float c1 = caustic(p * 1.5 + vec2(0.05, 0.03) * uTime, uTime * 0.6);
        float c2 = caustic(p * 2.0 - vec2(0.04, 0.06) * uTime, uTime * 0.5 + 3.0);
        vec3 o = col * breath * uExposure + min(c1, c2) * col.b * 30.0 * uCausticGain;
        gl_FragColor = vec4(o, 1.0);
      }
    `,
    uniforms: {
      ...globals,
      tMap: { value: map },
      tPerlin: { value: perlin },
      uCausticScale: { value: look.causticScale },
      uCausticGain: { value: look.causticGain },
      uExposure: { value: look.objectExposure },
    },
  })
}

/** Light shaft: plane 1.5 x 3 diputar -40 derajat, #d1e3ff, dua lapis perlin x radial^2 x 0.07, additive. */
export function createLightShaft(globals, { perlin }, look) {
  const mat = new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      #include <igloo_globals>
      uniform sampler2D tPerlin;
      uniform vec3 uColor;
      uniform float uGain;
      varying vec2 vUv;
      void main() {
        float n1 = texture2D(tPerlin, vUv * vec2(0.8, 0.35) + vec2(0.0, uTime * 0.03)).r;
        float n2 = texture2D(tPerlin, vUv * vec2(1.3, 0.6) - vec2(uTime * 0.02, uTime * 0.012)).r;
        float r = 1.0 - clamp(length((vUv - 0.5) * 2.0), 0.0, 1.0);
        float a = n1 * n2 * r * r * 0.07 * uGain;
        gl_FragColor = vec4(uColor * a, 1.0);
      }
    `,
    uniforms: { ...globals, tPerlin: { value: perlin }, uColor: { value: new Color(look.light) }, uGain: { value: look.shaftGain } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  const mesh = new Mesh(new PlaneGeometry(1, 1), mat)
  mesh.name = 'detail_lightshaft'
  mesh.position.set(1.67, 0.79, 0)
  mesh.scale.set(1.5, 3, 1)
  mesh.rotation.z = (-40 * Math.PI) / 180
  mesh.renderOrder = 2
  return mesh
}

/** Plane bokeh 4 x 4 melayang di jalur sinus: radial^2 + bokeh x perlin x 5, alpha 0.15, additive. */
export function createBokeh(globals, { perlin }, look) {
  const mat = new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      #include <igloo_globals>
      #include <igloo_noise>
      uniform sampler2D tPerlin;
      uniform vec3 uColor;
      uniform float uGain;
      varying vec2 vUv;
      // pengganti bokeh.ktx2: cakram lembut acak di grid 5 x 5, tepi sedikit lebih terang
      float bokeh(vec2 uv) {
        vec2 g = uv * 5.0;
        vec2 i = floor(g);
        float v = 0.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 c = i + vec2(float(x), float(y));
            float h = hash12(c);
            vec2 o = vec2(hash12(c + 7.1), hash12(c + 3.7));
            float rad = mix(0.25, 0.6, hash12(c + 1.3));
            float d = length(g - c - o) / rad;
            float disc = smoothstep(1.0, 0.55, d) * (0.7 + 0.3 * smoothstep(0.4, 1.0, d));
            v = max(v, disc * step(0.45, h) * h * 0.35);
          }
        }
        return v;
      }
      void main() {
        float r = 1.0 - clamp(length((vUv - 0.5) * 2.0), 0.0, 1.0);
        float n = texture2D(tPerlin, vUv * 1.3 + vec2(uTime * 0.02, -uTime * 0.013)).r;
        float v = (r * r + bokeh(vUv) * n * 5.0 * r) * 0.15 * uGain;
        gl_FragColor = vec4(uColor * v, 1.0);
      }
    `,
    uniforms: { ...globals, tPerlin: { value: perlin }, uColor: { value: new Color(look.light) }, uGain: { value: look.bokehGain } },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
  })
  const mesh = new Mesh(new PlaneGeometry(4, 4), mat)
  mesh.name = 'detail_bokeh'
  mesh.position.set(-2.05, -0.87, 1)
  mesh.renderOrder = 3
  return mesh
}

/** 250 partikel berkelip: ukuran 15 * mix(.15, 1, r^2) * resY * 0.002, kedip 2 sinus, terang ikut gradient diagonal. */
export function createSparkles(globals, look, count = 250) {
  const rnd = mulberry32(2501)
  const pos = new Float32Array(count * 3)
  const rand = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    pos.set([(rnd() * 2 - 1) * 2, (rnd() * 2 - 1) * 2, (rnd() * 2 - 1) * 0.8], i * 3)
    rand.set([rnd(), rnd(), rnd(), 0.4 + 0.6 * rnd()], i * 4)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('aRand', new BufferAttribute(rand, 4))
  const mat = new ShaderMaterial({
    vertexShader: /* glsl */ `
      #include <igloo_globals>
      attribute vec4 aRand;
      varying float vAlpha;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = 15.0 * mix(0.15, 1.0, aRand.x * aRand.x) * uResolution.y * 0.002;
        float f1 = 0.5 + 0.5 * sin(uTime * (0.8 + aRand.z * 2.0) + aRand.y * 6.2831);
        float f2 = 0.5 + 0.5 * sin(uTime * (0.31 + aRand.z * 0.7) + aRand.y * 17.0);
        // gradient diagonal yang sama dengan latar: lebih terang di kiri atas
        vec2 ndc = gl_Position.xy / gl_Position.w * 0.5;
        float c = cos(-0.66);
        float s = sin(-0.66);
        float y = s * ndc.x * uAspect + c * ndc.y + 0.5;
        vAlpha = f1 * f2 * aRand.w * mix(0.2, 1.0, clamp(y, 0.0, 1.0));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uGain;
      varying float vAlpha;
      void main() {
        vec2 pc = gl_PointCoord;
        float d = length(pc - 0.5) * 2.0;
        float disc = 1.0 - smoothstep(0.0, 1.0, d);
        // falloff kiri ke kanan (uv.x^2)
        float a = disc * disc * pc.x * pc.x * vAlpha * uGain;
        gl_FragColor = vec4(uColor * a, 1.0);
      }
    `,
    uniforms: { ...globals, uColor: { value: new Color(look.light) }, uGain: { value: look.sparkleGain } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })
  const pts = new Points(g, mat)
  pts.name = 'detail_sparkles'
  pts.frustumCulled = false
  pts.renderOrder = 4
  return pts
}

/**
 * Partikel kecil #2d3133 additive yang muncul di jejak mouse (tSim dibaca di posisi layar titik).
 * Ukuran 3..10 px x (resY / 1000), hilang total kalau sim di titik itu nol.
 */
export function createTrailParticles(globals, simUniform, look, count) {
  const rnd = mulberry32(10007)
  const pos = new Float32Array(count * 3)
  const rand = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    pos.set([(rnd() * 2 - 1) * 2.4, (rnd() * 2 - 1) * 1.5, (rnd() * 2 - 1) * 0.6], i * 3)
    rand.set([rnd(), rnd(), rnd()], i * 3)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('aRand', new BufferAttribute(rand, 3))
  const mat = new ShaderMaterial({
    vertexShader: /* glsl */ `
      #include <igloo_globals>
      attribute vec3 aRand;
      uniform sampler2D tSim;
      varying float vAlpha;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vec2 suv = gl_Position.xy / gl_Position.w * 0.5 + 0.5;
        float v = textureLod(tSim, suv, 0.0).r;
        float vis = smoothstep(0.04, 0.5, v * (0.4 + aRand.x));
        gl_PointSize = mix(3.0, 10.0, aRand.y) * uResolution.y / 1000.0;
        vAlpha = vis * (0.6 + 0.4 * sin(uTime * (2.0 + aRand.z * 4.0) + aRand.x * 40.0));
        // tidak ada jejak di titik ini: lipat keluar layar, hemat fill
        if (vis <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uGain;
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.3, 1.0, d)) * vAlpha * uGain;
        if (a < 0.001) discard;
        gl_FragColor = vec4(uColor * a, 1.0);
      }
    `,
    uniforms: { ...globals, tSim: simUniform, uColor: { value: new Color(look.little) }, uGain: { value: look.trailGain } },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
  })
  const pts = new Points(g, mat)
  pts.name = 'detail_trail'
  pts.frustumCulled = false
  pts.renderOrder = 5
  return pts
}
