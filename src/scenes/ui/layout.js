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
  hintAboveSound: 2.6, // baseline baris terakhir hint di atas baseline "Sound"
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
  }
}
