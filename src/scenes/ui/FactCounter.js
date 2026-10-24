import { Group, LineSegments, BufferGeometry, BufferAttribute, LineBasicMaterial, Color } from 'three'
import { MsdfText } from '../../text/MsdfText.js'
import { layoutText } from '../../text/layout.js'
import { clamp } from '../../engine/math.js'
import { bus } from '../../engine/Bus.js'
import { counterText } from '../igloo/facts.js'
import { createPlate, placePlate } from './FactLabel.js'
import content from '../../content/content.js'

// Penghitung fakta bata igloo di pojok kanan atas, sejajar tengah kotak logo: "FOUND 3/12" (mono) dan baris
// tanda kecil di bawahnya, satu tanda per fakta (yang sudah ketemu putih, sisanya redup).
// Muncul setelah fakta pertama ditemukan (bus 'igloo_fact_found' dari BrickFacts.js), tiap fakta baru = teks diganti
// dengan scramble (uShow2 0 -> 1) dan tanda berikutnya terisi. Semua ketemu: "ALL 12 FOUND" dengan sorot singkat
// (biru es ke putih, kedip, pelat lebih pekat). Hanya tampil di scene igloo, sembunyi saat detail terbuka.
// Sesi saja, tidak disimpan. Pelat dan bayangan sama dengan kartu fakta (FactLabel.js), latar langit igloo pucat.

export const FACT_COUNTER = {
  show1: 0.4,
  show2: 0.75,
  hide: 0.3,
  tick: 0.35, // detik, tanda fakta baru terisi dari kiri
  tickGap: 0.3, // em, jarak antar tanda
  tickBelow: 0.8, // em, baseline teks ke garis tanda
  tickOff: 0.3, // opacity tanda fakta yang belum ketemu
  padX: 0.75, // em
  padY: 0.7, // em
  soft: 0.9, // em
  radius: 0.35, // em
  plateAlpha: 0.5,
  highlight: 2.4, // detik sorot "ALL 12 FOUND"
  blink: 0.9, // detik kedip di awal sorot
  transition: 0.25, // porsi transisi igloo -> scene berikutnya, lewat dari ini penghitung sembunyi
}

const WHITE = new Color(0xffffff)
const ICE = new Color(0x9cc8ff) // biru es, senada emisi bata (0.5, 0.7, 1)

/**
 * Tata letak penghitung dalam piksel CSS, y ke bawah (logika murni, dites di tests/facts.test.js).
 * Rata kanan di (lebar - margin), blok teks + tanda dipusatkan vertikal ke tengah kotak logo.
 * @param {object} o
 * @param {number} o.width lebar layar
 * @param {{x:number,y:number,width:number,height:number}} o.logoBox kotak logo (computeUILayout)
 * @param {number} o.margin margin kiri breakpoint (dipakai juga di kanan)
 * @param {number} o.size ukuran teks px, capHeight em
 * @param {number} o.textWidth lebar teks sekarang, rowWidth lebar baris tanda
 * @returns {{right, textX, baseline, rowX0, tickY, rect: {x0, y0, x1, y1}}} rect = kotak pelat (untuk dihindari kartu)
 */
export function factCounterLayout({ width, logoBox, margin, size, capHeight, textWidth, rowWidth }) {
  const C = FACT_COUNTER
  const right = width - margin
  const capPx = capHeight * size
  const blockH = capPx + C.tickBelow * size
  const top = logoBox.y + logoBox.height / 2 - blockH / 2
  const baseline = top + capPx
  const tickY = baseline + C.tickBelow * size
  const textX = right - textWidth
  const rowX0 = right - rowWidth
  const padX = C.padX * size
  const padY = C.padY * size
  return {
    right, textX, baseline, rowX0, tickY,
    rect: { x0: Math.min(textX, rowX0) - padX, y0: top - padY, x1: right + padX, y1: tickY + padY },
  }
}

/** Segmen tanda: n tanda sama panjang selebar rowWidth, celah gap. [x0, x1] per tanda, dari kiri. */
export function tickSpans(n, rowX0, rowWidth, gap) {
  const len = Math.max(1, (rowWidth - gap * (n - 1)) / Math.max(1, n))
  return Array.from({ length: n }, (_, i) => [rowX0 + i * (len + gap), rowX0 + i * (len + gap) + len])
}

