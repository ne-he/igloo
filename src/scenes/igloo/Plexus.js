import {
  Group, BufferGeometry, BufferAttribute, LineSegments, LineBasicMaterial, Points, Mesh, ShaderMaterial,
  InstancedBufferGeometry, InstancedBufferAttribute, PlaneGeometry, AdditiveBlending, CanvasTexture, Vector3,
} from 'three'
import plexMonoUrl from '@ibm/plex-mono/fonts/complete/woff2/IBMPlexMono-Medium.woff2?url'
import '../../glsl/chunks.js'

// Plexus bata (blueprint 5.1, skill ref 01 6.3, ref 02 4.10): maks 5 bata tergeser terdekat titik mouse,
// tiap bata maks 2 sambungan, satu perubahan per waktu (garis tumbuh 0.1 s, mundur 0.06 s) jadi terasa
// "mengetik". Garis putih 0.25 additive, titik kotak kecil yang berputar saat muncul, angka 2 digit
// = dua digit terakhir floor(jarak geser * 50).
const MAX_POINTS = 5
const MAX_LINKS = 2
const MAX_ITEMS = 10 // titik yang sedang muncul/hilang bisa lebih dari 5 sesaat
const MAX_SEGS = 10
const GROW = 0.1
const RETRACT = 0.06
const APPEAR = 0.25
const MIN_DISP = 0.1
const RADIUS = 2

let fontFamily = null

/** Muat IBM Plex Mono Medium (OFL) untuk atlas canvas. Gagal = monospace sistem. */
async function loadFont() {
  if (fontFamily) return fontFamily
  fontFamily = 'monospace'
  try {
    const face = new FontFace('IglooPlexMono', `url(${plexMonoUrl})`, { weight: '500' })
    await face.load()
    document.fonts.add(face)
    fontFamily = 'IglooPlexMono'
  } catch {
    // tetap monospace
  }
  return fontFamily
}

function canvasTexture(w, h, draw) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  draw(ctx)
  const tex = new CanvasTexture(canvas)
  tex.anisotropy = 4
  return tex
}

/**
 * Atlas angka buatan sendiri (canvas 2D) sampai MSDF dari agent teks siap.
 * plexus: 10 digit sebaris (sel 40 x 64). intro: 32 sel 64 x 64 (grid 8 x 4) berisi angka 2 digit / "+N".
 */
export async function createDigitsTexture() {
  const family = await loadFont()
  const plexus = canvasTexture(400, 64, (ctx) => {
    ctx.font = `500 50px ${family}`
    for (let i = 0; i < 10; i++) ctx.fillText(String(i), i * 40 + 20, 34)
  })
  let s = 11
  const rnd = () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
  const intro = canvasTexture(512, 256, (ctx) => {
    ctx.font = `500 28px ${family}`
    for (let i = 0; i < 32; i++) {
      const n = Math.floor(rnd() * 100)
      const label = rnd() < 0.15 ? `+${n % 10}` : String(n).padStart(2, '0')
      ctx.fillText(label, (i % 8) * 64 + 32, Math.floor(i / 8) * 64 + 33)
    }
  })
  return { plexus, intro }
}

const _focus = new Vector3()
const _dir = new Vector3()
const _ndc = new Vector3()

