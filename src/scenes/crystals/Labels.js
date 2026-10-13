import { Group, LineSegments, BufferGeometry, BufferAttribute, LineBasicMaterial, Vector3 } from 'three'
import { MsdfText } from '../../text/MsdfText.js'
import { clamp } from '../../engine/math.js'

// Label 3D tiap kristal (skill ref 01 bagian 6.3, ref 02 bagian 6.7). Mesh MSDF di dalam scene (bukan DOM),
// jadi ikut grade, bloom, dan wipe transisi. Tiap label menempel ke satu titik bounding box kristal
// (campuran min/max, ikut rotasi kristal), lalu digeser sepanjang vektor KIRI/ATAS kamera.
// Skala = min(0.8, 0.5 / (tinggiLayar / 1300)), ukuran judul 0.13.
// Label muncul kalau offset y kristal ke kamera ada di jendelanya: reveal uShow1 0.4 s, uShow2 0.75 s,
// garis penunjuk digambar 0.2 s. TEMP = temp + 2 sin(0.05 t + acak): baris 1 Fahrenheit, baris 2 Celsius bertanda.

export const LABELS = { title: 0.13, date: 0.13, temp: 0.105, show1: 0.4, show2: 0.75, line: 0.2, hide: 0.3 }

// f = faktor campuran bbox (0 = min, 1 = max) di ruang lokal kristal, o = geser (kiri, atas) dalam satuan skala,
// win = jendela offset y kristal ke kamera tempat label tampil
const SPECS = {
  title: { f: [0.3, 0.88, 0.85], o: [0.16, 0.3], win: [-1.6, 0.5] },
  date: { f: [0.85, 0.22, 0.8], o: [-0.3, -0.12], win: [-0.6, 1.25] },
  temp: { f: [0.8, 0.85, 0.75], o: [-0.28, 0.12], win: [-1.2, 0.5] },
}

const COLOR = 0xffffff
const UNDERLINE_PAD = 0.06 // unit label (sebelum skala)
const _a = new Vector3()
const _left = new Vector3()
const _up = new Vector3()
const _p = new Vector3()

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

const dateText = (date) => `D ${String(date || '').replaceAll('/', '.')}\nCLICK TO EXPLORE`

/** Satu label: teks + status reveal. */
class Label {
  constructor(key, meshes) {
    this.key = key
    this.spec = SPECS[key]
    this.meshes = meshes
    this.visible = false
    this.show1 = 0
    this.show2 = 0
    this.line = 0
    this.anchor = new Vector3()
    this.elbow = new Vector3()
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
    for (const m of this.meshes) {
      m.uniforms.uShow1.value = this.show1
      m.uniforms.uShow2.value = this.show2
      m.visible = this.show1 > 0
    }
  }
}

