import { WebGLRenderTarget, HalfFloatType, RGBAFormat, LinearFilter, ClampToEdgeWrapping, RawShaderMaterial, GLSL3, Vector2, Color } from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'

// Simulasi fluida 2D kecil, satu-satunya tugasnya mendorong partikel volume (skill ref 02 bagian 8).
// Teknik: struktur "stable fluids" di GPU yang dipopulerkan Pavel Dobryakov (WebGL Fluid Simulation, MIT):
// splat, curl, vorticity, divergence, pressure Jacobi, gradient subtract, advection. Kode di bawah ditulis sendiri,
// bukan salinan. Bedanya dengan versi Pavel (meniru igloo): splat berbentuk kapsul garis dari pointer sebelumnya
// ke sekarang dengan falloff kubik, disipasi dikali per frame 60 Hz (dikoreksi ratio), tanpa dinding.
//
// Satuan: kecepatan dalam "tinggi layar per detik" (x sudah dikali aspek), grid sim berpiksel persegi di layar
// (tinggi 128, lebar 128 x aspek), jadi beda hingga di x dan y setara.

export const FLUID = {
  simRes: 128,
  dyeRes: 128,
  curl: 0, // 0 = vorticity mati (angka igloo untuk ruang link), pass curl + vorticity dilewati
  splatRadius: 0.22,
  splatForce: 35,
  iterations: 2,
  densityDissipation: 0.88,
  velocityDissipation: 0.98,
  pressureDissipation: 0.86,
  idle: 0.15, // detik tanpa gerak -> gaya nol
}
// Satuan splatRadius asli tidak tercatat [?]. Di sini radius kapsul = 0.22 x 0.4 = 0.088 tinggi layar,
// jejaknya mirip gaussian Pavel dengan radius / 100.
const RADIUS_SCALE = 0.4
const _color = new Color()

const VERT = /* glsl */ `
precision highp float;
in vec3 position;
uniform vec2 uTexel;
out vec2 vUv;
out vec2 vL;
out vec2 vR;
out vec2 vT;
out vec2 vB;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  vL = vUv - vec2(uTexel.x, 0.0);
  vR = vUv + vec2(uTexel.x, 0.0);
  vT = vUv + vec2(0.0, uTexel.y);
  vB = vUv - vec2(0.0, uTexel.y);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`
const HEAD = /* glsl */ `
precision highp float;
precision highp sampler2D;
in vec2 vUv;
in vec2 vL;
in vec2 vR;
in vec2 vT;
in vec2 vB;
out vec4 outColor;
`

