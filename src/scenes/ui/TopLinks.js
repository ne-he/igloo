import { Group } from 'three'
import gsap from 'gsap'
import { lerpFPS } from '../../engine/math.js'
import { InkText, SoftPlate } from './uiParts.js'

// Tombol cepat kanan atas (audit 10 Nov 2026): "[ CV ]" dan "[ QUICK VIEW ]". Rekruter yang cuma punya
// setengah menit harus bisa mengambil CV atau membuka profil ringkas tanpa harus menjelajah dunia 3D dulu.
// Gaya sama dengan indeks section: teks MSDF putih berbayang tinta di atas pelat lembut, redup saat diam,
// penuh saat hover. Klik ditangani UIScene (window.open / pindah halaman).

export const TOP_LINKS = {
  idleAlpha: 0.82,
  hoverAlpha: 1,
  gap: 1.5, // em, jarak antar tombol
  pad: 0.55, // em, pelat di sekeliling teks
  hitPad: 0.9, // em, area klik di sekeliling teks (jari)
  soft: 1.6,
  radius: 0.5,
  plateAlpha: 0.34,
  plateHover: 0.6,
  show1: 0.4,
  show2: 0.75,
  stagger: 0.08,
  hide: 0.3,
}

/**
 * Tata letak murni: tombol berjajar rata kanan. widths = lebar teks tiap tombol (px).
 * @returns {{items: {x:number, baseline:number, width:number}[], hits: object[], box: object}}
 */
export function layoutTopLinks({ right, baseline, size, capHeight }, widths) {
  const T = TOP_LINKS
  const cap = capHeight * size
  const items = []
  let x = right
  for (let i = widths.length - 1; i >= 0; i--) {
    x -= widths[i]
    items[i] = { x, baseline, width: widths[i] }
    x -= T.gap * size
  }
  const hp = T.hitPad * size
  const hx = Math.min(hp, (T.gap * size) / 2) // area klik tombol bertetangga tidak boleh saling menimpa
  const hits = items.map((q) => ({ x0: q.x - hx, y0: baseline - cap - hp, x1: q.x + q.width + hx, y1: baseline + hp }))
  const box = { x0: Math.min(...items.map((q) => q.x)), y0: baseline - cap, x1: right, y1: baseline }
  return { items, hits, box, cap }
}

export class TopLinks extends Group {
  /**
   * @param {import('../../text/MsdfFont.js').MsdfFont} font
   * @param {{label:string, url:string, newTab?:boolean}[]} links
   */
  constructor(font, links) {
    super()
    this.name = 'ui_topLinks'
    this.font = font
    this.links = links
    this.lay = null
    this.hovered = -1
    this.wanted = false
    this.show = { value: 0 }
    this.alphas = links.map(() => TOP_LINKS.idleAlpha)
    this.glow = links.map(() => 0)
    this.plates = links.map((_, i) => {
      const p = new SoftPlate()
      p.name = `ui_topPlate${i}`
      p.renderOrder = 30
      this.add(p)
      return p
    })
    this.items = links.map((l, i) => {
      const t = new InkText(font, { text: l.label, seed: 41 + i, shadowAlpha: 0.6 })
      t.name = `ui_top${i}`
      t.setRenderOrder(32)
      t.uniforms.uShow1.value = 0
      t.uniforms.uShow2.value = 0
      this.add(t)
      return t
    })
    this.visible = false
  }

  /** @param {{right:number, baseline:number, size:number}} spec piksel CSS, y ke bawah */
  resize(spec) {
    for (const t of this.items) t.relayout({ size: spec.size })
    this.lay = layoutTopLinks({ ...spec, capHeight: this.font.capHeight }, this.items.map((t) => t.layout.width))
    const T = TOP_LINKS
    const pad = T.pad * spec.size
    this.items.forEach((t, i) => {
      const q = this.lay.items[i]
      t.position.set(q.x, -q.baseline, 0)
      this.plates[i].setBox(q.x - pad, q.baseline - this.lay.cap - pad, q.x + q.width + pad, q.baseline + pad, T.soft * spec.size, T.radius * spec.size)
    })
    this.boxRect = this.lay.box
  }

  /** Indeks tombol di titik p (piksel CSS), -1 kalau tidak kena. */
  hit(p) {
    if (!this.lay || !this.wanted || this.show.value < 0.5) return -1
    return this.lay.hits.findIndex((r) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1)
  }

  /** Hover tombol i (-1 = lepas). Mengembalikan true kalau berubah. */
  setHovered(i) {
    if (i === this.hovered) return false
    this.hovered = i
    if (i >= 0) {
      gsap.fromTo(this.items[i].uniforms.uShow2, { value: 0 }, { value: 1, duration: TOP_LINKS.show2, ease: 'sine.out' })
    }
    return true
  }

  setVisible(on, { instant = false } = {}) {
    if (on === this.wanted) return
    this.wanted = on
    const T = TOP_LINKS
    const us = this.items.flatMap((t) => [t.uniforms.uShow1, t.uniforms.uShow2])
    gsap.killTweensOf([...us, this.show])
    if (instant) {
      for (const u of us) u.value = on ? 1 : 0
      this.show.value = on ? 1 : 0
      return
    }
    if (on) {
      this.items.forEach((t, i) => {
        gsap.fromTo(t.uniforms.uShow1, { value: 0 }, { value: 1, duration: T.show1, ease: 'none', delay: i * T.stagger })
        gsap.fromTo(t.uniforms.uShow2, { value: 0 }, { value: 1, duration: T.show2, ease: 'sine.out', delay: i * T.stagger })
      })
      gsap.fromTo(this.show, { value: 0 }, { value: 1, duration: 0.6, ease: 'none' })
    } else {
      this.setHovered(-1)
      gsap.to(us, { value: 0, duration: T.hide, ease: 'none' })
      gsap.to(this.show, { value: 0, duration: T.hide, ease: 'none' })
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
    const T = TOP_LINKS
    const show = this.show.value
    const anyText = this.items.some((t) => t.uniforms.uShow1.value > 0)
    this.visible = !!this.lay && (show > 0 || anyText)
    if (!this.visible) return
    this.items.forEach((t, i) => {
      const hot = i === this.hovered
      this.alphas[i] = lerpFPS(this.alphas[i], hot ? T.hoverAlpha : T.idleAlpha, 0.2, ratio)
      this.glow[i] = lerpFPS(this.glow[i], hot ? 1 : 0, 0.2, ratio)
      t.setOpacity(this.alphas[i])
      this.plates[i].uniforms.uAlpha.value = show * (T.plateAlpha + (T.plateHover - T.plateAlpha) * this.glow[i])
    })
  }

  dispose() {
    for (const t of this.items) t.dispose()
    for (const p of this.plates) p.dispose()
  }
}
