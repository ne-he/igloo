import {
  Group, Mesh, PlaneGeometry, ShaderMaterial, LineSegments, BufferGeometry, BufferAttribute, LineBasicMaterial, Color,
  Vector2, Vector3,
} from 'three'
import { MsdfText } from '../../text/MsdfText.js'
import { clamp } from '../../engine/math.js'
import { factNumber } from '../igloo/facts.js'
import content from '../../content/content.js'

// Label fakta bata igloo, hidup di scene UI (piksel CSS, tajam di DPR asli, tidak kena LUT/bloom scene).
// Data dari bus 'igloo_fact' (src/scenes/igloo/BrickFacts.js): { index, text, number, total, anchor, camera } atau null.
// Bentuknya kartu ID es kecil, bahasa visual label kristal (Labels.js): baris kepala kecil "FACT 03/12",
// garis tipis, lalu fakta dengan huruf lebih besar, garis penunjuk bata -> siku -> garis bawah kartu.
// Reveal: garis penunjuk 0.2 s, kepala uShow1 0.4 s + uShow2 0.75 s (scramble), fakta menyusul factDelay
// kemudian dengan reveal yang sama, garis tipis tumbuh ikut kepala, pudar 0.25 s. Satu label sekaligus:
// fakta baru = reveal ulang dari nol di bata baru.
// Latar igloo pucat (langit dan salju sekitar 0.8 sRGB), teks putih saja tidak terbaca. Jadi di belakang kartu ada
// pelat bayangan lembut warna tinta UI (0x1e1e2c, sama dengan baris "// Copyright"), dan tiap garis penunjuk punya
// bayangan 1 px dengan warna yang sama.

export const FACT_LABEL = {
  show1: 0.4,
  show2: 0.75,
  line: 0.2,
  hide: 0.25,
  factDelay: 0.12, // detik, fakta mulai reveal sesudah kepala
  headerScale: 0.8, // ukuran kepala "FACT 03/12" relatif ukuran teks UI
  factScale: 1.15, // ukuran teks fakta relatif ukuran teks UI
  headerAlpha: 0.75,
  ruleGap: 0.6, // em teks UI, baseline kepala ke garis tipis
  factGap: 0.75, // em teks UI, garis tipis ke puncak huruf kapital fakta
  ruleAlpha: 0.45,
  elbowX: 2.2, // em, siku digeser dari titik bata (menjauhi sumbu igloo)
  elbowY: 2.4, // em, siku di atas titik bata
  padX: 0.75, // em, ruang kiri kanan teks di dalam pelat
  padY: 0.7, // em, ruang atas bawah huruf kapital di dalam pelat
  soft: 0.9, // em, lebar tepi lembut pelat
  radius: 0.35, // em, sudut pelat
  margin: 12, // px, jarak minimum ke tepi layar
  marker: 0.28, // em, setengah sisi kotak penanda di titik bata
  plateAlpha: 0.55,
  lineAlpha: 0.95,
  shadowAlpha: 0.5,
}

export const INK = 0x1e1e2c
const WHITE = 0xffffff
const MAX_SEGS = 8 // 2 ruas penunjuk + 4 sisi penanda + cadangan

const overlaps = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0

/** Teks kepala kartu: 'FACT 03/12'. Kosong kalau nomor tidak ada. */
export function factHeader(number, total, header = content.ui.facts.header) {
  return number > 0 && total > 0 ? `${header} ${factNumber(number, total)}` : ''
}

/**
 * Tinggi isi kartu (px): puncak huruf kapital kepala sampai baseline fakta.
 * @param {number} size ukuran teks UI (px), capHeight dalam em
 */
export function factCardHeight(size, capHeight) {
  const L = FACT_LABEL
  return capHeight * size * (L.headerScale + L.factScale) + (L.ruleGap + L.factGap) * size
}

/**
 * Tata letak label dalam piksel CSS, y ke bawah (logika murni, dites di tests/facts.test.js).
 * Label ke kanan kalau side >= 0, ke kiri kalau side < 0. Sisi dibalik kalau sisi pilihan tidak muat di layar
 * atau menabrak salah satu kotak `avoid` (blok teks UI: logo, copyright, hint, sound, penghitung) sementara sisi
 * lawannya bersih. Terakhir kotak dijepit ke dalam layar.
 * textHeight = tinggi isi kartu (px, factCardHeight), default satu baris huruf kapital (capHeight x size).
 * @returns {{side, anchor, elbow, end, box: {x0, y0, x1, y1}, textX, top, baseline}}
 *   top = puncak isi (y), baseline = baseline baris terakhir (y)
 */