export class FactCounter extends Group {
  /**
   * @param {import('../../text/MsdfFont.js').MsdfFont} font
   * @param {{label?: import('./FactLabel.js').FactLabel}} [o] kartu fakta yang harus menghindari penghitung
   */
  constructor(font, { label = null } = {}) {
    super()
    this.name = 'ui_factCounter'
    this.font = font
    this.label = label
    this.strings = content.ui.facts
    this.count = 0
    this.total = 0
    this.complete = false
    this.show1 = 0
    this.show2 = 0
    this.tickAnim = 1 // isi tanda terbaru 0..1
    this.glow = 0 // sorot selesai, detik tersisa
    this.size = 12
    this.layout = null
    this._avoidOn = [{ x0: 0, y0: 0, x1: 0, y1: 0 }]
    this._avoidOff = []

    this.plate = createPlate('ui_factCounterPlate')
    this.plate.renderOrder = 40
    const lineMat = (opacity) =>
      new LineBasicMaterial({ color: 0xffffff, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false })
    // tanda: dua LineSegments (sudah ketemu terang, belum ketemu redup), geometri ditulis ulang saat berubah
    this.ticksOn = new LineSegments(new BufferGeometry(), lineMat(1))
    this.ticksOn.name = 'ui_factTicksOn'
    this.ticksOff = new LineSegments(new BufferGeometry(), lineMat(FACT_COUNTER.tickOff))
    this.ticksOff.name = 'ui_factTicksOff'
    for (const t of [this.ticksOn, this.ticksOff]) {
      t.geometry.setAttribute('position', new BufferAttribute(new Float32Array(64 * 2 * 3), 3))
      t.geometry.setDrawRange(0, 0)
      t.renderOrder = 42
    }
    this.text = new MsdfText(font, { text: '', color: 0xffffff, seed: 23 })
    this.text.name = 'ui_factCounterText'
    this.text.renderOrder = 43
    this.text.uniforms.uShow1.value = 0
    this.text.uniforms.uShow2.value = 0
    for (const o of [this.plate, this.ticksOff, this.ticksOn, this.text]) {
      o.frustumCulled = false
      this.add(o)
    }
    this.visible = false

    bus.on('igloo_fact_found', ({ count, total }) => this.setCount(count, total))
    this.writeA11y()
  }

  /** Fakta baru ditemukan: teks diganti dengan scramble, tanda berikutnya terisi. Semua ketemu = sorot. */
  setCount(count, total) {
    if (count === this.count && total === this.total) return
    const wasComplete = this.complete
    this.count = count
    this.total = total
    this.complete = total > 0 && count >= total
    this.text.setText(counterText(count, total, this.strings), { size: this.size })
    this.show2 = 0 // scramble ulang (kalau baru muncul, show1 juga masih 0 dan ikut reveal)
    this.tickAnim = 0
    if (this.complete && !wasComplete) {
      this.glow = FACT_COUNTER.highlight
      bus.emit('audio_play', { name: 'ui-long' })
    }
    this._layout()
    this._writeA11yCount()
  }

  /** Ukuran layar dan tata letak UI (computeUILayout) sekarang. */
  resize(width, height, L) {
    this.width = width
    this.L = L
    const size = L.sound.size
    if (size !== this.size) {
      this.size = size
      this.text.relayout({ size })
    }
    this._layout()
  }

  _layout() {
    const L = this.L
    if (!L) return
    const s = this.size
    // baris tanda selebar teks terpanjang (teks selesai), supaya tidak berubah lebar saat angka bertambah
    const longest = counterText(this.total || 1, this.total || 1, this.strings)
    const rowWidth = Math.max(layoutText(this.font, longest, { size: s }).width, this.text.layout.width)
    this.layout = factCounterLayout({
      width: this.width, logoBox: L.logoBox, margin: L.logo.x, size: s, capHeight: this.font.capHeight,
      textWidth: this.text.layout.width, rowWidth,
    })
    this.layout.spans = tickSpans(this.total, this.layout.rowX0, rowWidth, FACT_COUNTER.tickGap * s)
    Object.assign(this._avoidOn[0], this.layout.rect)
    this.text.position.set(this.layout.textX, -this.layout.baseline, 0)
  }

