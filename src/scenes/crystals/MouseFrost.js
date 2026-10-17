import { WebGLRenderTarget, HalfFloatType, LinearFilter, ClampToEdgeWrapping, ShaderMaterial, Vector2, Color } from 'three'
import { renderTargetType } from '../../engine/rtType.js'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { clamp } from '../../engine/math.js'

// Sim mouse frost per kristal (skill ref 02 bagian 6.3, ref 01 bagian 7). Ping-pong HalfFloat ukuran
// tetap (512, 256 di perangkat sentuh) di ruang uv1 kristal, jadi tidak ikut resize layar.
// Satu langkah (minimal tiap 15 ms):
//   uv  += (aliran(uv * 3) * 2 - 1) texel             -> tepi frost berbelok ikut medan aliran
//   v    = max(kiri, kanan, atas, bawah)               -> dilasi, area frost tumbuh 1 texel per langkah
//   v   += kapsul(mouseLama, mouseBaru, 0.05 * smoothstep(0.1, 1, kecepatan)), falloff kubik
//   v    = min(v * 0.985, 1)
//   out  = (v, v - nilaiLama)                          -> g = rim, tepi yang sedang tumbuh
// Kecepatan (per langkah): target += jarak * 6, target *= 0.88, clamp 0..1,
// kecepatan = lerp(kecepatan, power4.out(target), 0.1). Reset kalau diam > 0.15 s atau loncat > 0.3.

export const FROST = { stepMs: 15, idleMs: 150, jump: 0.3, decay: 0.985, radius: 0.05, sleepMs: 8000 }

const power4out = (x) => 1 - Math.pow(1 - x, 4)

const simShader = {
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tPrev;
    uniform sampler2D tAdvect;
    uniform vec2 uTexel;
    uniform vec2 uA;
    uniform vec2 uB;
    uniform float uRadius;
    uniform float uDecay;
    varying vec2 vUv;

    void main() {
      float old = texture2D(tPrev, vUv).r;
      vec2 flow = texture2D(tAdvect, vUv * 3.0).xy * 2.0 - 1.0;
      vec2 uv = vUv + flow * uTexel;
      float v = max(
        max(texture2D(tPrev, uv - vec2(uTexel.x, 0.0)).r, texture2D(tPrev, uv + vec2(uTexel.x, 0.0)).r),
        max(texture2D(tPrev, uv - vec2(0.0, uTexel.y)).r, texture2D(tPrev, uv + vec2(0.0, uTexel.y)).r)
      );
      if (uRadius > 0.0) {
        // jarak ke ruas A-B (kapsul), aman saat A == B
        vec2 pa = vUv - uA;
        vec2 ba = uB - uA;
        float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
        float s = 1.0 - clamp(length(pa - ba * h) / uRadius, 0.0, 1.0);
        v += s * s * s;
      }
      v = min(v * uDecay, 1.0);
      gl_FragColor = vec4(v, v - old, 0.0, 1.0);
    }
  `,
}

export class MouseFrost {
  constructor(renderer, advect, size = MouseFrost.defaultSize()) {
    this.renderer = renderer
    this.size = size
    const opts = {
      type: renderTargetType(renderer, HalfFloatType),
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      generateMipmaps: false,
      depthBuffer: false,
    }
    this.read = new WebGLRenderTarget(size, size, opts)
    this.write = new WebGLRenderTarget(size, size, opts)
    this.material = new ShaderMaterial({
      ...simShader,
      uniforms: {
        tPrev: { value: this.read.texture },
        tAdvect: { value: advect },
        uTexel: { value: new Vector2(1 / size, 1 / size) },
        uA: { value: new Vector2() },
        uB: { value: new Vector2() },
        uRadius: { value: 0 },
        uDecay: { value: FROST.decay },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.quad = new FullScreenQuad(this.material)
    this.prev = new Vector2()
    this.hasPrev = false
    this.target = 0
    this.velocity = 0
    this.lastStep = -Infinity
    this.lastMove = -Infinity
    this.lastSplat = -Infinity
    this.sleeping = true
    this.steps = 0
    this.clear()
  }

  /** 256 di perangkat sentuh (pointer kasar), 512 selain itu. */
  static defaultSize() {
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    return coarse ? 256 : 512
  }

  /** Tekstur yang dibaca material es (hasil langkah terakhir). */
  get texture() {
    return this.read.texture
  }

  clear() {
    const r = this.renderer
    const prev = r.getRenderTarget()
    const color = r.getClearColor(new Color())
    const alpha = r.getClearAlpha()
    r.setClearColor(0x000000, 0)
    for (const rt of [this.read, this.write]) {
      r.setRenderTarget(rt)
      r.clear(true, false, false)
    }
    r.setClearColor(color, alpha)
    r.setRenderTarget(prev)
  }

  /**
   * @param {number} now ms (waktu nyata, tidak ikut freeze screenshot)
   * @param {Vector2|null} hit uv1 titik kena raycast, null kalau mouse tidak di atas kristal
   * @returns {boolean} true kalau sim melangkah frame ini
   */
  update(now, hit) {
    if (now - this.lastStep < FROST.stepMs) return false
    this.lastStep = now
    const u = this.material.uniforms
    let radius = 0
    if (hit) {
      const jump = this.hasPrev ? hit.distanceTo(this.prev) : 0
      if (!this.hasPrev || now - this.lastMove > FROST.idleMs || jump > FROST.jump) {
        // reset: mulai jejak baru dari titik ini, kecepatan nol
        this.prev.copy(hit)
        this.hasPrev = true
        this.target = 0
        this.velocity = 0
        this.lastMove = now
      }
      const dist = hit.distanceTo(this.prev)
      if (dist > 1e-5) this.lastMove = now
      this.target = clamp((this.target + dist * 6) * 0.88, 0, 1)
      this.velocity += (power4out(this.target) - this.velocity) * 0.1
      radius = FROST.radius * smoothstep(0.1, 1, this.velocity)
      u.uA.value.copy(this.prev)
      u.uB.value.copy(hit)
      this.prev.copy(hit)
    } else {
      this.hasPrev = false
      this.target *= 0.88
      this.velocity += (power4out(this.target) - this.velocity) * 0.1
    }
    if (radius > 1e-4) {
      this.lastSplat = now
      this.sleeping = false
    }
    // tidak ada splat lama sekali: nilai sudah meluruh ke ~0, berhenti melangkah (hemat GPU)
    if (this.sleeping) return false
    if (now - this.lastSplat > FROST.sleepMs) {
      this.sleeping = true
      this.clear()
      return false
    }
    u.uRadius.value = radius
    this._step()
    return true
  }

  _step() {
    const r = this.renderer
    const prev = r.getRenderTarget()
    this.material.uniforms.tPrev.value = this.read.texture
    r.setRenderTarget(this.write)
    this.quad.render(r)
    r.setRenderTarget(prev)
    const t = this.read
    this.read = this.write
    this.write = t
    this.steps++
    if (this.onSwap) this.onSwap(this.read.texture)
  }

  dispose() {
    this.read.dispose()
    this.write.dispose()
    this.material.dispose()
    this.quad.dispose()
  }
}

function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}