export function factLabelLayout({ x, y, side, textWidth, textHeight, size, capHeight, width, height, avoid = [] }) {
  const L = FACT_LABEL
  const dx = L.elbowX * size
  const dy = L.elbowY * size
  const padX = L.padX * size
  const padY = L.padY * size
  const boxW = textWidth + 2 * padX
  const boxH = (textHeight ?? capHeight * size) + 2 * padY
  const m = L.margin
  const ey = clamp(y - dy, m + boxH, height - m)
  const candidate = (s) => {
    const x0 = s > 0 ? x + dx : x - dx - boxW
    const fits = x0 >= m && x0 + boxW <= width - m
    const box = { x0, y0: ey - boxH, x1: x0 + boxW, y1: ey }
    return { s, fits, clear: fits && !avoid.some((r) => overlaps(box, r)) }
  }
  const first = candidate(side >= 0 ? 1 : -1)
  const other = candidate(-first.s)
  const pick = [first, other].find((c) => c.clear) || [first, other].find((c) => c.fits) || first
  const s = pick.s
  let x0 = s > 0 ? x + dx : x - dx - boxW
  x0 = clamp(x0, m, Math.max(m, width - m - boxW))
  const ex = s > 0 ? x0 : x0 + boxW
  const endX = s > 0 ? x0 + boxW : x0
  return {
    side: s,
    anchor: { x, y },
    elbow: { x: ex, y: ey },
    end: { x: endX, y: ey },
    box: { x0, y0: ey - boxH, x1: x0 + boxW, y1: ey },
    textX: x0 + padX,
    top: ey - boxH + padY,
    baseline: ey - padY,
  }
}

const plateVertex = /* glsl */ `
uniform vec2 uFull;
varying vec2 vPx;
void main() {
  vPx = position.xy * uFull;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const plateFragment = /* glsl */ `
