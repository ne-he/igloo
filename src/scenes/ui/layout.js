// Tata letak scene UI dalam piksel CSS, origin kiri atas, y ke bawah (logika murni, dites angka).
// Breakpoint + margin + lebar logo: forensik igloo (blueprint 5.6, arsitektur 2.6).
// Ukuran teks dan jarak antar blok: DIUKUR dari ref 01 (800x600 hasil kecilkan tangkapan 1024x768,
// jadi breakpoint "small"). Ukuran teks desktop dan mobile belum ada rujukan, nilainya tebakan [?].

// Sisi terpendek area klik di layar sentuh (px CSS). Audit responsif 13 Nov 2026: Sound, indeks, tombol atas,
// chip link, dan tombol OPEN di ponsel cuma 24 sampai 35 px tingginya, susah kena jari.
export const TOUCH_TARGET = 44

export const UI_BREAKPOINTS = {
  desktop: { left: 125, top: 90, logo: 200, text: 14 }, // text [?]
  small: { left: 50, top: 45, logo: 160, text: 12.8 },
  mobile: { left: 25, top: 25, logo: 140, text: 12 }, // text [?]
}

// Rasio dalam em ukuran teks masing-masing blok (diukur di ref 01, breakpoint small).
export const UI_RATIOS = {
  logoAspect: 0.21, // tinggi kotak logo = 0.21 x lebar (igloo)
  logoLetterSpacing: 0.05,
  copyrightScale: 1.07, // teks copyright sedikit lebih besar dari teks bawah
  copyrightLineHeight: 1.22,
  titleBelowLogo: 1.88, // baseline "// Copyright" di bawah tepi bawah kotak logo
  textBelowTitle: 2.24, // baseline baris pertama "NEMI." di bawah baseline judul
  hintLineHeight: 1.05,
  hintMaxWidth: 9.5, // em, bikin "Scroll down to / discover." pecah 2 baris seperti ref
  soundAboveBottom: 0.73, // baseline "Sound" = tinggi - (margin + 0.73 em)
  hintAboveSound: 2.6, // baseline baris terakhir hint di atas baseline "Sound" (hint lama, tidak dirender lagi)
  // Cue scroll tengah bawah (Okt 2026, ScrollCue.js): teks di atas, garis vertikal di bawahnya. Ujung bawah garis
  // sejajar baseline "Sound" supaya baris bawah UI tetap satu garis. Angka sendiri, bukan dari igloo.
  cueTrack: 3.6, // em, panjang garis
  cueTrackCompact: 3.6, // em, ponsel: panjang garis (ujung bawahnya berhenti di atas baris Sound, lihat cueRowClear)
  cueRowClear: 1.4, // em, ponsel: ujung bawah garis di atas puncak huruf baris Sound / indeks
  cueGap: 1.15, // em, baseline teks ke ujung atas garis
  cueLetterSpacing: 0.16, // em
  // Indeks section kanan bawah (SectionIndex.js), cermin blok Sound: baris terakhir sejajar baseline "Sound".
  // Kanan atas sudah dipakai penghitung fakta igloo, tengah kanan bertabrakan dengan panah ruang link di 1024.
  // Ponsel (13 Nov 2026): nomor saja dalam SATU BARIS sejajar Sound ("- 01  02  03"). Versi bertumpuk lama
  // memakan 3 baris di atas Sound, menabrak blok ruang link, dan barisnya cuma 31 px (kurang untuk jari).
  indexScale: 0.92, // ukuran teks indeks relatif teks UI
  indexLineHeight: 2.1, // em, jarak baris
  indexLineHeightCompact: 2.8, // em, jarak baris di ponsel
  indexLetterSpacing: 0.06, // em
  indexMarkerGap: 0.75, // em, jarak garis penanda ke teks
  indexMarkerLength: 1.7, // em, panjang garis penanda item aktif
  indexRowGap: 1.1, // em, ponsel: jarak nomor ke garis penanda nomor berikutnya
}

/** small = lebar < 1600 atau tinggi < 800, mobile = lebar < 640 atau tinggi < 640. */
export function uiBreakpoint(width, height) {
  if (width < 640 || height < 640) return 'mobile'
  if (width < 1600 || height < 800) return 'small'
  return 'desktop'
}

