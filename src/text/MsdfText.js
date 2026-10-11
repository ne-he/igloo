import { Mesh, BufferGeometry, BufferAttribute, Box3, Sphere } from 'three'
import { layoutText } from './layout.js'
import { createTextMaterial } from './textMaterial.js'

// Satu mesh teks MSDF: satu quad per glyph (spasi tidak dapat quad).
// Atribut per glyph (sama di 4 vertex-nya):
//   position  sudut quad glyph asli (dipakai bounds dan kalau scramble mati)
//   uv        sudut 0..1 di dalam quad
//   aUvRect   rect uv glyph di atlas
//   aText     (indeks glyph 0..1, indeks kata 0..1, indeks baris, seed acak)
//   aPen      (pen x, baseline y, indeks tabel glyph, size), dipakai scramble membentuk ulang quad
// setText() menulis ulang buffer yang sama selama kapasitas cukup, alokasi baru hanya kalau teks lebih panjang.

const CORNERS = [0, 0, 1, 0, 1, 1, 0, 1]

export class MsdfText extends Mesh {
  /**
   * @param {import('./MsdfFont.js').MsdfFont} font
   * @param {object} [o] opsi layout (size, lineHeight, letterSpacing, maxWidth, align, seed)
   *   + opsi material (color, opacity, bold, scramble) atau `material` jadi.
   */
  constructor(font, o = {}) {
    const { text = '', material = null, color, opacity, bold, scramble, ...layout } = o
    super(new BufferGeometry(), material || createTextMaterial(font, { color, opacity, bold, scramble }))
    this.font = font
    this.layoutOptions = { size: 1, letterSpacing: 0, maxWidth: Infinity, align: 'left', seed: 1, ...layout }
    this.capacity = 0
    this.glyphCount = 0
    this.text = null
    this.layout = null
    this.setText(text)
  }

  get uniforms() {
    return this.material.uniforms
  }

  /** Ganti teks dan/atau opsi layout. Tidak realokasi kalau jumlah glyph muat di kapasitas lama. */
  setText(text, layoutOptions) {
    if (layoutOptions) Object.assign(this.layoutOptions, layoutOptions)
    else if (text === this.text) return this
    this.text = text
    const lay = layoutText(this.font, text, this.layoutOptions)
    this.layout = lay
    const n = lay.glyphs.length
    if (n > this.capacity || !this.capacity) this._allocate(n)
    this._write(lay)
    this.glyphCount = n
    this.geometry.setDrawRange(0, n * 6)
    this._updateBounds(lay)
    return this
  }

  /** Ubah opsi layout (size, maxWidth, align, ...) lalu layout ulang teks yang sama. */
  relayout(layoutOptions) {
    return this.setText(this.text, layoutOptions || {})
  }

  _allocate(n) {
    // Sisakan ruang sedikit supaya update kecil berikutnya (mis. "Off" ke "On ") tidak realokasi.
    const cap = Math.max(n, Math.ceil(this.capacity * 1.5), 8)
    const g = this.geometry
    g.dispose()
    const v = cap * 4
    g.setAttribute('position', new BufferAttribute(new Float32Array(v * 3), 3))
    g.setAttribute('uv', new BufferAttribute(new Float32Array(v * 2), 2))
    g.setAttribute('aUvRect', new BufferAttribute(new Float32Array(v * 4), 4))
    g.setAttribute('aText', new BufferAttribute(new Float32Array(v * 4), 4))
    g.setAttribute('aPen', new BufferAttribute(new Float32Array(v * 4), 4))
    const index = v > 65535 ? new Uint32Array(cap * 6) : new Uint16Array(cap * 6)
    for (let i = 0; i < cap; i++) {
      const a = i * 4
      index.set([a, a + 1, a + 2, a, a + 2, a + 3], i * 6)
    }
    g.setIndex(new BufferAttribute(index, 1))
    const uv = g.attributes.uv.array
    for (let i = 0; i < cap; i++) uv.set(CORNERS, i * 8)
    this.capacity = cap
  }

  _write(lay) {
    const g = this.geometry
    const pos = g.attributes.position.array
    const rect = g.attributes.aUvRect.array
    const txt = g.attributes.aText.array
    const pen = g.attributes.aPen.array
    const s = lay.size
    lay.glyphs.forEach((q, i) => {
      const gl = q.glyph
      const x0 = q.x + gl.left * s
      const x1 = q.x + gl.right * s
      const y0 = q.y + gl.bottom * s
      const y1 = q.y + gl.top * s
      pos.set([x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0], i * 12)
      for (let c = 0; c < 4; c++) {
        const o = (i * 4 + c) * 4
        rect[o] = gl.u0
        rect[o + 1] = gl.v0
        rect[o + 2] = gl.u1
        rect[o + 3] = gl.v1
        txt[o] = q.index01
        txt[o + 1] = q.word01
        txt[o + 2] = q.line
        txt[o + 3] = q.seed
        pen[o] = q.x
        pen[o + 1] = q.y
        pen[o + 2] = gl.tableIndex
        pen[o + 3] = s
      }
    })
    for (const name of ['position', 'aUvRect', 'aText', 'aPen']) g.attributes[name].needsUpdate = true
    g.attributes.uv.needsUpdate = true
  }

  _updateBounds(lay) {
    const g = this.geometry
    let minX = Infinity
    let maxX = -Infinity
    for (const l of lay.lines) {
      if (!l.width) continue
      minX = Math.min(minX, l.x)
      maxX = Math.max(maxX, l.x + l.width)
    }
    if (minX === Infinity) minX = maxX = 0
    g.boundingBox = g.boundingBox || new Box3()
    g.boundingBox.min.set(minX, lay.bottom, 0)
    g.boundingBox.max.set(maxX, lay.top, 0)
    g.boundingSphere = g.boundingSphere || new Sphere()
    g.boundingBox.getBoundingSphere(g.boundingSphere)
  }

  /** Kotak teks dalam koordinat lokal: {x, y, width, height}, y = tepi atas (ascender baris pertama). */
  get box() {
    const b = this.geometry.boundingBox
    return { x: b.min.x, y: b.max.y, width: b.max.x - b.min.x, height: b.max.y - b.min.y }
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}

