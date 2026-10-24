import { Group } from 'three'
import gsap from 'gsap'
import { lerpFPS } from '../../engine/math.js'
import { InkText, InkLines, SoftPlate } from './uiParts.js'
import { layoutSectionIndex } from './layout.js'
import { sectionLabel } from './sectionNav.js'

// Indeks section kanan bawah, cermin blok Sound: "01 IGLOO / 02 WORK / 03 LINKS" (ponsel: nomor saja, bertumpuk).
// Item aktif putih penuh dengan garis penanda pendek di kirinya, item lain redup. Hover = scramble ulang + bunyi
// "ui-long" seperti tombol Sound. Klik ditangani UIScene, lompatnya diurus ScrollGuide.

export const SECTION_INDEX = {
  idleAlpha: 0.6, // opacity item tidak aktif
  hoverAlpha: 1,
  markerLerp: 0.16, // per frame 60 fps, penanda meluncur ke item aktif
  show1: 0.4,
  show2: 0.75,
  stagger: 0.06,
  hide: 0.3,
  // pelat lembut di belakang seluruh daftar (em ukuran teks indeks)
  pad: 0.5,
  soft: 2.6, // tepi sangat lebar: terbaca sebagai bayangan lembut, bukan kotak
  radius: 1.2,
  plateAlpha: 0.3,
}

export class SectionIndex extends Group {
  /**
   * @param {import('../../text/MsdfFont.js').MsdfFont} font
   * @param {string[]} labels nama section, mis. ['IGLOO', 'WORK', 'LINKS']
   */
  constructor(font, labels) {
    super()
    this.name = 'ui_sectionIndex'
    this.font = font
    this.labels = labels
    this.compact = false
    this.spec = null
    this.lay = null
    this.active = 0
    this.hovered = -1
    this.wanted = false
    this.show = { value: 0 } // 0..1 opacity keseluruhan (penanda + pelat)
    this.marker = { a: 0, x0: 0, x1: 0, y: 0, ready: false }
    this.alphas = labels.map(() => SECTION_INDEX.idleAlpha)

    this.plate = new SoftPlate()
    this.plate.name = 'ui_indexPlate'
    this.plate.renderOrder = 30
    this.add(this.plate)
    this.items = labels.map((label, i) => {
      const t = new InkText(font, { text: sectionLabel(i, label), seed: 31 + i, shadowAlpha: 0.6 })
      t.name = `ui_index${i}`
      t.setRenderOrder(32)
      t.uniforms.uShow1.value = 0
      t.uniforms.uShow2.value = 0
      this.add(t)
      return t
    })
    this.lines = new InkLines(2, { alpha: 1, shadowAlpha: 0.6 })
    this.lines.name = 'ui_indexMarker'
    this.lines.setRenderOrder(36)
    this.add(this.lines)
    this.visible = false
  }

  /** Posisi dari computeUILayout().index. */
  resize(spec) {
    this.spec = spec
    if (spec.compact !== this.compact || !this.lay) {
      this.compact = spec.compact
      this.items.forEach((t, i) => t.setText(sectionLabel(i, this.labels[i], this.compact)))
    }
    for (const t of this.items) t.relayout({ size: spec.size, letterSpacing: spec.letterSpacing })
    this.lay = layoutSectionIndex(spec, this.items.map((t) => t.layout.width), this.font.capHeight)
    this.items.forEach((t, i) => t.position.set(this.lay.items[i].x, -this.lay.items[i].baseline, 0))
    const S = SECTION_INDEX
    const b = this.lay.box
    const pad = S.pad * spec.size
    // pelat menutup teks (dan penanda), bukan seluruh area klik
    const it = this.lay.items
    const cap = this.font.capHeight * spec.size
    const x0 = Math.min(...this.lay.markers.map((m) => m.x0), ...it.map((q) => q.x))
    const x1 = Math.max(...it.map((q) => q.x + q.width))
    const y0 = Math.min(...it.map((q) => q.baseline)) - cap
    const y1 = Math.max(...it.map((q) => q.baseline), ...this.lay.markers.map((m) => m.y))
    this.plate.setBox(x0 - pad, y0 - pad, x1 + pad, y1 + pad, S.soft * spec.size, S.radius * spec.size)
    this.boxRect = b
    this.marker.ready = false
  }

