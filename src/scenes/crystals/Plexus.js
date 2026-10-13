import {
  Group, LineSegments, Points, BufferGeometry, BufferAttribute, ShaderMaterial, Color, AdditiveBlending,
} from 'three'
import { mulberry32 } from '../../text/layout.js'
import { clamp, mod } from '../../engine/math.js'

// Plexus di sekitar tiap kristal (skill ref 01 bagian 6.3, ref 02 bagian 6.7). Desain dan kode sendiri.
// 18 titik di cincin radius 0.8..1.0 x 0.9 x bounding sphere, mengorbit pelan (kecepatan sudut
// (acak - 0.5) * 0.5 rad/s) dan bergeser naik dengan wrap 3 unit. Tiap titik maks 3 sambungan ke titik
// lain yang jaraknya < 3, sambungan tumbuh/menyusut 0.35 s, hanya tersambung kalau kristal dalam
// 1.25 unit dari kamera. Garis #7f7f7f additive, dipotong putus-putus oleh sine noise, memudar dekat kristal.

export const PLEXUS = { count: 18, maxLinks: 3, maxDist: 3, grow: 0.35, wrap: 3, near: 1.25, rise: 0.06, spawnRate: 7, opacity: 0.6 }

const MAX_EDGES = 64

const lineShader = {
  vertexShader: /* glsl */ `
    attribute float aAlpha;
    varying vec3 vPos;
    varying float vAlpha;
    void main() {
      vPos = position;
      vAlpha = aAlpha;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uShow;
    uniform float uOpacity;
    varying vec3 vPos;
    varying float vAlpha;
    // sine noise: jumlah sinus bersarang, 0..1
    float sinenoise(vec3 p) {
      float a = sin(p.x * 1.13 + sin(p.y * 0.87 + sin(p.z * 1.31) * 1.7) * 1.9);
      float b = sin(p.y * 1.21 + sin(p.z * 0.93 + p.x * 0.41) * 1.6);
      return (a * 0.6 + b * 0.4) * 0.5 + 0.5;
    }
    void main() {
      float dash = step(0.45, sinenoise(vPos * 10.1));
      float nearFade = smoothstep(0.75, 1.5, length(vPos));
      float a = dash * nearFade * vAlpha * uShow * uOpacity;
      if (a < 0.002) discard;
      gl_FragColor = vec4(uColor * a, 1.0);
    }
  `,
}

const pointShader = {
  vertexShader: /* glsl */ `
    attribute float aAlpha;
    uniform float uSize;
    varying float vAlpha;
    void main() {
      vAlpha = aAlpha;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = uSize / -mv.z;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    uniform float uShow;
    varying float vAlpha;
    void main() {
      // tanda plus tipis
      vec2 c = abs(gl_PointCoord - 0.5);
      float plus = max(step(c.x, 0.07), step(c.y, 0.07));
      float a = plus * vAlpha * uShow;
      if (a < 0.002) discard;
      gl_FragColor = vec4(uColor * a, 1.0);
    }
  `,
}

export class Plexus extends Group {
  /**
   * @param {number} radius radius bounding sphere kristal
   * @param {number} seed
   */
  constructor(radius, seed = 1) {
    super()
    this.name = 'crystal_plexus'
    const rnd = mulberry32(seed * 131 + 7)
    this.rnd = rnd
    this.pts = Array.from({ length: PLEXUS.count }, () => ({
      angle: rnd() * Math.PI * 2,
      speed: (rnd() - 0.5) * 0.5,
      r: radius * 0.9 * (0.8 + 0.2 * rnd()),
      y0: rnd() * PLEXUS.wrap,
      x: 0, y: 0, z: 0, alpha: 0, links: 0,
    }))
    this.edges = []
    this.rise = 0
    this.spawnAcc = 0

    const lg = new BufferGeometry()
    lg.setAttribute('position', new BufferAttribute(new Float32Array(MAX_EDGES * 2 * 3), 3))
    lg.setAttribute('aAlpha', new BufferAttribute(new Float32Array(MAX_EDGES * 2), 1))
    this.uShow = { value: 0 }
    this.lines = new LineSegments(lg, new ShaderMaterial({
      ...lineShader,
      uniforms: { uColor: { value: new Color('#7f7f7f') }, uShow: this.uShow, uOpacity: { value: PLEXUS.opacity } },
      transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
    }))
    const pg = new BufferGeometry()
    pg.setAttribute('position', new BufferAttribute(new Float32Array(PLEXUS.count * 3), 3))
    pg.setAttribute('aAlpha', new BufferAttribute(new Float32Array(PLEXUS.count), 1))
    this.points = new Points(pg, new ShaderMaterial({
      ...pointShader,
      uniforms: { uColor: { value: new Color('#666666') }, uShow: this.uShow, uSize: { value: 50 } },
      transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
    }))
    for (const o of [this.lines, this.points]) {
      o.frustumCulled = false
      o.renderOrder = 5
      this.add(o)
    }
  }