export class Plexus extends Group {
  constructor(globals, digits) {
    super()
    this.name = 'iglooPlexus'
    this.items = new Map() // indeks bata -> { appear }
    this.links = [] // { key, a, b, p, dir }

    // garis
    const lineGeo = new BufferGeometry()
    lineGeo.setAttribute('position', new BufferAttribute(new Float32Array(MAX_SEGS * 6), 3))
    lineGeo.setDrawRange(0, 0)
    this.lines = new LineSegments(lineGeo, new LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.25, blending: AdditiveBlending, depthTest: false, depthWrite: false,
    }))

    // titik kotak
    const pointGeo = new BufferGeometry()
    pointGeo.setAttribute('position', new BufferAttribute(new Float32Array(MAX_ITEMS * 3), 3))
    pointGeo.setAttribute('aAppear', new BufferAttribute(new Float32Array(MAX_ITEMS), 1))
    pointGeo.setDrawRange(0, 0)
    this.points = new Points(pointGeo, new ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { ...globals, uSize: { value: 520 } },
      vertexShader: /* glsl */ `
        #include <igloo_globals>
        uniform float uSize;
        attribute float aAppear;
        varying float vAppear;
        void main() {
          vAppear = aAppear;
          vec4 mv = viewMatrix * modelMatrix * vec4(position, 1.0);
          gl_PointSize = uSize / max(0.1, -mv.z) * (uResolution.y / 1300.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAppear;
        void main() {
          // kotak kecil yang berputar dari 1.3 rad ke 0 saat muncul
          float a = (1.0 - vAppear) * 1.3;
          vec2 p = gl_PointCoord - 0.5;
          p = mat2(cos(a), -sin(a), sin(a), cos(a)) * p;
          float w = fwidth(p.x) * 0.75;
          float box = smoothstep(0.2 + w, 0.2 - w, max(abs(p.x), abs(p.y)));
          float alpha = box * 0.5 * vAppear;
          if (alpha < 0.003) discard;
          gl_FragColor = vec4(vec3(1.0), alpha);
        }
      `,
    }))

    // angka: quad billboard per digit
    const quad = new PlaneGeometry(1, 1)
    const numGeo = new InstancedBufferGeometry()
    numGeo.index = quad.index
    numGeo.setAttribute('position', quad.getAttribute('position'))
    numGeo.setAttribute('uv', quad.getAttribute('uv'))
    numGeo.setAttribute('aAnchor', new InstancedBufferAttribute(new Float32Array(MAX_ITEMS * 2 * 3), 3))
    numGeo.setAttribute('aDigit', new InstancedBufferAttribute(new Float32Array(MAX_ITEMS * 2 * 2), 2)) // (digit, slot)
    numGeo.setAttribute('aAlpha', new InstancedBufferAttribute(new Float32Array(MAX_ITEMS * 2), 1))
    numGeo.instanceCount = 0
    this.numbers = new Mesh(numGeo, new ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { ...globals, tDigits: { value: digits } },
      vertexShader: /* glsl */ `
        #include <igloo_globals>
        attribute vec3 aAnchor;
        attribute vec2 aDigit;
        attribute float aAlpha;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          // tinggi digit dalam unit dunia (aset asli: min(0.1, 0.08 / (tinggiLayar / 1300))), sel atlas 1.35x glyph
          float h = min(0.1, 0.08 / (uResolution.y / 1300.0)) * 1.35;
          float w = h * 0.625;
          vec4 mv = viewMatrix * vec4(aAnchor, 1.0);
          mv.xy += vec2((aDigit.y + position.x) * w, (position.y + 0.55) * h);
          vUv = vec2((aDigit.x + uv.x) / 10.0, uv.y);
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDigits;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          float a = texture2D(tDigits, vUv).a * vAlpha;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vec3(1.0), a);
        }
      `,
    }))

    for (const o of [this.lines, this.points, this.numbers]) {
      o.frustumCulled = false
      o.renderOrder = 1001
      this.add(o)
    }
  }

  /** Pilih bata, atur sambungan satu per satu, tulis buffer. bricks = state dari Bricks (anchor, disp, centroid). */
  update(frame, bricks, mouse, camera, enabled = true) {
    const dt = Math.min(0.1, (frame.delta || 16.667) / 1000)
    // titik fokus: 1 unit di depan titik mouse ke arah kamera
    _focus.copy(camera.position).sub(mouse).normalize().add(mouse)

    const picked = []
    if (enabled) {
      for (const b of bricks) {
        if (b.disp <= MIN_DISP) continue
        const d = b.anchor.distanceTo(_focus)
        if (d < RADIUS) picked.push([d, b])
      }
      picked.sort((x, y) => x[0] - y[0])
      picked.length = Math.min(picked.length, MAX_POINTS)
    }
    const selected = new Set(picked.map(([, b]) => b.index))

    // sambungan yang diinginkan: tiap titik ke 2 tetangga terdekat
    const desired = new Map()
    for (const [, b] of picked) {
      const near = picked
        .filter(([, o]) => o !== b)
        .map(([, o]) => [o.anchor.distanceTo(b.anchor), o])
        .sort((x, y) => x[0] - y[0])
        .slice(0, MAX_LINKS)
      for (const [, o] of near) {
        const key = b.index < o.index ? `${b.index}-${o.index}` : `${o.index}-${b.index}`
        if (!desired.has(key)) desired.set(key, [b.index, o.index])
      }
    }

    // satu perubahan per waktu: lepas yang basi dulu, baru tambah yang baru
    if (!this.links.some((l) => l.dir !== 0)) {
      const stale = this.links.find((l) => !desired.has(l.key))
      if (stale) stale.dir = -1
      else {
        for (const [key, [a, b]] of desired) {
          if (!this.links.some((l) => l.key === key) && this.links.length < MAX_SEGS) {
            this.links.push({ key, a, b, p: 0, dir: 1 })
            break
          }
        }
      }
    }
    for (const l of this.links) {
      if (l.dir > 0) {
        l.p = Math.min(1, l.p + dt / GROW)
        if (l.p >= 1) l.dir = 0
      } else if (l.dir < 0) {
        l.p = Math.max(0, l.p - dt / RETRACT)
      }
    }
    this.links = this.links.filter((l) => !(l.dir < 0 && l.p <= 0))

    // titik muncul/hilang
    for (const i of selected) if (!this.items.has(i)) this.items.set(i, { appear: 0 })
    for (const [i, it] of this.items) {
      it.appear = selected.has(i) ? Math.min(1, it.appear + dt / APPEAR) : Math.max(0, it.appear - dt / APPEAR)
      if (it.appear <= 0 && !selected.has(i)) this.items.delete(i)
    }

    this._write(bricks, camera)
  }

  _write(bricks, camera) {
    const lp = this.lines.geometry.attributes.position
    let n = 0
    for (const l of this.links) {
      const a = bricks[l.a].anchor
      const b = bricks[l.b].anchor
      lp.setXYZ(n * 2, a.x, a.y, a.z)
      _dir.lerpVectors(a, b, l.p)
      lp.setXYZ(n * 2 + 1, _dir.x, _dir.y, _dir.z)
      n++
    }
    lp.needsUpdate = true
    this.lines.geometry.setDrawRange(0, n * 2)

    const pp = this.points.geometry.attributes.position
    const pa = this.points.geometry.attributes.aAppear
    const na = this.numbers.geometry.attributes.aAnchor
    const nd = this.numbers.geometry.attributes.aDigit
    const nal = this.numbers.geometry.attributes.aAlpha
    let k = 0
    for (const [i, it] of this.items) {
      if (k >= MAX_ITEMS) break
      const b = bricks[i]
      pp.setXYZ(k, b.anchor.x, b.anchor.y, b.anchor.z)
      pa.setX(k, it.appear)
      const value = Math.floor(b.centroid.length() * b.disp * 50) % 100
      // angka di sisi luar: kanan kalau bata di separuh kanan layar
      _ndc.copy(b.anchor).project(camera)
      const right = _ndc.x > 0
      const digits = [Math.floor(value / 10), value % 10]
      for (let d = 0; d < 2; d++) {
        const slot = right ? 0.9 + d : -2.4 + d
        na.setXYZ(k * 2 + d, b.anchor.x, b.anchor.y, b.anchor.z)
        nd.setXY(k * 2 + d, digits[d], slot)
        nal.setX(k * 2 + d, it.appear * 0.9)
      }
      k++
    }
    pp.needsUpdate = pa.needsUpdate = true
    na.needsUpdate = nd.needsUpdate = nal.needsUpdate = true
    this.points.geometry.setDrawRange(0, k)
    this.numbers.geometry.instanceCount = k * 2
  }
}
