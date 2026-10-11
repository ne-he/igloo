import { TextureLoader, NoColorSpace, LinearFilter, ClampToEdgeWrapping } from 'three'

// Font MSDF hasil tools/fonts/gen_msdf.mjs (format BMFont JSON + blok metrics).
// Semua angka di sini dalam satuan em (font size 1), y ke atas, relatif ke baseline dan pen.
// Constructor murni (tanpa GPU) supaya bisa dites di node. Tekstur atlas diisi oleh load().

const FALLBACK_CHAR = '?'

export class MsdfFont {
  /**
   * @param {object} data JSON BMFont (pages, chars, info, common, distanceField, kernings, metrics)
   */
  constructor(data) {
    const size = data.info.size
    const m = data.metrics || {}
    this.data = data
    this.emSize = size
    this.atlasWidth = data.common.scaleW
    this.atlasHeight = data.common.scaleH
    this.distanceRange = data.distanceField.distanceRange
    this.lineHeight = m.lineHeight ?? data.common.lineHeight / size // 1.3 untuk Plex Mono
    this.ascender = m.ascender ?? data.common.base / size
    this.descender = m.descender ?? this.ascender - this.lineHeight
    this.capHeight = m.capHeight ?? 0.7
    this.xHeight = m.xHeight ?? 0.5
    const base = data.common.base

    /** @type {Map<number, object>} kode unicode -> glyph */
    this.glyphs = new Map()
    /** Glyph yang punya bitmap, urut kode. Indeksnya dipakai tabel scramble di shader. */
    this.table = []
    const sorted = [...data.chars].sort((a, b) => a.id - b.id)
    for (const c of sorted) {
      const visible = c.width > 0 && c.height > 0
      const g = {
        id: c.id,
        char: c.char ?? String.fromCodePoint(c.id),
        advance: c.xadvance / size,
        visible,
        // plane bounds (em), y ke atas relatif baseline
        left: c.xoffset / size,
        right: (c.xoffset + c.width) / size,
        top: (base - c.yoffset) / size,
        bottom: (base - c.yoffset - c.height) / size,
        // rect atlas (uv), tekstur flipY = true jadi v dibalik
        u0: c.x / this.atlasWidth,
        v0: 1 - (c.y + c.height) / this.atlasHeight,
        u1: (c.x + c.width) / this.atlasWidth,
        v1: 1 - c.y / this.atlasHeight,
        tableIndex: -1,
      }
      if (visible) {
        g.tableIndex = this.table.length
        this.table.push(g)
      }
      this.glyphs.set(c.id, g)
    }

    /** kerning per pasangan, em. Plex Mono tidak punya (kosong), tetap didukung untuk font lain. */
    this.kernings = new Map()
    for (const k of data.kernings || []) this.kernings.set(pairKey(k.first, k.second), k.amount / size)

    this.fallback = this.glyphs.get(FALLBACK_CHAR.codePointAt(0)) || sorted[0]
    this.texture = null
  }

  /** Glyph untuk kode unicode, fallback '?' kalau tidak ada di atlas. */
  glyph(code) {
    return this.glyphs.get(code) || this.fallback
  }

  has(code) {
    return this.glyphs.has(code)
  }

  kerning(a, b) {
    if (!this.kernings.size) return 0
    return this.kernings.get(pairKey(a, b)) || 0
  }

  /**
   * Muat JSON + PNG atlas. base tanpa ekstensi, mis. '/assets/fonts/plexmono-msdf'.
   * Atlas MSDF = data linear: tanpa sRGB, tanpa mipmap, filter linear (blueprint 8.1).
   */
  static async load(base) {
    const res = await fetch(`${base}.json`)
    if (!res.ok) throw new Error(`font gagal dimuat: ${base}.json (${res.status})`)
    const font = new MsdfFont(await res.json())
    const dir = base.slice(0, base.lastIndexOf('/') + 1)
    const tex = await new TextureLoader().loadAsync(dir + font.data.pages[0])
    tex.colorSpace = NoColorSpace
    tex.generateMipmaps = false
    tex.minFilter = tex.magFilter = LinearFilter
    tex.wrapS = tex.wrapT = ClampToEdgeWrapping
    tex.needsUpdate = true
    font.texture = tex
    return font
  }
}

const pairKey = (a, b) => a * 0x110000 + b