const FRAG = {
  // kapsul dari uA ke uB (uv 0..1), falloff (1 - d / r)^3, ditambahkan ke target
  splat: /* glsl */ `${HEAD}
    uniform sampler2D uTarget;
    uniform vec2 uA;
    uniform vec2 uB;
    uniform vec3 uValue;
    uniform float uRadius;
    uniform float uAspect;
    uniform float uClampOne;
    void main() {
      vec2 s = vec2(uAspect, 1.0);
      vec2 pa = (vUv - uA) * s;
      vec2 ba = (uB - uA) * s;
      float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
      float f = max(0.0, 1.0 - length(pa - ba * h) / uRadius);
      f = f * f * f;
      vec3 c = texture(uTarget, vUv).xyz + uValue * f;
      if (uClampOne > 0.5) c = min(c, vec3(1.0));
      outColor = vec4(c, 1.0);
    }`,
  curl: /* glsl */ `${HEAD}
    uniform sampler2D uVelocity;
    void main() {
      float l = texture(uVelocity, vL).y;
      float r = texture(uVelocity, vR).y;
      float t = texture(uVelocity, vT).x;
      float b = texture(uVelocity, vB).x;
      outColor = vec4(0.5 * (r - l - t + b), 0.0, 0.0, 1.0);
    }`,
  vorticity: /* glsl */ `${HEAD}
    uniform sampler2D uVelocity;
    uniform sampler2D uCurl;
    uniform float uCurlStrength;
    uniform float uDt;
    void main() {
      float l = texture(uCurl, vL).x;
      float r = texture(uCurl, vR).x;
      float t = texture(uCurl, vT).x;
      float b = texture(uCurl, vB).x;
      float c = texture(uCurl, vUv).x;
      vec2 n = vec2(abs(t) - abs(b), abs(r) - abs(l));
      float len = length(n);
      // normalize(0) = NaN: dijaga dengan pembagi minimum
      n = len > 1e-5 ? n / len : vec2(0.0);
      vec2 force = n * c * vec2(1.0, -1.0) * uCurlStrength;
      vec2 v = texture(uVelocity, vUv).xy + force * uDt;
      outColor = vec4(clamp(v, -100.0, 100.0), 0.0, 1.0);
    }`,
  divergence: /* glsl */ `${HEAD}
    uniform sampler2D uVelocity;
    void main() {
      float l = texture(uVelocity, vL).x;
      float r = texture(uVelocity, vR).x;
      float t = texture(uVelocity, vT).y;
      float b = texture(uVelocity, vB).y;
      outColor = vec4(0.5 * (r - l + t - b), 0.0, 0.0, 1.0);
    }`,
  scale: /* glsl */ `${HEAD}
    uniform sampler2D uTarget;
    uniform float uFactor;
    void main() {
      outColor = texture(uTarget, vUv) * uFactor;
    }`,
  jacobi: /* glsl */ `${HEAD}
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;
    void main() {
      float l = texture(uPressure, vL).x;
      float r = texture(uPressure, vR).x;
      float t = texture(uPressure, vT).x;
      float b = texture(uPressure, vB).x;
      float div = texture(uDivergence, vUv).x;
      outColor = vec4((l + r + t + b - div) * 0.25, 0.0, 0.0, 1.0);
    }`,
  gradient: /* glsl */ `${HEAD}
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;
    void main() {
      float l = texture(uPressure, vL).x;
      float r = texture(uPressure, vR).x;
      float t = texture(uPressure, vT).x;
      float b = texture(uPressure, vB).x;
      vec2 v = texture(uVelocity, vUv).xy - 0.5 * vec2(r - l, t - b);
      outColor = vec4(v, 0.0, 1.0);
    }`,
  // semi-Lagrangian: ambil nilai dari titik asal partikel fluida, lalu disipasi
  advect: /* glsl */ `${HEAD}
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform float uDt;
    uniform float uAspect;
    uniform float uDissipation;
    void main() {
      vec2 v = texture(uVelocity, vUv).xy;
      vec2 from = vUv - uDt * v * vec2(1.0 / uAspect, 1.0);
      outColor = vec4(texture(uSource, from).xyz * uDissipation, 1.0);
    }`,
}

function makeRT(w, h) {
  return new WebGLRenderTarget(w, h, {
    type: HalfFloatType,
    format: RGBAFormat,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  })
}

class PingPong {
  constructor(w, h) {
    this.read = makeRT(w, h)
    this.write = makeRT(w, h)
  }

  swap() {
    const t = this.read
    this.read = this.write
    this.write = t
  }

  dispose() {
    this.read.dispose()
    this.write.dispose()
  }
}

export class FluidSim {
  constructor(renderer, aspect = 1) {
    this.renderer = renderer
    this.quad = new FullScreenQuad(null)
    this.mats = {}
    for (const [k, frag] of Object.entries(FRAG)) {
      this.mats[k] = new RawShaderMaterial({
        glslVersion: GLSL3,
        vertexShader: VERT,
        fragmentShader: frag,
        uniforms: { uTexel: { value: new Vector2() } },
        depthTest: false,
        depthWrite: false,
      })
    }
    this.aspect = 0
    this._prev = new Vector2(0.5, 0.5)
    this._last = new Vector2(0.5, 0.5)
    this._idle = 0
    this._first = true
    /** Uniform yang dibaca sim partikel. Isinya diganti tiap langkah (tekstur ping-pong terbaru). */
    this.velocity = { value: null }
    this.setAspect(aspect)
  }

  setAspect(aspect) {
    if (Math.abs(aspect - this.aspect) < 1e-3) return
    this.aspect = aspect
    this._disposeTargets()
    const h = FLUID.simRes
    const w = Math.max(16, Math.round(h * aspect))
    const dh = FLUID.dyeRes
    const dw = Math.max(16, Math.round(dh * aspect))
    this.size = { w, h, dw, dh }
    this.vel = new PingPong(w, h)
    this.dye = new PingPong(dw, dh)
    this.pressure = new PingPong(w, h)
    this.div = makeRT(w, h)
    this.curlRT = makeRT(w, h)
    for (const rt of [this.vel.read, this.vel.write, this.dye.read, this.dye.write, this.pressure.read, this.pressure.write, this.div, this.curlRT]) {
      this._clear(rt)
    }
    this.velocity.value = this.vel.read.texture
  }

  _clear(rt) {
    const r = this.renderer
    const prev = r.getRenderTarget()
    r.getClearColor(_color)
    const alpha = r.getClearAlpha()
    r.setRenderTarget(rt)
    r.setClearColor(0x000000, 0)
    r.clear(true, false, false)
    // warna clear renderer dipakai bersama engine, kembalikan
    r.setClearColor(_color, alpha)
    r.setRenderTarget(prev)
  }

