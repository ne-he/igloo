import { Group, LineSegments, LineBasicMaterial, BufferGeometry, Float32BufferAttribute, Matrix4 } from 'three'
import gsap from 'gsap'
import { MsdfText } from '../../text/MsdfText.js'
import { bus } from '../../engine/Bus.js'
import { lerpFPS } from '../../engine/math.js'

// Carousel link ruang entry (skill ref 01 bagian 6.5, blueprint 5.5 baris "Carousel link").
// UI hidup di DALAM scene entry (kena grade entry + bloom, ikut transisi), ditempel ke kamera yang merender:
// tiap mesh HUD memakai koordinat piksel CSS dengan (0, 0) di tengah layar, y ke atas, lalu di onBeforeRender
// matrixWorld-nya = kamera x (geser D ke depan, skala piksel -> dunia) x matriks lokal. Tidak ada lag kamera.
//
// Ganti link: klik setengah kiri/kanan layar, swipe (lebih dari 100 px DAN lebih dari 1000 px/s), panah kiri/kanan.
// Kotak "Visit" (bracket sudut + teks MSDF) membuka link di tab baru, nama link di bawahnya, tetangga redup di sisi.

export const LINKS_UI = {
  active: [0.64, 0.9], // progress entry saat UI aktif (data asli)
  swipePx: 100,
  swipeVelocity: 1000, // px/s
  textSize: 13, // px
  sideOffset: 170, // px, jarak nama tetangga dari tengah
}
const D = 1 // jarak bidang HUD di depan kamera (unit dunia), jauh di atas near 0.1
const _hud = new Matrix4()

/** Ukuran kotak Visit per breakpoint (igloo 220 / 180 / 150 px, aspek 3.125). */
function visitWidth(w, h) {
  if (w < 640) return 150
  if (w < 1600 || h < 800) return 180
  return 220
}

function bracketGeometry() {
  // kotak satuan -0.5..0.5, tiap sudut dua garis sepanjang 0.18 lebar / 0.35 tinggi (diskalakan di layout)
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(new Float32Array(16 * 3), 3))
  return g
}

function arrowGeometry(dir) {
  // garis panjang + satu kait miring di ujung (gaya "<--" tipis di ref 14), piksel
  const L = 52
  const tip = dir < 0 ? -L / 2 : L / 2
  const pts = [-L / 2, 0, 0, L / 2, 0, 0, tip, 0, 0, tip - dir * 7, 5, 0]
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(pts, 3))
  return g
}

