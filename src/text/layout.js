// Layout teks MSDF, logika murni (tanpa three) supaya bisa dites angka.
// Pengganti msdfworker igloo: tiap glyph dapat indeks glyph ternormalisasi, indeks kata
// ternormalisasi, indeks baris, dan seed acak (blueprint 5.6).
//
// Konvensi koordinat: satuan = satuan `size` (px di scene UI, unit dunia di scene 3D), y ke atas.
// Baseline baris pertama di y = 0, baris ke-i di y = -i * lineHeight * size.
// x = 0 adalah jangkar: align left mulai dari 0, right berakhir di 0, center berpusat di 0.

const SPACE = 32
const TAB_SPACES = 2

/** PRNG kecil deterministik (mulberry32), supaya seed glyph sama di tiap screenshot. */
export function mulberry32(a) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const isSpace = (code) => code === SPACE

/**
 * @param {import('./MsdfFont.js').MsdfFont} font
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.size=1] tinggi em dalam satuan output
 * @param {number} [opts.lineHeight] kelipatan em, default metrik font (1.3)
 * @param {number} [opts.letterSpacing=0] tambahan jarak antar huruf, em
 * @param {number} [opts.maxWidth=Infinity] lebar maksimum baris, satuan output (wrap per kata)
 * @param {'left'|'center'|'right'} [opts.align='left']
 * @param {number} [opts.seed=1] seed PRNG untuk atribut acak per glyph
 */
export function layoutText(font, text, opts = {}) {
  const size = opts.size ?? 1
  const lineHeight = opts.lineHeight ?? font.lineHeight
  const spacing = (opts.letterSpacing ?? 0) * size
  const maxWidth = opts.maxWidth ?? Infinity
  const align = opts.align ?? 'left'

  // 1. Pecah jadi paragraf (\n), lalu token kata/spasi. Tab = 2 spasi.
  const paragraphs = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')

  // Lebar maju satu karakter (advance + spasi huruf + kerning ke karakter sebelumnya).
  const adv = (code, prev) => (font.glyph(code).advance + (prev != null ? font.kerning(prev, code) : 0)) * size + spacing

  /** @type {{codes:number[], words:number[]}[]} */
  const lines = []
  for (const para of paragraphs) {
    const codes = []
    for (const ch of para) {
      const c = ch.codePointAt(0)
      if (c === 9) for (let i = 0; i < TAB_SPACES; i++) codes.push(SPACE)
      else codes.push(c)
    }
    // token: rangkaian non-spasi (kata) atau spasi
    const tokens = []
    let i = 0
    while (i < codes.length) {
      const sp = isSpace(codes[i])
      let j = i
      while (j < codes.length && isSpace(codes[j]) === sp) j++
      tokens.push({ space: sp, codes: codes.slice(i, j) })
      i = j
    }
    let line = []
    let lineW = 0 // lebar termasuk spasi huruf ekor
    let wrapped = false // baris sekarang lahir dari wrap (bukan awal paragraf)
    const last = () => (line.length ? line[line.length - 1] : null)
    const push = (c) => {
      lineW += adv(c, last())
      line.push(c)
    }
    const flush = () => {
      lines.push(trimTrailingSpaces(line))
      line = []
      lineW = 0
      wrapped = true
    }
    for (const tok of tokens) {
      if (tok.space) {
        // spasi di awal baris hasil wrap dibuang, spasi di awal paragraf dipertahankan
        if (!(wrapped && !line.length)) tok.codes.forEach(push)
        continue
      }
      if (line.some((c) => !isSpace(c)) && lineW + measure(tok.codes, last(), adv) - spacing > maxWidth) flush()
      for (const c of tok.codes) {
        // kata yang lebih panjang dari maxWidth dipotong per huruf
        if (line.length && lineW + adv(c, last()) - spacing > maxWidth) flush()
        push(c)
      }
    }
    lines.push(trimTrailingSpaces(line))
  }

  // 2. Posisi glyph per baris + jangkar align.
  const glyphs = []
  let wordCount = 0
  let maxLineW = 0
  const lineInfo = []
  for (let li = 0; li < lines.length; li++) {
    const { codes } = lines[li]
    let w = 0
    let prev = null
    const pens = []
    for (const c of codes) {
      if (prev != null) w += font.kerning(prev, c) * size
      pens.push(w)
      w += font.glyph(c).advance * size + spacing
      prev = c
    }
    if (codes.length) w -= spacing // spasi huruf ekor tidak dihitung
    const ox = align === 'right' ? -w : align === 'center' ? -w / 2 : 0
    const y = -li * lineHeight * size
    lineInfo.push({ width: w, x: ox, y })
    maxLineW = Math.max(maxLineW, w)
    let inWord = false
    for (let k = 0; k < codes.length; k++) {
      const c = codes[k]
      if (isSpace(c)) {
        inWord = false
        continue
      }
      if (!inWord) {
        wordCount++
        inWord = true
      }
      const g = font.glyph(c)
      if (!g.visible) continue
      glyphs.push({ glyph: g, code: c, x: ox + pens[k], y, line: li, word: wordCount - 1 })
    }
  }

  // 3. Normalisasi indeks + seed acak.
  const rand = mulberry32((opts.seed ?? 1) * 7919 + 17)
  const n = glyphs.length
  for (let i = 0; i < n; i++) {
    const g = glyphs[i]
    g.index = i
    g.index01 = n > 1 ? i / (n - 1) : 0
    g.word01 = wordCount > 1 ? g.word / (wordCount - 1) : 0
    g.seed = rand()
  }

  const lh = lineHeight * size
  return {
    glyphs,
    lines: lineInfo,
    lineCount: lines.length,
    wordCount,
    width: maxLineW,
    // tinggi kotak: dari ascender baris pertama sampai descender baris terakhir
    top: font.ascender * size,
    bottom: -(lines.length - 1) * lh + font.descender * size,
    size,
    lineHeight,
  }
}

function measure(codes, prev, adv) {
  let w = 0
  let p = prev
  for (const c of codes) {
    w += adv(c, p)
    p = c
  }
  return w
}

// Spasi ekor dibuang dari baris (tidak ikut lebar dan align).
function trimTrailingSpaces(line) {
  let end = line.length
  while (end > 0 && isSpace(line[end - 1])) end--
  return { codes: line.slice(0, end) }
}