export class CrystalLabels extends Group {
  /**
   * @param {import('../../text/MsdfFont.js').MsdfFont} font
   * @param {{title:string, date:string, temp:number}} project
   * @param {import('three').Box3} box bounding box geometri kristal (ruang lokal)
   * @param {number} seed
   */
  constructor(font, project, box, seed = 1) {
    super()
    this.name = 'crystal_labels'
    this.project = project
    this.box = box
    this.rand = ((seed * 9301 + 49297) % 233280) / 233280 * Math.PI * 2 // fase TEMP tetap
    const mk = (text, size, align, s) => {
      const m = new MsdfText(font, { text, size, align, color: COLOR, seed: seed * 10 + s })
      m.renderOrder = 30
      m.frustumCulled = false
      this.add(m)
      return m
    }
    this.title = mk(splitTitle(project.title), LABELS.title, 'left', 1)
    this.date = mk(dateText(project.date), LABELS.date, 'right', 2)
    this.tempLabel = mk('TEMP', LABELS.temp, 'left', 3)
    this.tempValue = mk(formatTemp(project.temp), LABELS.temp, 'right', 4)
    this.labels = [
      new Label('title', [this.title]),
      new Label('date', [this.date]),
      new Label('temp', [this.tempLabel, this.tempValue]),
    ]

    // semua garis penunjuk dalam satu LineSegments, posisi dunia ditulis ulang tiap frame
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(32 * 3), 3))
    this.lines = new LineSegments(geo, new LineBasicMaterial({
      color: COLOR, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false, toneMapped: false,
    }))
    this.lines.renderOrder = 30
    this.lines.frustumCulled = false
    this.add(this.lines)
  }

  /**
   * @param {object} o
   * @param {import('three').Camera} o.camera kamera yang sudah di-update frame ini
   * @param {import('three').Object3D} o.mesh mesh kristal (matrixWorld terbaru)
   * @param {number} o.offsetY posisi y kristal dikurangi posisi y kamera
   * @param {number} o.time detik
   * @param {number} o.dt detik
   * @param {number} o.scale skala label
   * @param {boolean} o.snap lompat langsung ke status akhir (teleport scroll)
   * @param {boolean} o.enabled false = sembunyikan semua (mis. kristal jauh)
   */
  update({ camera, mesh, offsetY, time, dt, scale, snap, enabled }) {
    for (const l of this.labels) {
      const [lo, hi] = l.spec.win
      l.setTarget(enabled && offsetY > lo && offsetY < hi, dt, snap)
    }
    const any = this.labels.some((l) => l.show1 > 0 || l.line > 0)
    this.visible = any
    if (!any) return

    // TEMP berdenyut pelan: ganti teks hanya kalau angkanya berubah (buffer dipakai ulang)
    this.tempValue.setText(formatTemp(this.project.temp + 2 * Math.sin(0.05 * time + this.rand)))

    const e = camera.matrixWorld.elements
    _left.set(-e[0], -e[1], -e[2]).normalize()
    _up.set(e[4], e[5], e[6]).normalize()
    const b = this.box
    for (const l of this.labels) {
      const [fx, fy, fz] = l.spec.f
      _a.set(b.min.x + (b.max.x - b.min.x) * fx, b.min.y + (b.max.y - b.min.y) * fy, b.min.z + (b.max.z - b.min.z) * fz)
      l.anchor.copy(_a).applyMatrix4(mesh.matrixWorld)
      l.elbow.copy(l.anchor).addScaledVector(_left, l.spec.o[0] * scale).addScaledVector(_up, l.spec.o[1] * scale)
    }
    for (const m of [this.title, this.date, this.tempLabel, this.tempValue]) {
      m.quaternion.copy(camera.quaternion)
      m.scale.setScalar(scale)
    }
    const s = scale

    // judul: siku = ujung kanan garis bawah, teks rata kiri di atas garis bawah, garis: kristal -> siku -> kiri
    {
      const l = this.labels[0]
      const w = this.title.box.width + UNDERLINE_PAD
      const lines = this.title.layout.lineCount
      const lh = this.title.layout.lineHeight * LABELS.title
      _p.copy(l.elbow).addScaledVector(_left, w * s)
      this.title.position.copy(_p).addScaledVector(_up, (0.05 + (lines - 1) * lh) * s)
      l.path = [l.anchor.clone(), l.elbow.clone(), _p.clone()]
    }
    // tanggal: siku = ujung kiri garis bawah, teks rata kanan, garis: kristal -> siku -> kanan
    {
      const l = this.labels[1]
      const w = this.date.box.width + UNDERLINE_PAD
      const lh = this.date.layout.lineHeight * LABELS.date
      _p.copy(l.elbow).addScaledVector(_left, -w * s)
      this.date.position.copy(_p).addScaledVector(_up, (0.05 + lh) * s)
      l.path = [l.anchor.clone(), l.elbow.clone(), _p.clone()]
    }
    // TEMP: siku = kiri tengah tulisan TEMP, angka rata kanan di kolom kanan, garis 1 ruas
    {
      const l = this.labels[2]
      const capH = this.tempLabel.font.capHeight * LABELS.temp
      this.tempLabel.position.copy(l.elbow).addScaledVector(_left, -0.03 * s).addScaledVector(_up, -capH * 0.5 * s)
      const colRight = this.tempLabel.box.width + 0.03 + 0.42
      this.tempValue.position.copy(l.elbow).addScaledVector(_left, -colRight * s).addScaledVector(_up, -capH * 0.5 * s)
      l.path = [l.anchor.clone(), l.elbow.clone()]
    }
    this._writeLines()
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
    for (const m of [this.title, this.date, this.tempLabel, this.tempValue]) m.dispose()
    this.lines.geometry.dispose()
    this.lines.material.dispose()
  }
}