export class LinksUI extends Group {
  /**
   * @param {import('../../text/MsdfFont.js').MsdfFont} font
   * @param {object} o
   * @param {object} o.engine
   * @param {{title:string,url:string}[]} o.links
   * @param {(dir:number) => void} o.onChange
   */
  constructor(font, { engine, links, onChange }) {
    super()
    this.name = 'links_ui'
    this.engine = engine
    this.links = links
    this.onChange = onChange
    this.index = 0
    this.show = 0 // 0..1 hasil lerp, dipakai opacity
    this.enabled = false
    this.hover = false
    this.width = 1
    this.height = 1
    this.flash = [0, 0] // kedip panah kiri, kanan
    this.hudMeshes = []

    const text = (str, seed, opacity = 1) => {
      const m = new MsdfText(font, { text: str, size: LINKS_UI.textSize, align: 'center', color: 0xffffff, seed })
      m.renderOrder = 60
      m.frustumCulled = false
      m.baseOpacity = opacity
      return this._hudify(m)
    }
    this.visitText = text('Visit', 71)
    this.name0 = text(links[0].title, 72) // nama aktif
    this.namePrev = text(links[links.length - 1].title, 73, 0.32)
    this.nameNext = text(links[1 % links.length].title, 74, 0.32)
    this.texts = [this.visitText, this.name0, this.namePrev, this.nameNext]

    const lineMat = () => new LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false,
    })
    this.bracket = this._hudify(new LineSegments(bracketGeometry(), lineMat()))
    this.arrowL = this._hudify(new LineSegments(arrowGeometry(-1), lineMat()))
    this.arrowR = this._hudify(new LineSegments(arrowGeometry(1), lineMat()))
    for (const l of [this.bracket, this.arrowL, this.arrowR]) {
      l.renderOrder = 60
      l.frustumCulled = false
    }
    this.add(...this.texts, this.bracket, this.arrowL, this.arrowR)

    this._bind()
    this.resize(engine.container.clientWidth, engine.container.clientHeight)
  }

  /** Tempel mesh ke kamera yang sedang merender: matrixWorld = kamera x HUD x lokal. */
  _hudify(mesh) {
    mesh.onBeforeRender = (_r, _s, camera) => {
      // tinggi bidang di jarak D, dibagi tinggi layar CSS = ukuran satu piksel dalam unit dunia
      const px = (2 * D * Math.tan((camera.fov * Math.PI) / 360)) / (camera.zoom || 1) / this.height
      _hud.makeTranslation(0, 0, -D).scale({ x: px, y: px, z: px })
      mesh.updateMatrix()
      mesh.matrixWorld.multiplyMatrices(camera.matrixWorld, _hud).multiply(mesh.matrix)
    }
    this.hudMeshes.push(mesh)
    return mesh
  }

  _bind() {
    bus.on('resize', ({ width, height }) => this.resize(width, height))
    bus.on('keydown', (e) => {
      if (!this.enabled) return
      if (e.key === 'ArrowLeft') this.onChange(-1)
      else if (e.key === 'ArrowRight') this.onChange(1)
    })
    bus.on('click', (input) => {
      if (!this.enabled) return
      if (this._inVisit(input.position)) this.visit()
      else this.onChange(input.position.x < this.width / 2 ? -1 : 1)
    })
    bus.on('pointer_down', (input) => {
      const now = performance.now()
      this._down = { x: input.position.x, t: now }
      this._move = { x: input.position.x, t: now }
      this._vx = 0
    })
    bus.on('pointer_move', (input) => {
      this._setHover(this.enabled && this._inVisit(input.position))
      if (!input.isDown || !this._down) return
      const now = performance.now()
      const dt = now - this._move.t
      if (dt > 0) {
        const v = ((input.position.x - this._move.x) / dt) * 1000
        this._vx = this._vx * 0.5 + v * 0.5 // laju swipe halus, px/s
      }
      this._move = { x: input.position.x, t: now }
    })
    bus.on('pointer_up', (input) => {
      const down = this._down
      this._down = null
      if (!down || !this.enabled) return
      const dx = input.position.x - down.x
      if (Math.abs(dx) > LINKS_UI.swipePx && Math.abs(this._vx) > LINKS_UI.swipeVelocity) this.onChange(dx < 0 ? 1 : -1)
    })
  }

  _setHover(on) {
    if (on === this.hover) return
    this.hover = on
    this.engine.setCursor?.('entry_visit', on)
  }

  /** Kotak Visit dalam piksel CSS (origin kiri atas), untuk hit test dan script verifikasi. */
  get visitRect() {
    const { boxW, boxH, boxY } = this.layout
    const cx = this.width / 2
    const cy = this.height / 2 - boxY
    return { x0: cx - boxW / 2, x1: cx + boxW / 2, y0: cy - boxH / 2, y1: cy + boxH / 2 }
  }

  _inVisit(p) {
    const r = this.visitRect
    return p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1
  }

  visit() {
    const link = this.links[this.index]
    window.open(link.url, '_blank', 'noopener')
    bus.emit('audio_play', { name: 'ui-long' })
  }

  resize(width, height) {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    const boxW = visitWidth(width, height)
    const boxH = boxW / 3.125
    const boxY = -height / 2 + Math.max(70, height * 0.13) // tengah kotak, piksel dari tengah layar
    const nameY = boxY - boxH / 2 - 24
    this.layout = { boxW, boxH, boxY, nameY }
    // bracket sudut
    const hx = boxW / 2
    const hy = boxH / 2
    const lx = Math.min(14, boxW * 0.12)
    const ly = Math.min(10, boxH * 0.3)
    const pos = this.bracket.geometry.attributes.position.array
    let i = 0
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        const x = sx * hx
        const y = sy * hy
        pos.set([x, y, 0, x - sx * lx, y, 0, x, y, 0, x, y - sy * ly, 0], i)
        i += 12
      }
    }
    this.bracket.geometry.attributes.position.needsUpdate = true
    this.bracket.position.set(0, boxY, 0)
    // teks: baseline digeser setengah cap height supaya tengah vertikal
    const cap = LINKS_UI.textSize * 0.35
    this.visitText.position.set(0, boxY - cap, 0)
    this.name0.position.set(0, nameY - cap, 0)
    const side = Math.min(LINKS_UI.sideOffset, width * 0.3)
    this.namePrev.position.set(-side, nameY - cap, 0)
    this.nameNext.position.set(side, nameY - cap, 0)
    // panah di kiri kanan tengah layar (ref 14 sekitar 13% dari tepi)
    const ax = width / 2 - Math.max(60, width * 0.13)
    this.arrowL.position.set(-ax, 0, 0)
    this.arrowR.position.set(ax, 0, 0)
  }

  /** Tampilkan link ke-i (dir = arah ganti, untuk kedip panah). Teks nama di-scramble ulang. */
  setIndex(i, dir) {
    const n = this.links.length
    this.index = i
    this.name0.setText(this.links[i].title)
    this.namePrev.setText(this.links[(i - 1 + n) % n].title)
    this.nameNext.setText(this.links[(i + 1) % n].title)
    for (const t of [this.name0, this.namePrev, this.nameNext]) {
      gsap.fromTo(t.uniforms.uShow2, { value: 0 }, { value: 1, duration: 0.75, ease: 'sine.out', overwrite: true })
    }
    const k = dir < 0 ? 0 : 1
    const f = { v: 1 }
    gsap.to(f, { v: 0, duration: 0.45, ease: 'none', onUpdate: () => (this.flash[k] = f.v) })
  }

  /**
   * @param {object} o
   * @param {number} o.progress progress scene entry
   * @param {boolean} o.allowed false = interaksi dimatikan (mis. detail proyek terbuka)
   * @param {number} o.ratio
   */
  update({ progress, allowed, ratio }) {
    const [a, b] = LINKS_UI.active
    const on = allowed && progress > a && progress < b
    if (on !== this.enabled) {
      this.enabled = on
      if (on) this._reveal()
      else this._setHover(false)
    }
    this.show = lerpFPS(this.show, on ? 1 : 0, 0.12, ratio)
    if (this.show < 0.002) this.show = 0
    this.visible = this.show > 0
    if (!this.visible) return
    const s = this.show
    for (const t of this.texts) t.uniforms.uOpacity.value = s * t.baseOpacity
    this.visitText.uniforms.uOpacity.value = s * (this.hover ? 1 : 0.85)
    this.bracket.material.opacity = s * (this.hover ? 1 : 0.75)
    // panah: redup diam, kedip 3 kali saat link diganti ke arahnya (gelombang kotak, igloo 225)
    const blink = (v) => (v > 0 ? (Math.floor(v * 6) % 2 === 0 ? 1 : 0.15) : 1)
    this.arrowL.material.opacity = s * 0.7 * blink(this.flash[0])
    this.arrowR.material.opacity = s * 0.7 * blink(this.flash[1])
  }

  _reveal() {
    for (const t of this.texts) {
      gsap.fromTo(t.uniforms.uShow1, { value: 0 }, { value: 1, duration: 0.4, ease: 'none', overwrite: true })
      gsap.fromTo(t.uniforms.uShow2, { value: 0 }, { value: 1, duration: 0.75, ease: 'sine.out', overwrite: true })
    }
  }

  dispose() {
    for (const t of this.texts) t.dispose()
    for (const l of [this.bracket, this.arrowL, this.arrowR]) {
      l.geometry.dispose()
      l.material.dispose()
    }
    this._setHover(false)
  }
}