/**
 * Zona baris UI atas yang tidak boleh ditutup label 3D (logo kiri atas, tombol cepat kanan atas), px CSS y ke bawah.
 * Lebar tombol cepat diperkirakan 15 em teks UI ("[ CV ]" + jarak + "[ QUICK VIEW ]" + pelat), cukup longgar.
 * Dipakai label kristal (Labels.js): di ponsel landscape judul PROJECTS sempat naik menutup logo.
 */
export function uiTopZones(width, height) {
  const B = UI_BREAKPOINTS[uiBreakpoint(width, height)]
  // +14: kotak baris teks wordmark sedikit lebih tinggi dari kotak logo 0.21 x lebar
  const y1 = B.top + B.logo * UI_RATIOS.logoAspect + 14
  return [
    { x0: 0, x1: B.left + B.logo + 8, y0: 0, y1 },
    { x0: width - B.left - 15 * B.text - 8, x1: width, y0: 0, y1 },
  ]
}

/**
 * @param {number} width lebar layar CSS px
 * @param {number} height tinggi layar CSS px
 * @param {object} m ukuran teks dari font
 * @param {number} m.logoWidthEm lebar layout wordmark dalam em (sudah termasuk letter spacing)
 * @param {number} m.capHeight cap height font (em)
 * @param {number} [m.hintLines=2] jumlah baris teks hint
 * @param {boolean} [m.touch=false] layar sentuh (pointer: coarse): area klik minimal TOUCH_TARGET
 * @returns posisi tiap blok: x kiri, baseline baris pertama (y ke bawah), size px
 */
export function computeUILayout(width, height, { logoWidthEm, capHeight, hintLines = 2, touch = false }) {
  const bp = uiBreakpoint(width, height)
  const B = UI_BREAKPOINTS[bp]
  const R = UI_RATIOS
  const fs = B.text
  const cs = fs * R.copyrightScale

  // Logo: wordmark dimasukkan (contain) ke kotak lebar B.logo x 0.21, dipusatkan vertikal.
  const box = { x: B.left, y: B.top, width: B.logo, height: B.logo * R.logoAspect }
  const logoSize = Math.min(box.width / logoWidthEm, box.height / capHeight)
  const logoBaseline = box.y + (box.height + capHeight * logoSize) / 2

  const titleBaseline = box.y + box.height + R.titleBelowLogo * cs
  const textBaseline = titleBaseline + R.textBelowTitle * cs

  const soundBaseline = height - (B.top + R.soundAboveBottom * fs)
  const hintLastBaseline = soundBaseline - R.hintAboveSound * fs
  const hintBaseline = hintLastBaseline - (hintLines - 1) * R.hintLineHeight * fs

  // cue: garis dari trackTop ke baseline Sound, teks di tengah horizontal di atas garis. Ponsel: garis berhenti di
  // atas baris Sound, karena indeks satu baris di kanan bawah bisa mendekati garis di layar 360 px.
  const compact = bp === 'mobile'
  const trackBottom = compact ? soundBaseline - (capHeight + R.cueRowClear) * fs : soundBaseline
  const trackTop = trackBottom - (compact ? R.cueTrackCompact : R.cueTrack) * fs
  const cueBaseline = trackTop - R.cueGap * fs

  // indeks: desktop daftar vertikal rata kiri yang tepi kanannya di margin kanan, baris terakhir di baseline Sound.
  // Ponsel: satu baris nomor di baseline Sound. Layar sentuh: tinggi baris / area klik minimal TOUCH_TARGET.
  const indexSize = fs * R.indexScale
  const minHit = touch ? TOUCH_TARGET : 0

  return {
    bp,
    width,
    height,
    logoBox: box,
    logo: { x: B.left, baseline: logoBaseline, size: logoSize, letterSpacing: R.logoLetterSpacing },
    copyrightTitle: { x: B.left, baseline: titleBaseline, size: cs, lineHeight: R.copyrightLineHeight },
    copyrightText: { x: B.left, baseline: textBaseline, size: cs, lineHeight: R.copyrightLineHeight },
    hint: { x: B.left, baseline: hintBaseline, size: fs, lineHeight: R.hintLineHeight, maxWidth: R.hintMaxWidth * fs },
    sound: { x: B.left, baseline: soundBaseline, size: fs, lineHeight: R.hintLineHeight },
    cue: { x: width / 2, baseline: cueBaseline, size: fs, letterSpacing: R.cueLetterSpacing, trackTop, trackBottom },
    index: {
      right: width - B.left,
      bottom: soundBaseline, // baseline baris terakhir
      size: indexSize,
      lineHeight: compact ? R.indexLineHeightCompact : Math.max(R.indexLineHeight, minHit / indexSize),
      letterSpacing: R.indexLetterSpacing,
      compact,
      row: compact, // satu baris horizontal
      minHit,
    },
    touch,
  }
}