  _pass(name, target, uniforms, texel) {
    const m = this.mats[name]
    for (const k in uniforms) {
      if (!m.uniforms[k]) m.uniforms[k] = { value: uniforms[k] }
      else m.uniforms[k].value = uniforms[k]
    }
    m.uniforms.uTexel.value.set(1 / texel[0], 1 / texel[1])
    this.quad.material = m
    this.renderer.setRenderTarget(target)
    this.quad.render(this.renderer)
  }

  /**
   * Satu langkah sim. pointer01 = posisi pointer 0..1 (y ke atas). Dipanggil scene entry paling cepat tiap 16 ms.
   * @param {number} dt detik sejak langkah sebelumnya
   * @param {import('three').Vector2} pointer01
   */
  step(dt, pointer01) {
    const r = this.renderer
    const prevTarget = r.getRenderTarget()
    const ratio = Math.min(dt * 60, 3)
    const { w, h, dw, dh } = this.size
    const tex = [w, h]
    const dtex = [dw, dh]

    // ---- splat kapsul dari pointer sebelumnya ke sekarang ----
    if (this._first) {
      this._prev.copy(pointer01)
      this._first = false
    }
    const dx = pointer01.x - this._prev.x
    const dy = pointer01.y - this._prev.y
    const moved = Math.abs(dx) + Math.abs(dy) > 1e-5
    this._idle = moved ? 0 : this._idle + dt
    if (moved && this._idle < FLUID.idle) {
      const radius = FLUID.splatRadius * RADIUS_SCALE
      const force = [dx * this.aspect * FLUID.splatForce, dy * FLUID.splatForce, 0]
      const common = { uA: this._prev, uB: pointer01, uRadius: radius, uAspect: this.aspect }
      this._pass('splat', this.vel.write, { ...common, uTarget: this.vel.read.texture, uValue: force, uClampOne: 0 }, tex)
      this.vel.swap()
      this._pass('splat', this.dye.write, { ...common, uTarget: this.dye.read.texture, uValue: [1, 1, 1], uClampOne: 1 }, dtex)
      this.dye.swap()
    }
    this._prev.copy(pointer01)

    // ---- vorticity (dilewati kalau curl 0) ----
    if (FLUID.curl > 0) {
      this._pass('curl', this.curlRT, { uVelocity: this.vel.read.texture }, tex)
      this._pass('vorticity', this.vel.write, {
        uVelocity: this.vel.read.texture, uCurl: this.curlRT.texture, uCurlStrength: FLUID.curl, uDt: dt,
      }, tex)
      this.vel.swap()
    }

    // ---- proyeksi: divergence, pressure (disipasi + Jacobi), gradient subtract ----
    this._pass('divergence', this.div, { uVelocity: this.vel.read.texture }, tex)
    this._pass('scale', this.pressure.write, { uTarget: this.pressure.read.texture, uFactor: Math.pow(FLUID.pressureDissipation, ratio) }, tex)
    this.pressure.swap()
    for (let i = 0; i < FLUID.iterations; i++) {
      this._pass('jacobi', this.pressure.write, { uPressure: this.pressure.read.texture, uDivergence: this.div.texture }, tex)
      this.pressure.swap()
    }
    this._pass('gradient', this.vel.write, { uPressure: this.pressure.read.texture, uVelocity: this.vel.read.texture }, tex)
    this.vel.swap()

    // ---- advection kecepatan lalu dye ----
    this._pass('advect', this.vel.write, {
      uVelocity: this.vel.read.texture, uSource: this.vel.read.texture, uDt: dt, uAspect: this.aspect,
      uDissipation: Math.pow(FLUID.velocityDissipation, ratio),
    }, tex)
    this.vel.swap()
    this._pass('advect', this.dye.write, {
      uVelocity: this.vel.read.texture, uSource: this.dye.read.texture, uDt: dt, uAspect: this.aspect,
      uDissipation: Math.pow(FLUID.densityDissipation, ratio),
    }, dtex)
    this.dye.swap()

    this.velocity.value = this.vel.read.texture
    r.setRenderTarget(prevTarget)
  }

  _disposeTargets() {
    if (!this.vel) return
    this.vel.dispose()
    this.dye.dispose()
    this.pressure.dispose()
    this.div.dispose()
    this.curlRT.dispose()
  }

  dispose() {
    this._disposeTargets()
    for (const m of Object.values(this.mats)) m.dispose()
    this.quad.dispose()
  }
}