  /** Precompile: paksa terlihat sesaat. */
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
   * @param {object} frame frame engine (scroll dipakai untuk tahu scene igloo sedang tampil)
   * @param {boolean} enabled false = sembunyi (intro UI belum jalan, detail terbuka)
   */
  update(dt, frame, enabled = true) {
    const C = FACT_COUNTER
    const st = frame?.scroll?.state
    const inIgloo = !!st && st.current.key === 'igloo' && st.transition < C.transition
    const on = enabled && inIgloo && this.count > 0 && !!this.layout
    if (on) {
      this.show1 = clamp(this.show1 + dt / C.show1, 0, 1)
      this.show2 = clamp(this.show2 + dt / C.show2, 0, 1)
      this.tickAnim = clamp(this.tickAnim + dt / C.tick, 0, 1)
    } else {
      this.show1 = clamp(this.show1 - dt / C.hide, 0, 1)
      this.show2 = clamp(this.show2 - dt / C.hide, 0, 1)
    }
    this.visible = this.show1 > 0
    if (this.label) this.label.avoidExtra = this.visible ? this._avoidOn : this._avoidOff
    if (!this.visible) return

    // sorot selesai: biru es memudar ke putih, kedip singkat di awal, pelat sedikit lebih pekat
    let hi = 0
    if (this.glow > 0) {
      this.glow = Math.max(0, this.glow - dt)
      hi = this.glow / C.highlight
    }
    const u = this.text.uniforms
    u.uShow1.value = this.show1
    u.uShow2.value = this.show2
    u.uColor.value.copy(WHITE).lerp(ICE, hi)
    const blink = C.highlight - this.glow
    u.uBlink.value = hi > 0 && blink < C.blink ? blink / C.blink : 1

    const s = this.size
    const lay = this.layout
    const r = lay.rect
    const a = this.show1 * (2 - this.show1)
    placePlate(this.plate, r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0, C.soft * s, C.radius * s, C.plateAlpha * (1 + 0.4 * hi) * a)
    this._writeTicks(lay)
    this.ticksOn.material.opacity = a
    this.ticksOff.material.opacity = C.tickOff * a
  }

  // tanda fakta: yang sudah ketemu terang (tanda terbaru terisi dari kiri), sisanya redup
  _writeTicks(lay) {
    const y = -lay.tickY
    const on = this.ticksOn.geometry.attributes.position
    const off = this.ticksOff.geometry.attributes.position
    let a = 0
    let b = 0
    lay.spans.forEach(([x0, x1], i) => {
      if (i < this.count) {
        const k = i === this.count - 1 ? this.tickAnim : 1
        if (k > 0) {
          on.setXYZ(a++, x0, y, 0)
          on.setXYZ(a++, x0 + (x1 - x0) * k, y, 0)
        }
        if (k < 1) {
          off.setXYZ(b++, x0 + (x1 - x0) * k, y, 0)
          off.setXYZ(b++, x1, y, 0)
        }
      } else {
        off.setXYZ(b++, x0, y, 0)
        off.setXYZ(b++, x1, y, 0)
      }
    })
    on.needsUpdate = off.needsUpdate = true
    this.ticksOn.geometry.setDrawRange(0, a)
    this.ticksOff.geometry.setDrawRange(0, b)
  }

  /** Cermin DOM tersembunyi: hitungan fakta untuk pembaca layar (aria-live, diumumkan tiap fakta baru). */
  writeA11y() {
    if (typeof document === 'undefined') return
    const main = document.getElementById('a11y')
    if (!main) return
    let sec = main.querySelector('section[data-fact-counter]')
    if (!sec) {
      sec = document.createElement('section')
      sec.dataset.factCounter = ''
      main.append(sec)
    }
    const p = document.createElement('p')
    p.setAttribute('aria-live', 'polite')
    sec.replaceChildren(p)
    this._a11y = p
  }

  _writeA11yCount() {
    if (this._a11y) this._a11y.textContent = this.text.text
  }

  dispose() {
    this.text.dispose()
    this.plate.geometry.dispose()
    this.plate.material.dispose()
    for (const t of [this.ticksOn, this.ticksOff]) {
      t.geometry.dispose()
      t.material.dispose()
    }
  }
}
