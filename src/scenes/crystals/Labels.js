import { Group, LineSegments, BufferGeometry, BufferAttribute, LineBasicMaterial, Vector3, Color, MathUtils } from 'three'
import { MsdfText } from '../../text/MsdfText.js'
import { clamp } from '../../engine/math.js'
import { LabelPlate, INK } from './LabelParts.js'
import { clampShift } from './nudge.js'

// Label 3D tiap kristal (skill ref 01 bagian 6.3, ref 02 bagian 6.7). Mesh MSDF di dalam scene (bukan DOM),
// jadi ikut grade, bloom, dan wipe transisi. Tiap label menempel ke satu titik bounding box kristal
// (campuran min/max, ikut rotasi kristal), lalu digeser sepanjang vektor KIRI/ATAS kamera.
// Label muncul kalau offset y kristal ke kamera ada di jendelanya: reveal uShow1 0.4 s, uShow2 0.75 s,
// garis penunjuk digambar 0.2 s. TEMP = temp + 2 sin(0.05 t + acak): baris 1 Fahrenheit, baris 2 Celsius bertanda.
//
// Keterbacaan dan ajakan klik (review pengunjung Okt 2026):
//  - Teks putih di latar pucat susah dibaca. Tiap blok teks dapat pelat lembut warna tinta UI (0x1e1e2c,
//    cara yang sama dengan label fakta igloo di src/scenes/ui/FactLabel.js), tiap teks dan garis dapat
//    bayangan 1 px warna yang sama.
//  - Ukuran label sekarang dihitung dalam piksel CSS (LABEL_PX), bukan rumus skala igloo: kamera portrait
//    mundur (BaseCamera.zoom), jadi dengan rumus lama label di ponsel cuma sekitar 10 px.
//  - Blok digeser ke dalam layar kalau terpotong tepi (ponsel sempit), garis penunjuk ikut menekuk.
//  - "CLICK TO EXPLORE" diganti tombol berbingkai [ OPEN ] di bawah garis tanggal: bingkai bernapas pelan,
//    saat hot (hover kristal / tombol, atau ajakan) isinya jadi putih dan teksnya tinta.
//  - Teks ajakan kecil ("CLICK THE ICE" / "TAP THE ICE") muncul di bawah tombol dengan scramble.

export const LABELS = {
  title: 0.13, date: 0.13, temp: 0.105, button: 0.115, nudge: 0.1,
  show1: 0.4, show2: 0.75, line: 0.2, hide: 0.3,
}

// Tinggi em judul di layar (piksel CSS). Layar pendek mengecil sebanding tinggi, ponsel sempit pakai narrow.
export const LABEL_PX = { em: 17, refH: 812, min: 13, narrow: 14.5, narrowW: 560 }

export const LABEL_STYLE = {
  plateAlpha: 0.46,
  pad: 0.5, // em, ruang di sekitar blok teks di dalam pelat
  soft: 0.85, // em, tepi lembut pelat
  radius: 0.3, // em
  shadowAlpha: 0.6,
  shadowPx: 1,
  lineAlpha: 0.85,
  margin: 14, // px, jarak minimum blok ke tepi layar
}

export const BUTTON = {
  gap: 0.55, // em tombol, garis bawah tanggal ke atas bingkai
  padX: 0.55, // em tombol
  padY: 0.5,
  bold: 0.05,
  breathe: 3.2, // detik per satu napas bingkai
  frameLo: 0.35,
  frameHi: 0.95,
  fillAlpha: 0.92, // isi putih saat hot penuh
  nudgeGap: 0.7, // em teks ajakan, bawah bingkai ke atas huruf ajakan
}