uniform vec2 uHalf;
uniform float uSoft;
uniform float uRadius;
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vPx;
void main() {
  // jarak bertanda ke kotak bersudut bulat (px), lalu tepi lembut ke luar
  vec2 q = abs(vPx) - uHalf + uRadius;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
  float a = uAlpha * (1.0 - smoothstep(-0.35 * uSoft, uSoft, d));
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor, a);
}
`

/** Pelat bayangan lembut (dipakai kartu fakta dan penghitung FactCounter.js, satu program shader). */
export function createPlate(name) {
  const plate = new Mesh(new PlaneGeometry(1, 1), new ShaderMaterial({
    uniforms: {
      uFull: { value: new Vector2(1, 1) },
      uHalf: { value: new Vector2() },
      uSoft: { value: 10 },
      uRadius: { value: 4 },
      uAlpha: { value: 0 },
      uColor: { value: new Color(INK) },
    },
    vertexShader: plateVertex,
    fragmentShader: plateFragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  }))
  plate.name = name
  return plate
}

/**
 * Taruh pelat di kotak piksel (x0, y0 kiri atas, y ke bawah) selebar w x h, tepi lembut `soft` px.
 * Scene UI: y = -y layar.
 */
export function placePlate(plate, x0, y0, w, h, soft, radius, alpha) {
  const u = plate.material.uniforms
  u.uHalf.value.set(w / 2, h / 2)
  u.uFull.value.set(w + 2 * soft, h + 2 * soft)
  u.uSoft.value = soft
  u.uRadius.value = Math.min(radius, w / 2, h / 2)
  u.uAlpha.value = alpha
  plate.position.set(x0 + w / 2, -(y0 + h / 2), 0)
  plate.scale.set(w + 2 * soft, h + 2 * soft, 1)
  plate.visible = w > 0.5 && alpha > 0.002
}

const _v = new Vector3()

export class FactLabel extends Group {
  /** @param {import('../../text/MsdfFont.js').MsdfFont} font */
  constructor(font) {
    super()
    this.name = 'ui_factLabel'
    this.font = font
    this.width = 1
    this.height = 1
    this.size = 12
    this.avoid = [] // kotak blok teks UI (px, y ke bawah) yang tidak boleh ditutup label
    this.avoidExtra = [] // kotak tambahan yang berubah tiap frame (penghitung FactCounter saat tampil)
    this.target = null // target aktif (null = sedang pudar / tidak ada)
    this.last = null // target terakhir, posisinya tetap diikuti selama pudar
    this.show1 = 0 // reveal kepala + pelat
    this.show2 = 0
    this.factShow1 = 0 // reveal fakta, menyusul factDelay
    this.factShow2 = 0
    this.line = 0
    this._side = 0
    this.layoutResult = null

    this.plate = createPlate('ui_factPlate')
    this.plate.renderOrder = 40

    // garis dan bayangannya memakai satu geometri, bayangan digeser 1 px lewat position objeknya
    const lineGeo = new BufferGeometry()
    lineGeo.setAttribute('position', new BufferAttribute(new Float32Array(MAX_SEGS * 2 * 3), 3))
    lineGeo.setDrawRange(0, 0)
    const lineMat = (color, opacity) =>
      new LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false })
    this.shadow = new LineSegments(lineGeo, lineMat(INK, FACT_LABEL.shadowAlpha))
    this.shadow.name = 'ui_factShadow'
    this.shadow.renderOrder = 41
    this.shadow.position.set(1, -1, 0) // bayangan 1 px ke kanan bawah
    this.lines = new LineSegments(lineGeo, lineMat(WHITE, FACT_LABEL.lineAlpha))
    this.lines.name = 'ui_factLines'
    this.lines.renderOrder = 42
    // garis tipis pemisah kepala dan fakta (di atas pelat, tanpa bayangan)
    const ruleGeo = new BufferGeometry()
    ruleGeo.setAttribute('position', new BufferAttribute(new Float32Array(2 * 3), 3))
    this.rule = new LineSegments(ruleGeo, lineMat(WHITE, FACT_LABEL.ruleAlpha))
    this.rule.name = 'ui_factRule'
    this.rule.renderOrder = 42

    this.header = new MsdfText(font, { text: '', color: WHITE, opacity: FACT_LABEL.headerAlpha, seed: 22 })
    this.header.name = 'ui_factHeader'
    this.text = new MsdfText(font, { text: '', color: WHITE, seed: 21 })
    this.text.name = 'ui_factText'
    for (const m of [this.header, this.text]) {
      m.renderOrder = 43
      m.uniforms.uShow1.value = 0
      m.uniforms.uShow2.value = 0
    }

    for (const o of [this.plate, this.shadow, this.lines, this.rule, this.header, this.text]) {
      o.frustumCulled = false
      this.add(o)
    }
    this.visible = false
  }

  get headerSize() {
    return FACT_LABEL.headerScale * this.size
  }

  get factSize() {
    return FACT_LABEL.factScale * this.size
  }

  /** Ukuran layar (CSS px) dan ukuran teks UI breakpoint sekarang. */
  resize(width, height, size) {
    this.width = width
    this.height = height
    if (size && size !== this.size) {
      this.size = size
      this.header.relayout({ size: this.headerSize })
      this.text.relayout({ size: this.factSize })
    }
  }

  /** Dari bus 'igloo_fact'. null = pudar. Bata baru = teks baru, reveal ulang dari nol. */
  setTarget(t) {
    if (!t || !t.text) {
      this.target = null
      return
    }
    const same = this.last && this.last.index === t.index && this.show1 > 0
    this.target = this.last = t
    if (same) return
    this.header.setText(factHeader(t.number, t.total), { size: this.headerSize })
    this.text.setText(t.text, { size: this.factSize })
    this.show1 = this.show2 = this.factShow1 = this.factShow2 = this.line = 0
    this._side = 0
  }

  /** Precompile: paksa semua bagian terlihat sesaat (UIScene.upload). */
  forceVisible(on) {
    if (on) {
      this._savedVisible = this.visible
      this.visible = true
    } else {
      this.visible = !!this._savedVisible
    }
  }

  /**
   * @param {number} dt detik
   * @param {boolean} enabled false = pudar (mis. mode detail)
   */
  update(dt, enabled = true) {
    const L = FACT_LABEL
    const on = enabled && !!this.target
    const up = (v, d) => clamp(v + dt / d, 0, 1)
    const down = (v) => clamp(v - dt / L.hide, 0, 1)
    if (on) {
      this.line = up(this.line, L.line)
      this.show1 = up(this.show1, L.show1)
      this.show2 = up(this.show2, L.show2)
      if (this.show1 * L.show1 >= L.factDelay) {
        this.factShow1 = up(this.factShow1, L.show1)
        this.factShow2 = up(this.factShow2, L.show2)
      }
    } else {
      this.line = down(this.line)
      this.show1 = down(this.show1)
      this.show2 = down(this.show2)
      this.factShow1 = down(this.factShow1)
      this.factShow2 = down(this.factShow2)
    }
    const t = this.last
    this.visible = !!t && (this.show1 > 0 || this.factShow1 > 0 || this.line > 0)
    if (!this.visible) return

    // titik bata di layar (kamera igloo sudah dirender frame ini, matrix-nya terbaru)
    _v.copy(t.anchor).project(t.camera)
    if (_v.z > 1) {
      this.visible = false
      return
    }
    const W = this.width
    const H = this.height
    const ax = (_v.x * 0.5 + 0.5) * W
    const ay = (0.5 - _v.y * 0.5) * H
    if (!this._side) {
      // sisi ditentukan sekali per label: menjauhi sumbu igloo (x = z = 0) di tinggi yang sama
      _v.set(0, t.anchor.y, 0).project(t.camera)
      this._side = ax >= (_v.x * 0.5 + 0.5) * W ? 1 : -1
    }
    const s = this.size
    const cap = this.font.capHeight
    const lay = factLabelLayout({
      x: ax, y: ay, side: this._side, textWidth: Math.max(this.text.layout.width, this.header.layout.width),
      textHeight: factCardHeight(s, cap), size: s, width: W, height: H,
      avoid: this.avoidExtra.length ? this.avoid.concat(this.avoidExtra) : this.avoid,
    })
    this.layoutResult = lay
    this._side = lay.side // sisi yang sudah dibalik jadi pilihan baru (tidak bolak-balik di batas)

    // kepala di puncak isi, garis tipis di bawahnya, fakta di baseline bawah kartu (y scene UI = -y layar)
    const headerBaseline = lay.top + cap * this.headerSize
    const ruleY = headerBaseline + L.ruleGap * s
    this.header.position.set(lay.textX, -headerBaseline, 0)
    this.header.uniforms.uShow1.value = this.show1
    this.header.uniforms.uShow2.value = this.show2
    this.text.position.set(lay.textX, -lay.baseline, 0)
    this.text.uniforms.uShow1.value = this.factShow1
    this.text.uniforms.uShow2.value = this.factShow2

    // pelat tumbuh dari siku searah garis bawah, ikut uShow1 kepala
    const b = lay.box
    const grow = this.show1 * (2 - this.show1) // ease out
    const w = (b.x1 - b.x0) * grow
    const h = b.y1 - b.y0
    const px0 = lay.side > 0 ? b.x0 : b.x1 - w
    placePlate(this.plate, px0, b.y0, w, h, L.soft * s, L.radius * s, L.plateAlpha * Math.min(1, Math.max(this.show1, this.factShow1) * 1.5))

    // garis tipis tumbuh dari kiri selebar isi kartu, ikut reveal kepala
    const rx1 = lay.textX + (b.x1 - b.x0 - 2 * L.padX * s) * grow
    const rp = this.rule.geometry.attributes.position
    rp.setXYZ(0, lay.textX, -ruleY, 0)
    rp.setXYZ(1, rx1, -ruleY, 0)
    rp.needsUpdate = true
    this.rule.visible = rx1 - lay.textX > 0.5
    this.rule.material.opacity = L.ruleAlpha * this.show1

    this._writeLines(lay)
  }

  // garis penunjuk digambar sepanjang jalurnya sesuai progres line, urut dari titik bata, plus kotak penanda
  _writeLines(lay) {
    const pos = this.lines.geometry.attributes.position
    let n = 0
    const put = (x0, y0, x1, y1) => {
      pos.setXYZ(n++, x0, -y0, 0)
      pos.setXYZ(n++, x1, -y1, 0)
    }
    const pts = [lay.anchor, lay.elbow, lay.end]
    let total = 0
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
    let left = total * this.line
    for (let i = 1; i < pts.length && left > 0; i++) {
      const a = pts[i - 1]
      const b = pts[i]
      const seg = Math.hypot(b.x - a.x, b.y - a.y)
      const k = Math.min(1, left / Math.max(seg, 1e-6))
      put(a.x, a.y, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k)
      left -= seg
    }
    const r = FACT_LABEL.marker * this.size * Math.min(1, this.line * 2)
    if (r > 0.5) {
      const { x, y } = lay.anchor
      put(x - r, y - r, x + r, y - r)
      put(x + r, y - r, x + r, y + r)
      put(x + r, y + r, x - r, y + r)
      put(x - r, y + r, x - r, y - r)
    }
    pos.needsUpdate = true
    this.lines.geometry.setDrawRange(0, n)
  }

  dispose() {
    this.text.dispose()
    this.header.dispose()
    this.plate.geometry.dispose()
    this.plate.material.dispose()
    this.lines.geometry.dispose()
    this.lines.material.dispose()
    this.shadow.material.dispose()
    this.rule.geometry.dispose()
    this.rule.material.dispose()
  }
}