  /** Indeks item di titik p (piksel CSS), -1 kalau tidak kena. */
  hit(p) {
    if (!this.lay || !this.wanted || this.show.value < 0.5) return -1
    return this.lay.hits.findIndex((r) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1)
  }

  setActive(i) {
    this.active = i
  }

  /** Hover item i (-1 = lepas). Mengembalikan true kalau berubah. */
  setHovered(i) {
    if (i === this.hovered) return false
    this.hovered = i
    if (i >= 0) {
      gsap.fromTo(this.items[i].uniforms.uShow2, { value: 0 }, { value: 1, duration: SECTION_INDEX.show2, ease: 'sine.out' })
    }
    return true
  }

  setVisible(on, { instant = false } = {}) {
    if (on === this.wanted) return
    this.wanted = on
    const S = SECTION_INDEX
    const us = this.items.flatMap((t) => [t.uniforms.uShow1, t.uniforms.uShow2])
    gsap.killTweensOf([...us, this.show])
    if (instant) {
      for (const u of us) u.value = on ? 1 : 0
      this.show.value = on ? 1 : 0
      return
    }
    if (on) {
      this.items.forEach((t, i) => {
        gsap.fromTo(t.uniforms.uShow1, { value: 0 }, { value: 1, duration: S.show1, ease: 'none', delay: i * S.stagger })
        gsap.fromTo(t.uniforms.uShow2, { value: 0 }, { value: 1, duration: S.show2, ease: 'sine.out', delay: i * S.stagger })
      })
      gsap.fromTo(this.show, { value: 0 }, { value: 1, duration: 0.6, ease: 'none' })
    } else {
      this.setHovered(-1)
      gsap.to(us, { value: 0, duration: S.hide, ease: 'none' })
      gsap.to(this.show, { value: 0, duration: S.hide, ease: 'none' })
    }
  }

  /** Precompile (UIScene.upload). */
  forceVisible(on) {
    if (on) {
      this._saved = [this.visible, this.show.value, this.items.map((t) => t.uniforms.uShow1.value)]
      this.visible = true
      this.show.value = 1
      for (const t of this.items) t.uniforms.uShow1.value = 1
      this.update(0)
    } else if (this._saved) {
      const [vis, show, s1] = this._saved
      this.visible = vis
      this.show.value = show
      this.items.forEach((t, i) => (t.uniforms.uShow1.value = s1[i]))
      this.update(0)
    }
  }

  /** @param {number} ratio rasio frame 60 fps */
  update(ratio) {
    const S = SECTION_INDEX
    const show = this.show.value
    const anyText = this.items.some((t) => t.uniforms.uShow1.value > 0)
    this.visible = !!this.lay && (show > 0 || anyText)
    if (!this.visible) return
    // opacity item: aktif / hover penuh, lainnya redup, transisi halus
    this.items.forEach((t, i) => {
      const target = i === this.active || i === this.hovered ? S.hoverAlpha : S.idleAlpha
      this.alphas[i] = lerpFPS(this.alphas[i], target, 0.2, ratio)
      t.setOpacity(this.alphas[i])
    })
    // penanda meluncur ke item aktif
    const m = this.lay.markers[this.active] || this.lay.markers[0]
    const k = this.marker
    if (!k.ready) {
      Object.assign(k, m, { ready: true })
    } else {
      k.x0 = lerpFPS(k.x0, m.x0, S.markerLerp, ratio)
      k.x1 = lerpFPS(k.x1, m.x1, S.markerLerp, ratio)
      k.y = lerpFPS(k.y, m.y, S.markerLerp, ratio)
    }
    const y = Math.round(k.y) + 0.5
    const grow = Math.min(1, show * 1.4)
    // garis tumbuh dari sisi teks ke kiri
    this.lines.begin()
    this.lines.seg(k.x1 - (k.x1 - k.x0) * grow, y, k.x1, y)
    this.lines.end()
    this.lines.setOpacity(show)
    this.plate.uniforms.uAlpha.value = S.plateAlpha * show
  }

  dispose() {
    for (const t of this.items) t.dispose()
    this.lines.dispose()
    this.plate.dispose()
  }
}