// f = faktor campuran bbox (0 = min, 1 = max) di ruang lokal kristal, o = geser (kiri, atas) dalam satuan skala,
// win = jendela offset y kristal ke kamera tempat label tampil
const SPECS = {
  title: { f: [0.3, 0.88, 0.85], o: [0.16, 0.3], win: [-1.6, 0.5] },
  date: { f: [0.85, 0.22, 0.8], o: [-0.3, -0.12], win: [-0.6, 1.25] },
  temp: { f: [0.8, 0.85, 0.75], o: [-0.28, 0.12], win: [-1.2, 0.5] },
}

const WHITE = 0xffffff
const UNDERLINE_PAD = 0.06 // unit label (sebelum skala)
const _a = new Vector3()
const _right = new Vector3()
const _up = new Vector3()
const _fwd = new Vector3()
const _p = new Vector3()
const _q = new Vector3()
const _c = new Vector3()
const _shadow = new Vector3()
const _white = new Color(WHITE)
const _ink = new Color(INK)

/** Celsius -> dua baris TEMP: Fahrenheit 2 desimal, Celsius bertanda 2 digit + 2 desimal. */
export function formatTemp(c) {
  const f = (c * 1.8 + 32).toFixed(2)
  const sign = c < 0 ? '-' : '+'
  const cel = Math.abs(c).toFixed(2).padStart(5, '0')
  return `${f}\n${sign}${cel}`
}

/** Judul jadi dua baris: kode portofolio, lalu nama. */
const splitTitle = (title) => {
  const i = title.indexOf(' ')
  return i < 0 ? title : `${title.slice(0, i)}\n${title.slice(i + 1)}`
}

/** Baris tanggal di atas tombol (CLICK TO EXPLORE lama sudah jadi tombol [ OPEN ]). */
export const dateText = (date) => `D ${String(date || '').replaceAll('/', '.')}`

/** Tinggi em judul (px CSS) untuk ukuran layar ini. */
export function labelEmPx(w, h) {
  const L = LABEL_PX
  const em = clamp(L.em * Math.min(1, h / L.refH), L.min, L.em)
  return w < L.narrowW ? Math.min(em, L.narrow) : em
}

/** Teks putih + salinan tinta 1 px di belakangnya. Seed sama, jadi scramble keduanya identik. */
class ShadowText {
  constructor(font, o, group) {
    this.main = new MsdfText(font, { ...o, color: WHITE })
    this.shadow = new MsdfText(font, { ...o, color: INK })
    this.shadow.uniforms.uOpacity.value = LABEL_STYLE.shadowAlpha
    this.main.renderOrder = 33
    this.shadow.renderOrder = 31
    for (const m of [this.shadow, this.main]) {
      m.frustumCulled = false
      group.add(m)
    }
  }

  get box() {
    return this.main.box
  }

  get layout() {
    return this.main.layout
  }

  setText(text) {
    this.main.setText(text)
    this.shadow.setText(text)
  }

  setShow(s1, s2) {
    for (const m of [this.main, this.shadow]) {
      m.uniforms.uShow1.value = s1
      m.uniforms.uShow2.value = s2
      m.visible = s1 > 0
    }
  }

  setScramble(on) {
    for (const m of [this.main, this.shadow]) m.uniforms.uScramble.value = on ? 1 : 0
  }

  place(pos, quaternion, scale) {
    this.main.position.copy(pos)
    this.shadow.position.copy(pos).add(_shadow)
    for (const m of [this.main, this.shadow]) {
      m.quaternion.copy(quaternion)
      m.scale.setScalar(scale)
    }
  }

  dispose() {
    this.main.dispose()
    this.shadow.dispose()
  }
}

/** Satu label: teks + status reveal. */
class Label {
  constructor(key, texts) {
    this.key = key
    this.spec = SPECS[key]
    this.texts = texts
    this.visible = false
    this.show1 = 0
    this.show2 = 0
    this.line = 0
    this.anchor = new Vector3()
    this.elbow = new Vector3()
    this.side = 1 // 1 = sisi normal, -1 = cermin (blok terpotong tepi layar)
    this.path = [] // titik garis penunjuk (dunia)
  }

