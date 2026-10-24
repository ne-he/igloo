// Tata letak scene UI dalam piksel CSS, origin kiri atas, y ke bawah (logika murni, dites angka).
// Breakpoint + margin + lebar logo: forensik igloo (blueprint 5.6, arsitektur 2.6).
// Ukuran teks dan jarak antar blok: DIUKUR dari ref 01 (800x600 hasil kecilkan tangkapan 1024x768,
// jadi breakpoint "small"). Ukuran teks desktop dan mobile belum ada rujukan, nilainya tebakan [?].

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
  cueTrackCompact: 6.4, // em, ponsel: garis lebih panjang supaya pelat teks cue di atas baris teratas indeks kanan bawah
  cueGap: 1.15, // em, baseline teks ke ujung atas garis
  cueLetterSpacing: 0.16, // em
  // Indeks section kanan bawah (SectionIndex.js), cermin blok Sound: baris terakhir sejajar baseline "Sound".
  // Kanan atas sudah dipakai penghitung fakta igloo, tengah kanan bertabrakan dengan panah ruang link di 1024.
  // Ponsel: nomor saja ("01 02 03" bertumpuk), baris lebih renggang supaya enak di-tap.
  indexScale: 0.92, // ukuran teks indeks relatif teks UI
  indexLineHeight: 2.1, // em, jarak baris
  indexLineHeightCompact: 2.8, // em, jarak baris di ponsel
  indexLetterSpacing: 0.06, // em
  indexMarkerGap: 0.75, // em, jarak garis penanda ke teks
  indexMarkerLength: 1.7, // em, panjang garis penanda item aktif
}

/** small = lebar < 1600 atau tinggi < 800, mobile = lebar < 640 atau tinggi < 640. */
export function uiBreakpoint(width, height) {
  if (width < 640 || height < 640) return 'mobile'
  if (width < 1600 || height < 800) return 'small'
  return 'desktop'
}

/**
 * @param {number} width lebar layar CSS px
 * @param {number} height tinggi layar CSS px
 * @param {object} m ukuran teks dari font
 * @param {number} m.logoWidthEm lebar layout wordmark dalam em (sudah termasuk letter spacing)
 * @param {number} m.capHeight cap height font (em)
 * @param {number} [m.hintLines=2] jumlah baris teks hint
 * @returns posisi tiap blok: x kiri, baseline baris pertama (y ke bawah), size px
 */
export function computeUILayout(width, height, { logoWidthEm, capHeight, hintLines = 2 }) {
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

  // cue: garis dari trackTop ke baseline Sound, teks di tengah horizontal di atas garis
  const trackBottom = soundBaseline
  const trackTop = trackBottom - (bp === 'mobile' ? R.cueTrackCompact : R.cueTrack) * fs
  const cueBaseline = trackTop - R.cueGap * fs

  // indeks: daftar vertikal rata kiri yang tepi kanannya di margin kanan, baris terakhir di baseline Sound
  const compact = bp === 'mobile'

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
      size: fs * R.indexScale,
      lineHeight: compact ? R.indexLineHeightCompact : R.indexLineHeight,
      letterSpacing: R.indexLetterSpacing,
      compact,
    },
  }
}

/**
 * Posisi item indeks section (piksel CSS, y ke bawah). Logika murni supaya bisa dites.
 * Blok rata kiri, tepi kanan item terlebar di I.right, baris terakhir di I.bottom. Penanda item aktif = garis
 * pendek di kiri teks setinggi tengah huruf kapital.
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
  const box = {
    x0: Math.min(...hits.map((h) => h.x0)),
    y0: Math.min(...hits.map((h) => h.y0)),
    x1: Math.max(...hits.map((h) => h.x1)),
    y1: Math.max(...hits.map((h) => h.y1)),
  }
  return { items, markers, hits, box }
}
