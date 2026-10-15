import { WebGLRenderTarget, HalfFloatType, LinearFilter, ShaderMaterial, Vector2, Color } from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { clamp, smoothstep } from '../../engine/math.js'

// Sim mouse scene detail (skill ref 01 bagian 7, "mouseSim"): ping-pong HalfFloat resolusi layar / 5,
// ruang layar 0..1 (y ke atas). Aturan splat sama dengan frost kristal: kapsul antara posisi lama dan
// baru, radius mengikuti kecepatan, reset kalau diam > 0.15 s atau loncat > 0.3, langkah minimal 15 ms.
// Tanpa dilasi: nilai cuma meluruh, jadi jejak memudar di tempat. out = (nilai, rim = nilai - lama).
// Dibaca partikel kecil (muncul di jejak) dan teks panel (huruf di jejak ter-scramble ulang).

export const MOUSE_SIM = { scale: 1 / 5, stepMs: 15, idleMs: 150, jump: 0.3, decay: 0.975, radius: 0.06 }

const power4out = (x) => 1 - Math.pow(1 - x, 4)

const fragmentShader = /* glsl */ `
  uniform sampler2D tPrev;
  uniform vec2 uA;
  uniform vec2 uB;
  uniform float uRadius;
  uniform float uDecay;
  uniform float uAspect;
  varying vec2 vUv;

  void main() {
    float old = texture2D(tPrev, vUv).r;
    float v = old * uDecay;
    if (uRadius > 0.0) {
      // kapsul A-B di ruang layar terkoreksi aspek, falloff kubik
      vec2 asp = vec2(uAspect, 1.0);
      vec2 pa = (vUv - uA) * asp;
      vec2 ba = (uB - uA) * asp;
      float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-8), 0.0, 1.0);
      float s = 1.0 - clamp(length(pa - ba * h) / uRadius, 0.0, 1.0);
      v = max(v, s * s * s);
    }
    v = clamp(v, 0.0, 1.0);
    gl_FragColor = vec4(v, max(v - old, 0.0), 0.0, 1.0);
  }
`

export class MouseSim {
  constructor(renderer) {
    this.renderer = renderer
    const opts = { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false, depthBuffer: false }
    this.read = new WebGLRenderTarget(1, 1, opts)
    this.write = new WebGLRenderTarget(1, 1, opts)
    this.material = new ShaderMaterial({
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader,
      uniforms: {
        tPrev: { value: null },
        uA: { value: new Vector2() },
        uB: { value: new Vector2() },
        uRadius: { value: 0 },
        uDecay: { value: MOUSE_SIM.decay },
        uAspect: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.quad = new FullScreenQuad(this.material)
    // uniform bersama untuk pembaca (partikel kecil, teks panel): selalu menunjuk hasil langkah terakhir
    this.uniform = { value: this.read.texture }
    this.prev = new Vector2()
    this.hasPrev = false
    this.target = 0
    this.velocity = 0
    this.lastStep = -Infinity
    this.lastMove = 0
    this.steps = 0
    this.size = new Vector2(1, 1)
  }

  /** Ukuran sim = resolusi internal / 5. */
  setSize(W, H, aspect) {
    const w = Math.max(1, Math.round(W * MOUSE_SIM.scale))
    const h = Math.max(1, Math.round(H * MOUSE_SIM.scale))
    this.material.uniforms.uAspect.value = aspect
    if (w === this.size.x && h === this.size.y) return
    this.size.set(w, h)
    this.read.setSize(w, h)
    this.write.setSize(w, h)
    this.clear()
  }

  /** Kosongkan jejak (dipanggil tiap proyek dibuka). */
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
    this.hasPrev = false
    this.target = 0
    this.velocity = 0
  }

  /**
   * @param {number} now ms waktu nyata
   * @param {Vector2|null} p posisi pointer 0..1 (y ke atas), null kalau pointer tidak aktif
   */
  update(now, p) {
    if (now - this.lastStep < MOUSE_SIM.stepMs) return false
    this.lastStep = now
    const u = this.material.uniforms
    let radius = 0
    if (p) {
      const jump = this.hasPrev ? p.distanceTo(this.prev) : 0
      if (!this.hasPrev || now - this.lastMove > MOUSE_SIM.idleMs || jump > MOUSE_SIM.jump) {
        this.prev.copy(p)
        this.hasPrev = true
        this.target = 0
        this.velocity = 0
        this.lastMove = now
      }
      const dist = p.distanceTo(this.prev)
      if (dist > 1e-5) this.lastMove = now
      this.target = clamp((this.target + dist * 6) * 0.88, 0, 1)
      this.velocity += (power4out(this.target) - this.velocity) * 0.1
      radius = MOUSE_SIM.radius * smoothstep(0.1, 1, this.velocity)
      u.uA.value.copy(this.prev)
      u.uB.value.copy(p)
      this.prev.copy(p)
    }
    u.uRadius.value = radius
    const r = this.renderer
    const prevRT = r.getRenderTarget()
    u.tPrev.value = this.read.texture
    r.setRenderTarget(this.write)
    this.quad.render(r)
    r.setRenderTarget(prevRT)
    const t = this.read
    this.read = this.write
    this.write = t
    this.uniform.value = this.read.texture
    this.steps++
    return true
  }

  dispose() {
    this.read.dispose()
    this.write.dispose()
    this.material.dispose()
    this.quad.dispose()
  }
}
