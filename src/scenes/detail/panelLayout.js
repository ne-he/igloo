import { layoutText } from '../../text/layout.js'

// Tata letak panel teks detail proyek (logika murni, tanpa three, dites di tests/detail_panel.test.js).
// Semua angka piksel CSS, origin kiri atas kolom, y KE BAWAH (DetailPanel membalik tanda saat memasang mesh).
//
// Review pengunjung asli Okt 2026 (banyak yang bukan orang IT): teks panel lama terlalu kecil dan terbaca seperti
// esai. Format baru dari content.js: heading (satu kata besar) + summary (satu kalimat) + blocks
// ({ label, lines }). Jadi panel = judul halaman besar, kalimat pembuka lebih besar, lalu blok-blok pendek:
// label kecil kapital dengan garis tipis di atasnya, tiap baris jadi butir sendiri dengan penanda kotak kecil.
// Kolom dibatasi sekitar 60 huruf mono supaya enak dibaca, area scroll tetap rumus tepi igloo (65 / 130 px).

export const PANEL = {
  margin: 65, // tepi atas/bawah area scroll = 2 x 65, fade di 65..130 (igloo)
  // layar pendek (ponsel landscape 390 px): margin ikut tinggi, kalau tetap 65 area baca penuh cuma 130 px.
  // Batas bawah 40 menjaga awal fade tetap di bawah logo / tombol Close (tepi bawahnya sekitar 57 px).
  marginShort: 0.11, // kelipatan tinggi layar
  marginMin: 40,
  gutter: 24, // px minimum kiri/kanan kolom
  maxWidth: 640, // px, sekitar 60 huruf mono per baris di 17.5 px
  scrollLerp: 0.1,
  // ukuran teks per lebar layar (px CSS): ponsel < 640, kecil < 1280, lebar sisanya
  sizes: {
    phone: { heading: 46, lead: 18.5, body: 15.5, label: 12.5, chip: 14 },
    small: { heading: 64, lead: 21, body: 17.5, label: 13, chip: 15 },
    wide: { heading: 76, lead: 23, body: 18.5, label: 13.5, chip: 15.5 },
  },
  shortH: 640, // layar lebih pendek dari ini: kata besar ikut mengecil (min 0.7x)
  // spasi huruf (em masing-masing teks)
  headingSpacing: 0.02,
  labelSpacing: 0.14,
  // tinggi baris (kelipatan em)
  leadLineHeight: 1.45,
  bodyLineHeight: 1.5,
  labelLineHeight: 1.5, // label panjang (ponsel) pecah per kata, butir ikut turun
  // jarak vertikal, kelipatan em teks yang disebut
  leadBelowHeading: 0.55, // em heading, ditambah 1 em lead: baseline heading ke baseline lead
  ruleBelowLead: 2.2, // em body, baseline baris terakhir lead ke garis blok pertama
  labelBelowRule: 1.6, // em label (ditambah cap height): garis ke baseline label
  itemsBelowLabel: 2.05, // em body: baseline label ke baseline butir pertama
  itemGap: 0.6, // em body, tambahan jarak antar butir
  ruleBelowItems: 1.7, // em body: baseline baris terakhir butir ke garis blok berikutnya
  chipsBelowLabel: 2.3, // em chip: baseline label LINKS ke baseline baris chip pertama
  chipRow: 2.5, // em chip, jarak baris chip kalau dibungkus
  chipGap: 1.6, // em chip, jarak antar chip
  arrowGap: 0.55, // em chip, label chip ke panah
  arrowSize: 0.62, // em chip
  bottomPad: 1.2, // em chip, ruang di bawah baris chip terakhir
  chipHit: 44, // px, tinggi minimal kotak klik chip (jari), jarak baris chip ikut supaya kotak tidak bertumpuk
  // butir: penanda kotak di kiri, teks menjorok
  indent: 1.35, // em body
  marker: 0.32, // em body, sisi kotak
  linksLabel: 'LINKS',
  // jalur baca: pelat gelap lembut diam di belakang kolom (tidak ikut scroll) supaya teks tetap terbaca saat
  // lewat di atas kilau caustics objek. Warna = gelap latar detail, objek tetap terlihat redup di baliknya.
  lane: { pad: 36, soft: 72, alpha: 0.5, color: '#09121f' },
  // reveal blok per blok: uShow1 0.4 s + uShow2 0.75 s per mesh (gaya igloo), jeda antar blok pendek
  revealHeading: 0,
  revealLead: 0.12,
  revealBlocks: 0.22, // detik, blok pertama mulai
  revealStagger: 0.07, // detik antar blok
  revealItem: 0.025, // detik antar butir di dalam blok
}

/** Margin area scroll (px): 65 seperti igloo, lebih kecil di layar pendek. */
export function panelMargin(height) {
  return Math.round(Math.min(PANEL.margin, Math.max(PANEL.marginMin, height * PANEL.marginShort)))
}

/** Jenis ukuran panel dari lebar layar. */
export function panelSizeKey(width) {
  if (width < 640) return 'phone'
  if (width < 1280) return 'small'
  return 'wide'
}

/** Ukuran teks panel (px CSS) untuk layar ini. */
export function panelSizes(width, height) {
  const s = { ...PANEL.sizes[panelSizeKey(width)] }
  if (height < PANEL.shortH) s.heading = Math.round(s.heading * Math.max(0.7, height / PANEL.shortH))
  return s
}