/**
 * Posisi item indeks section (piksel CSS, y ke bawah). Logika murni supaya bisa dites.
 * Blok rata kiri, tepi kanan item terlebar di I.right, baris terakhir di I.bottom. Penanda item aktif = garis
 * pendek di kiri teks setinggi tengah huruf kapital.
 * I.row (ponsel): semua item satu baris di I.bottom, item terakhir rata kanan di I.right, tiap item didahului
 * ruang garis penanda. Area klik per item = kolom bersambung tanpa celah, tinggi minimal I.minHit.
 * @param {object} I hasil computeUILayout().index
 * @param {number[]} widths lebar layout teks tiap item (px, ukuran I.size)
 * @param {number} capHeight cap height font (em)
 * @returns {{items: {x:number, baseline:number, width:number}[], markers: {x0:number, x1:number, y:number}[],
 *   hits: {x0:number, y0:number, x1:number, y1:number}[], box: {x0:number, y0:number, x1:number, y1:number}}}
 */
export function layoutSectionIndex(I, widths, capHeight) {
  const R = UI_RATIOS
  const s = I.size
  const cap = capHeight * s
  const lh = I.lineHeight * s
  const n = widths.length
  if (I.row) return layoutIndexRow(I, widths, cap)
  const x0 = I.right - Math.max(0, ...widths)
  const mx1 = x0 - R.indexMarkerGap * s
  const mx0 = mx1 - R.indexMarkerLength * s
  const items = []
  const markers = []
  const hits = []
  for (let i = 0; i < n; i++) {
    const b = I.bottom - (n - 1 - i) * lh
    items[i] = { x: x0, baseline: b, width: widths[i] }
    markers[i] = { x0: mx0, x1: mx1, y: b - cap / 2 }
    // baris bersambung tanpa celah (klik di antara dua item tetap kena salah satunya), sedikit lebih lebar
    // dari teks di kiri (penanda) dan kanan
    hits[i] = { x0: mx0 - 6, y0: b - cap / 2 - lh / 2, x1: I.right + 10, y1: b - cap / 2 + lh / 2 }
  }
  return withBox(items, markers, hits)
}

/** Indeks satu baris (ponsel), lihat layoutSectionIndex. */
function layoutIndexRow(I, widths, cap) {
  const R = UI_RATIOS
  const s = I.size
  const n = widths.length
  const mark = (R.indexMarkerGap + R.indexMarkerLength) * s
  const gap = R.indexRowGap * s
  const b = I.bottom
  const cy = b - cap / 2
  const h = Math.max(I.lineHeight * s, I.minHit || 0)
  const items = []
  const markers = []
  let x = I.right
  for (let i = n - 1; i >= 0; i--) {
    x -= widths[i]
    items[i] = { x, baseline: b, width: widths[i] }
    const mx1 = x - R.indexMarkerGap * s
    markers[i] = { x0: mx1 - R.indexMarkerLength * s, x1: mx1, y: cy }
    x -= mark + gap
  }
  // batas kolom klik di tengah celah antara ujung item kiri dan garis penanda item kanannya
  const hits = items.map((it, i) => ({
    x0: i === 0 ? markers[0].x0 - 6 : (items[i - 1].x + items[i - 1].width + markers[i].x0) / 2,
    y0: cy - h / 2,
    x1: i === n - 1 ? I.right + 10 : (it.x + it.width + markers[i + 1].x0) / 2,
    y1: cy + h / 2,
  }))
  return withBox(items, markers, hits)
}

function withBox(items, markers, hits) {
  const box = {
    x0: Math.min(...hits.map((h) => h.x0)),
    y0: Math.min(...hits.map((h) => h.y0)),
    x1: Math.max(...hits.map((h) => h.x1)),
    y1: Math.max(...hits.map((h) => h.y1)),
  }
  return { items, markers, hits, box }
}