  setTarget(on, dt, snap) {
    this.visible = on
    if (snap) {
      this.show1 = this.show2 = this.line = on ? 1 : 0
    } else if (on) {
      this.line = clamp(this.line + dt / LABELS.line, 0, 1)
      this.show1 = clamp(this.show1 + dt / LABELS.show1, 0, 1)
      this.show2 = clamp(this.show2 + dt / LABELS.show2, 0, 1)
    } else {
      this.line = clamp(this.line - dt / LABELS.line, 0, 1)
      this.show1 = clamp(this.show1 - dt / LABELS.hide, 0, 1)
      this.show2 = clamp(this.show2 - dt / LABELS.hide, 0, 1)
    }
    for (const t of this.texts) t.setShow(this.show1, this.show2)
  }
}

const lineMaterial = (color, opacity) =>
  new LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false })

export class CrystalLabels extends Group {
  /**
   * @param {import('../../text/MsdfFont.js').MsdfFont} font
   * @param {{title:string, date:string, temp:number}} project
   * @param {import('three').Box3} box bounding box geometri kristal (ruang lokal)
   * @param {number} seed
   * @param {{open:string, nudge:string, nudgeTouch:string}} ui teks tombol dan ajakan (content.ui.crystal)
   */
  constructor(font, project, box, seed = 1, ui = {}) {
    super()
    this.name = 'crystal_labels'
    this.font = font
    this.project = project
    this.box = box
    this.ui = { open: '[ OPEN ]', nudge: 'CLICK THE ICE', nudgeTouch: 'TAP THE ICE', ...ui }
    this.rand = ((seed * 9301 + 49297) % 233280) / 233280 * Math.PI * 2 // fase TEMP tetap

    // pelat di bawah semuanya (renderOrder 28), isi tombol di atas pelat (29)
    this.plates = { title: new LabelPlate(), date: new LabelPlate(), temp: new LabelPlate() }
    for (const p of Object.values(this.plates)) {
      p.renderOrder = 28
      this.add(p)
    }
    this.fill = new LabelPlate(WHITE)
    this.fill.renderOrder = 29
    this.add(this.fill)

    const mk = (text, size, align, s, extra = {}) => new ShadowText(font, { text, size, align, seed: seed * 10 + s, ...extra }, this)
    this.title = mk(splitTitle(project.title), LABELS.title, 'left', 1)
    this.date = mk(dateText(project.date), LABELS.date, 'right', 2)
    this.tempLabel = mk('TEMP', LABELS.temp, 'left', 3)
    this.tempValue = mk(formatTemp(project.temp), LABELS.temp, 'right', 4)
    this.button = mk(this.ui.open, LABELS.button, 'center', 5, { bold: BUTTON.bold })
    this.nudgeText = mk(this.ui.nudge, LABELS.nudge, 'right', 6)
    this.labels = [
      new Label('title', [this.title]),
      new Label('date', [this.date, this.button]),
      new Label('temp', [this.tempLabel, this.tempValue]),
    ]
    this.texts = [this.title, this.date, this.tempLabel, this.tempValue, this.button, this.nudgeText]
    // ajakan: reveal sendiri, lepas dari jendela label
    this.nudge = { on: false, show1: 0, show2: 0 }
    this.nudgeText.setShow(0, 0)
    this.hot = 0 // 0..1, sorot tombol + isi putih
    this.buttonRect = null // kotak tombol di NDC (-1..1, y ke atas), null = belum bisa diklik
    this.metrics = { emPx: 0, scale: 0 } // dibaca tools verifikasi

    // semua garis penunjuk dalam satu LineSegments, posisi dunia ditulis ulang tiap frame.
    // Bayangan memakai geometri yang sama, digeser 1 px lewat position objeknya.
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(32 * 3), 3))
    this.lines = new LineSegments(geo, lineMaterial(WHITE, LABEL_STYLE.lineAlpha))
    this.lineShadow = new LineSegments(geo, lineMaterial(INK, LABEL_STYLE.shadowAlpha))
    // bingkai tombol: 4 sisi, opacity sendiri (napas + sorot)
    const fgeo = new BufferGeometry()
    fgeo.setAttribute('position', new BufferAttribute(new Float32Array(8 * 3), 3))
    this.frame = new LineSegments(fgeo, lineMaterial(WHITE, 0))
    this.frameShadow = new LineSegments(fgeo, lineMaterial(INK, LABEL_STYLE.shadowAlpha))
    this.lineShadow.renderOrder = this.frameShadow.renderOrder = 30
    this.lines.renderOrder = this.frame.renderOrder = 32
    for (const l of [this.lineShadow, this.lines, this.frameShadow, this.frame]) {
      l.frustumCulled = false
      this.add(l)
    }
  }

  /** Siapkan satu ajakan baru: touch = teks sentuh, reduced = tanpa scramble. Reveal mulai dari nol. */
  prepareNudge({ touch = false, reduced = false } = {}) {
    this.nudgeText.setText(touch ? this.ui.nudgeTouch : this.ui.nudge)
    this.nudgeText.setScramble(!reduced)
    this.nudge.on = false
    this.nudge.show1 = this.nudge.show2 = 0
  }

  /** Tampilkan / pudarkan teks ajakan yang sudah disiapkan. */
  setNudge(on) {
    this.nudge.on = on
  }

  /**
   * @param {object} o
   * @param {import('three').PerspectiveCamera} o.camera kamera yang sudah di-update frame ini
   * @param {import('three').Object3D} o.mesh mesh kristal (matrixWorld terbaru)
   * @param {number} o.offsetY posisi y kristal dikurangi posisi y kamera
   * @param {number} o.time detik
   * @param {number} o.dt detik
   * @param {number} o.width lebar layar (px CSS)
   * @param {number} o.height tinggi layar (px CSS)
   * @param {boolean} o.snap lompat langsung ke status akhir (teleport scroll)
   * @param {boolean} o.enabled false = sembunyikan semua (mis. kristal jauh)
   * @param {number} [o.hot] 0..1 sorot tombol (hover kristal / tombol, kedip ajakan)
   * @param {boolean} [o.reduced] prefers-reduced-motion: bingkai tidak bernapas
   */
  update({ camera, mesh, offsetY, time, dt, width, height, snap, enabled, hot = 0, reduced = false }) {
    for (const l of this.labels) {
      const [lo, hi] = l.spec.win
      l.setTarget(enabled && offsetY > lo && offsetY < hi, dt, snap)
    }
    // ajakan hanya selama label tanggal (tempat tombol) tampil
    const n = this.nudge
    const nOn = n.on && this.labels[1].visible
    if (nOn) {
      n.show1 = clamp(n.show1 + dt / LABELS.show1, 0, 1)
      n.show2 = clamp(n.show2 + dt / LABELS.show2, 0, 1)
    } else {
      n.show1 = clamp(n.show1 - dt / LABELS.hide, 0, 1)
      n.show2 = clamp(n.show2 - dt / LABELS.hide, 0, 1)
    }
    this.nudgeText.setShow(n.show1, n.show2)
    this.hot = hot
    this.buttonRect = null
    const any = this.labels.some((l) => l.show1 > 0 || l.line > 0) || n.show1 > 0
    this.visible = any
    if (!any) return

    // TEMP berdenyut pelan: ganti teks hanya kalau angkanya berubah (buffer dipakai ulang)
    this.tempValue.setText(formatTemp(this.project.temp + 2 * Math.sin(0.05 * time + this.rand)))

    // sumbu kamera, ukuran 1 px CSS di kedalaman kristal, skala label dari tinggi em target
    const e = camera.matrixWorld.elements
    _right.set(e[0], e[1], e[2]).normalize()
    _up.set(e[4], e[5], e[6]).normalize()
    _fwd.set(-e[8], -e[9], -e[10]).normalize()
    const tanH = Math.tan(MathUtils.DEG2RAD * camera.fov * 0.5) / camera.zoom
    _p.setFromMatrixPosition(mesh.matrixWorld).sub(camera.position)
    const depth = Math.max(0.1, _p.dot(_fwd))
    const px = (2 * depth * tanH) / height
    const emPx = labelEmPx(width, height)
    const s = (emPx * px) / LABELS.title
    this.metrics.emPx = emPx
    this.metrics.scale = s
    _shadow.copy(_right).multiplyScalar(LABEL_STYLE.shadowPx * px).addScaledVector(_up, -LABEL_STYLE.shadowPx * px)
    this.lineShadow.position.copy(_shadow)
    this.frameShadow.position.copy(_shadow)
    const q = camera.quaternion
    const capH = this.font.capHeight
    const st = LABEL_STYLE

    const b = this.box
    for (const l of this.labels) {
      const [fx, fy, fz] = l.spec.f
      _a.set(b.min.x + (b.max.x - b.min.x) * fx, b.min.y + (b.max.y - b.min.y) * fy, b.min.z + (b.max.z - b.min.z) * fz)
      l.anchor.copy(_a).applyMatrix4(mesh.matrixWorld)
      if (snap) l.side = 1
    }

    // Posisi blok di layar. Isi blok [c0, c1] (unit label, sumbu kanan kamera, relatif siku normal) + pad.
    // Kalau blok terpotong tepi layar dan sisi cermin (siku di ujung lain, blok di sisi lain titik kristal)
    // butuh geseran jauh lebih kecil, label pindah sisi. Jadi garis penunjuk tidak pernah memotong teksnya
    // sendiri. Sisanya digeser masuk. Mengembalikan offset x isi (0 = normal, -(u0 + u1) = cermin).
    // u0..u1 = rentang garis bawah tempat siku menempel (default sama dengan isi). mirror false = hanya digeser
    // (judul: garis penunjuknya datang dari bawah garis bawah, jadi geseran tidak pernah memotong teks).
    const block = (l, c0, c1, pad, u0 = c0, u1 = c1, mirror = true) => {
      const trySide = (side) => {
        _q.copy(l.anchor).addScaledVector(_right, -l.spec.o[0] * s * side).addScaledVector(_up, l.spec.o[1] * s)
        const off = side > 0 ? 0 : -(u0 + u1)
        _p.copy(_q).sub(camera.position)
        const d = Math.max(0.1, _p.dot(_fwd))
        const hw = d * tanH * camera.aspect
        const m = st.margin * px * (d / depth)
        const x = _p.dot(_right)
        return { side, off, shift: clampShift(x + (c0 + off - pad) * s, x + (c1 + off + pad) * s, -hw + m, hw - m), elbow: _q.clone() }
      }
      let pick = trySide(mirror ? l.side : 1)
      const other = mirror ? trySide(-l.side) : pick
      // ambang 8 px supaya tidak bolak-balik saat kristal bergoyang di batas
      if (Math.abs(other.shift) + 8 * px < Math.abs(pick.shift)) pick = other
      l.side = pick.side
      l.elbow.copy(pick.elbow).addScaledVector(_right, pick.shift)
      return pick.off
    }
    // titik dunia dari koordinat (x kanan, y atas) unit label relatif siku
    const at = (out, l, x, y) => out.copy(l.elbow).addScaledVector(_right, x * s).addScaledVector(_up, y * s)
    // pelat tumbuh dari sisi siku mengikuti show1 (ease out), satu kotak [x0, x1] x [y0, y1] unit label
    const plate = (p, l, x0, x1, y0, y1, em, fromRight, alphaK = 1) => {
      const pad = st.pad * em
      const grow = l.show1 * (2 - l.show1)
      let a0 = x0 - pad
      let a1 = x1 + pad
      if (fromRight) a0 = a1 - (a1 - a0) * grow
      else a1 = a0 + (a1 - a0) * grow
      at(_c, l, (a0 + a1) / 2, (y0 + y1) / 2)
      const alpha = st.plateAlpha * Math.min(1, l.show1 * 1.5) * alphaK
      p.set(_c, q, (a1 - a0) * s, (y1 - y0 + 2 * pad) * s, st.soft * em * s, st.radius * em * s, alpha)
    }

    // judul: siku = ujung kanan garis bawah, teks rata kiri di atas garis bawah, garis: kristal -> siku -> kiri
    {
      const l = this.labels[0]
      const T = LABELS.title
      const w = this.title.box.width + UNDERLINE_PAD
      const lh = this.title.layout.lineHeight * T
      const base = 0.05 + (this.title.layout.lineCount - 1) * lh
      const top = base + capH * T
      const off = block(l, -w, 0, st.pad * T, -w, 0, false)
      this.title.place(at(_p, l, -w + off, base), q, s)
      l.path = [l.anchor.clone(), l.elbow.clone(), at(new Vector3(), l, off === 0 ? -w : w, 0)]
      plate(this.plates.title, l, -w + off, off, 0, top, T, off === 0)
    }
    // tanggal + tombol: siku = ujung kiri garis bawah, tanggal rata kanan di atas garis,
    // tombol berbingkai rata kanan di bawah garis, teks ajakan di bawah tombol
    {
      const l = this.labels[1]
      const D = LABELS.date
      const B = LABELS.button
      const N = LABELS.nudge
      const bw = this.button.box.width + 2 * BUTTON.padX * B
      const bh = capH * B + 2 * BUTTON.padY * B
      const w = Math.max(this.date.box.width, bw) + UNDERLINE_PAD
      const top = 0.05 + capH * D
      const fTop = -BUTTON.gap * B
      const fBot = fTop - bh
      const nBase = fBot - BUTTON.nudgeGap * N - capH * N
      // pelat ikut memanjang ke bawah selama teks ajakan tampil (satu pelat, tanpa sambungan gelap)
      const nk = n.show1 * (2 - n.show1)
      const bottom = fBot + (nBase - 0.12 * N - fBot) * nk
      // teks ajakan rata kanan di x = w, kalau lebih lebar dari blok ia menjorok ke kiri siku
      const nLeft = Math.min(0, w - this.nudgeText.box.width)
      const off = block(l, nLeft, w, st.pad * D, 0, w)
      const R = w + off // ujung kanan garis bawah (x unit label relatif siku)
      this.date.place(at(_p, l, R, 0.05), q, s)
      this.button.place(at(_p, l, R - bw / 2, fTop - bh / 2 - (capH * B) / 2), q, s)
      this.nudgeText.place(at(_p, l, R, nBase), q, s)
      l.path = [l.anchor.clone(), l.elbow.clone(), at(new Vector3(), l, off < 0 ? off : w, 0)]
      plate(this.plates.date, l, nLeft * nk + off, R, bottom, top, D, off < 0)

      // bingkai tombol: napas pelan (cos, mulai dari redup), sorot = penuh
      const breath = reduced ? 0.6 : 0.5 - 0.5 * Math.cos((time * Math.PI * 2) / BUTTON.breathe)
      const base = BUTTON.frameLo + (BUTTON.frameHi - BUTTON.frameLo) * breath
      const show = l.show1
      this.frame.material.opacity = show * (base + (1 - base) * hot)
      this.frameShadow.material.opacity = show * LABEL_STYLE.shadowAlpha * (1 - 0.5 * hot)
      const corners = [[R - bw, fTop], [R, fTop], [R, fBot], [R - bw, fBot]]
      this._writeFrame(corners.map(([x, y]) => at(new Vector3(), l, x, y)), l.line)
      // isi putih + teks tinta saat hot
      at(_c, l, R - bw / 2, fTop - bh / 2)
      this.fill.set(_c, q, bw * s, bh * s, 0.06 * B * s, 0.06 * B * s, BUTTON.fillAlpha * hot * show)
      this.button.main.uniforms.uColor.value.copy(_white).lerp(_ink, hot)
      this.button.shadow.uniforms.uOpacity.value = LABEL_STYLE.shadowAlpha * (1 - hot)

      // kotak klik tombol di NDC, aktif sesudah tombol hampir selesai muncul
      if (show > 0.6) {
        let x0 = Infinity
        let y0 = Infinity
        let x1 = -Infinity
        let y1 = -Infinity
        for (const [x, y] of corners) {
          at(_q, l, x, y).project(camera)
          x0 = Math.min(x0, _q.x)
          x1 = Math.max(x1, _q.x)
          y0 = Math.min(y0, _q.y)
          y1 = Math.max(y1, _q.y)
        }
        this.buttonRect = { x0, y0, x1, y1 }
      }
    }
    // TEMP: siku = kiri tengah tulisan TEMP, angka rata kanan di kolom kanan, garis 1 ruas
    {
      const l = this.labels[2]
      const T = LABELS.temp
      const cap = capH * T
      const lh = this.tempValue.layout.lineHeight * T
      const colRight = this.tempLabel.box.width + 0.03 + 0.42
      const off = block(l, 0, colRight, st.pad * T, 0, colRight + 0.03)
      this.tempLabel.place(at(_p, l, 0.03 + off, -cap * 0.5), q, s)
      this.tempValue.place(at(_p, l, colRight + off, -cap * 0.5), q, s)
      l.path = [l.anchor.clone(), l.elbow.clone()]
      plate(this.plates.temp, l, off, colRight + off, -cap * 0.5 - lh, cap * 0.5, T, off < 0)
    }
    this._writeLines()
  }

  // bingkai digambar keliling dari sudut kiri atas sesuai progres garis label tanggal
  _writeFrame(pts, k) {
    const pos = this.frame.geometry.attributes.position
    let n = 0
    const sides = Math.round(clamp(k, 0, 1) * 4)
    for (let i = 0; i < sides; i++) {
      const a = pts[i]
      const b2 = pts[(i + 1) % 4]
      pos.setXYZ(n++, a.x, a.y, a.z)
      pos.setXYZ(n++, b2.x, b2.y, b2.z)
    }
    pos.needsUpdate = true
    this.frame.geometry.setDrawRange(0, n)
  }

  // garis penunjuk digambar sepanjang jalurnya sesuai progres line (0..1), urut dari titik kristal
  _writeLines() {
    const pos = this.lines.geometry.attributes.position
    let n = 0
    for (const l of this.labels) {
      if (l.line <= 0) continue
      const pts = l.path
      let total = 0
      for (let i = 1; i < pts.length; i++) total += pts[i].distanceTo(pts[i - 1])
      let left = total * l.line
      for (let i = 1; i < pts.length && left > 0; i++) {
        const seg = pts[i].distanceTo(pts[i - 1])
        const k = Math.min(1, left / Math.max(seg, 1e-6))
        _p.lerpVectors(pts[i - 1], pts[i], k)
        pos.setXYZ(n++, pts[i - 1].x, pts[i - 1].y, pts[i - 1].z)
        pos.setXYZ(n++, _p.x, _p.y, _p.z)
        left -= seg
      }
    }
    pos.needsUpdate = true
    this.lines.geometry.setDrawRange(0, n)
  }

  dispose() {
    for (const t of this.texts) t.dispose()
    for (const p of [...Object.values(this.plates), this.fill]) p.dispose()
    this.lines.geometry.dispose()
    this.lines.material.dispose()
    this.lineShadow.material.dispose()
    this.frame.geometry.dispose()
    this.frame.material.dispose()
    this.frameShadow.material.dispose()
  }
}