/** Teks label chip link. */
export const chipText = (link) => `[${link.label}]`

/**
 * @param {import('../../text/MsdfFont.js').MsdfFont} font
 * @param {{heading?:string, title?:string, summary?:string, blocks?:{label:string, lines:string[]}[],
 *   links?:{label:string, url:string}[]}} project
 * @param {number} width lebar layar (px CSS)
 * @param {number} height tinggi layar (px CSS)
 * @returns posisi semua elemen panel (y ke bawah dari tepi atas layar, sebelum scroll), lebar kolom, scrollMax
 */
export function layoutPanel(font, project, width, height) {
  const P = PANEL
  const sz = panelSizes(width, height)
  const capH = font.capHeight
  const colW = Math.max(120, Math.min(width - 2 * P.gutter, P.maxWidth))
  const colX = Math.round((width - colW) / 2)
  const margin = panelMargin(height)
  const top = 2 * margin
  const measure = (text, o) => layoutText(font, text, o)

  // judul halaman: kata besar (dipecah per kata kalau kolom terlalu sempit)
  const headingText = project.heading || project.title || ''
  const hOpts = { size: sz.heading, letterSpacing: P.headingSpacing, maxWidth: colW, lineHeight: 1.1 }
  const hLay = measure(headingText, hOpts)
  let y = top + capH * sz.heading
  const heading = { text: headingText, x: 0, y, ...hOpts, lines: hLay.lineCount }
  y += (hLay.lineCount - 1) * 1.1 * sz.heading

  // kalimat pembuka
  const lOpts = { size: sz.lead, lineHeight: P.leadLineHeight, maxWidth: colW }
  y += P.leadBelowHeading * sz.heading + sz.lead
  const leadText = project.summary || ''
  const lLay = measure(leadText, lOpts)
  const lead = { text: leadText, x: 0, y, ...lOpts, lines: lLay.lineCount }
  y += (lLay.lineCount - 1) * P.leadLineHeight * sz.lead

  const B = sz.body
  const indent = P.indent * B
  const iOpts = { size: B, lineHeight: P.bodyLineHeight, maxWidth: colW - indent }
  const labelOpts = { size: sz.label, letterSpacing: P.labelSpacing, maxWidth: colW, lineHeight: P.labelLineHeight }
  const m = P.marker * B
  let ruleY = y + P.ruleBelowLead * B
  const blocks = []
  for (const b of project.blocks || []) {
    const labelY = ruleY + P.labelBelowRule * sz.label + capH * sz.label
    const labelLines = measure(b.label || '', labelOpts).lineCount
    let iy = labelY + (labelLines - 1) * P.labelLineHeight * sz.label + P.itemsBelowLabel * B
    const items = []
    for (const line of b.lines || []) {
      const n = measure(line, iOpts).lineCount
      // kotak penanda di tengah tinggi huruf kapital baris pertama
      items.push({ text: line, x: indent, y: iy, ...iOpts, lines: n, marker: { x: 0, y: iy - capH * B * 0.5 - m / 2, size: m } })
      iy += (n - 1) * P.bodyLineHeight * B + (P.bodyLineHeight + P.itemGap) * B
    }
    const lastBase = items.length ? iy - (P.bodyLineHeight + P.itemGap) * B : labelY
    blocks.push({ ruleY, label: { text: b.label || '', x: 0, y: labelY, ...labelOpts, lines: labelLines }, items })
    ruleY = lastBase + P.ruleBelowItems * B
  }

  // link: blok terakhir dengan label LINKS, chip berjajar dan pindah baris kalau kolom penuh
  const C = sz.chip
  const links = project.links || []
  let bottom = ruleY - P.ruleBelowItems * B + B * 0.5
  let linkBlock = null
  if (links.length) {
    const labelY = ruleY + P.labelBelowRule * sz.label + capH * sz.label
    let cy = labelY + P.chipsBelowLabel * C
    let x = 0
    const a = P.arrowSize * C
    const hitY = Math.max(10, (P.chipHit - capH * C) / 2) // pad atas/bawah kotak klik
    const rowH = Math.max(P.chipRow * C, P.chipHit + 4)
    const chips = links.map((link) => {
      const text = chipText(link)
      const tw = measure(text, { size: C }).width
      const w = tw + P.arrowGap * C + a
      if (x > 0 && x + w > colW) {
        x = 0
        cy += rowH
      }
      const chip = { text, x, y: cy, size: C, textWidth: tw, width: w, arrow: { x: x + tw + P.arrowGap * C, y: cy, size: a } }
      // kotak klik: sedikit lebih besar dari teks + panah supaya mudah di-tap
      chip.rect = { x0: x - 6, x1: x + w + 6, y0: cy - capH * C - hitY, y1: cy + hitY }
      x += w + P.chipGap * C
      return chip
    })
    linkBlock = { ruleY, label: { text: P.linksLabel, x: 0, y: labelY, ...labelOpts }, chips }
    bottom = cy + P.bottomPad * C
  }

  // scroll: bagian bawah konten berhenti tepat di atas zona fade bawah
  const scrollMax = Math.max(0, bottom - (height - 2 * margin))
  const lane = { x: colX - P.lane.pad, w: colW + 2 * P.lane.pad }
  return { sizes: sz, colW, colX, top, margin, heading, lead, blocks, links: linkBlock, bottom, scrollMax, lane }
}