  /**
   * @param {number} dt detik
   * @param {number} offsetY posisi y kristal dikurangi posisi y kamera
   * @param {number} pointScale skala ukuran titik (tinggi layar / 1300 dalam piksel buffer)
   */
  update(dt, offsetY, pointScale = 1) {
    const dist = Math.abs(offsetY)
    this.uShow.value = 1 - clamp((dist - 1.0) / 1.5, 0, 1)
    this.visible = this.uShow.value > 0
    if (!this.visible) return
    this.points.material.uniforms.uSize.value = 50 * pointScale

    // gerak titik: orbit + naik pelan dengan wrap 3 unit, alpha memudar dekat batas wrap
    this.rise += dt * PLEXUS.rise
    const half = PLEXUS.wrap / 2
    for (const p of this.pts) {
      p.angle += p.speed * dt
      const y = mod(p.y0 + this.rise, PLEXUS.wrap) - half
      p.wrapped = Math.abs(y - p.y) > half
      p.x = Math.cos(p.angle) * p.r
      p.y = y
      p.z = Math.sin(p.angle) * p.r
      p.alpha = clamp((half - Math.abs(y)) / 0.35, 0, 1)
    }

    const connect = dist < PLEXUS.near
    const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2
    const maxD2 = PLEXUS.maxDist * PLEXUS.maxDist

    // sambungan yang ada: tumbuh, menua, menyusut, dibuang
    for (let i = this.edges.length - 1; i >= 0; i--) {
      const e = this.edges[i]
      const a = this.pts[e.a]
      const b = this.pts[e.b]
      e.life -= dt
      if (a.wrapped || b.wrapped) {
        // titik loncat: garis langsung hilang
        e.t = 0
        e.dir = -1
      } else if (!connect || e.life <= 0 || d2(a, b) > maxD2) e.dir = -1
      e.t = clamp(e.t + (e.dir * dt) / PLEXUS.grow, 0, 1)
      if (e.dir < 0 && e.t <= 0) {
        a.links--
        b.links--
        this.edges.splice(i, 1)
      }
    }

    // sambungan baru: beberapa percobaan per detik, ke titik acak yang masih punya slot
    if (connect) {
      this.spawnAcc += dt * PLEXUS.spawnRate
      while (this.spawnAcc >= 1 && this.edges.length < MAX_EDGES) {
        this.spawnAcc -= 1
        const ia = Math.floor(this.rnd() * this.pts.length)
        const a = this.pts[ia]
        if (a.links >= PLEXUS.maxLinks) continue
        const options = []
        this.pts.forEach((b, ib) => {
          if (ib === ia || b.links >= PLEXUS.maxLinks || d2(a, b) > maxD2) return
          if (this.edges.some((e) => (e.a === ia && e.b === ib) || (e.a === ib && e.b === ia))) return
          options.push(ib)
        })
        if (!options.length) continue
        const ib = options[Math.floor(this.rnd() * options.length)]
        a.links++
        this.pts[ib].links++
        this.edges.push({ a: ia, b: ib, t: 0, dir: 1, life: 1.5 + this.rnd() * 3.5 })
      }
    } else {
      this.spawnAcc = 0
    }

    this._write()
  }

  _write() {
    const lp = this.lines.geometry.attributes.position
    const la = this.lines.geometry.attributes.aAlpha
    let n = 0
    for (const e of this.edges) {
      if (e.t <= 0) continue
      const a = this.pts[e.a]
      const b = this.pts[e.b]
      // garis tumbuh dari titik a ke b (ease out)
      const k = 1 - (1 - e.t) * (1 - e.t)
      lp.setXYZ(n, a.x, a.y, a.z)
      lp.setXYZ(n + 1, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k)
      la.setX(n, a.alpha)
      la.setX(n + 1, Math.min(a.alpha, b.alpha))
      n += 2
    }
    lp.needsUpdate = la.needsUpdate = true
    this.lines.geometry.setDrawRange(0, n)

    const pp = this.points.geometry.attributes.position
    const pa = this.points.geometry.attributes.aAlpha
    this.pts.forEach((p, i) => {
      pp.setXYZ(i, p.x, p.y, p.z)
      pa.setX(i, p.alpha)
    })
    pp.needsUpdate = pa.needsUpdate = true
  }

  dispose() {
    for (const o of [this.lines, this.points]) {
      o.geometry.dispose()
      o.material.dispose()
    }
  }
}
