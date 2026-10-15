import { Group, LineSegments, BufferGeometry, BufferAttribute, LineBasicMaterial, Vector4, Color } from 'three'
import gsap from 'gsap'
import { bus } from '../../engine/Bus.js'
import { clamp, lerpFPS } from '../../engine/math.js'
import { MsdfText } from '../../text/MsdfText.js'
import { createTextMaterial } from '../../text/textMaterial.js'
import { UI_BREAKPOINTS, uiBreakpoint } from '../ui/layout.js'
import { audio, SOUNDS } from './audio.js'

// Panel teks proyek (blueprint 5.4, skill ref 01 bagian 2.6 "QF"): hidup di scene UI (piksel CSS, y ke bawah
// negatif), jadi tidak kena transisi composite, cuma bloom. Kolom lebar min(lebarLayar - 40, 500) px di tengah,
// scroll sendiri (wheel / drag, lerp 0.1, scrollMax = max(0, tinggiKonten - (tinggiLayar - 65 * 4))),
// chip link [X] [IG] [LI] [TK] buka tab baru. Huruf di bawah jejak mouse (sim detail) ter-scramble ulang.
// Jarak antar blok DIUKUR dari ref 08 (800 x 600, breakpoint small, teks 12.8 px di 1024).

export const PANEL = {
  maxWidth: 500,
  sideGap: 40,
  margin: 65, // tepi atas/bawah area scroll = 2 x 65, fade di 65..130
  lineHeight: 1.4,
  bodyBelowHeading: 3.6, // em, baseline ke baseline (ref 08: 36 px di 800 lebar)
  headingBelowBody: 3.7,
  chipsBelowHeading: 3.5,
  chipGap: 2, // em antar chip
  arrowGap: 0.55, // em antara label chip dan panah
  arrowSize: 0.62, // em
  scrollLerp: 0.1,
  stagger: 0.12,
}

const COLOR_HEADING = '#67707E' // judul proyek igloo (forensik 9.2)
const COLOR_TEXT = '#A1AAB7' // teks proyek igloo
const COLOR_CHIP_HOVER = '#dfe6f0'
const SHOW1 = { duration: 0.4, ease: 'none' }
const SHOW2 = { duration: 0.75, ease: 'sine.out' }

/**
 * Material teks MSDF bawaan + tambahan panel: sampling tSim di pusat glyph (layar), jejak memicu scramble
 * ulang dan menggeser warna ke abu terang, fade di tepi atas/bawah area scroll (uClip, pecahan buffer).
 */
function createPanelTextMaterial(font, color, shared) {
  const m = createTextMaterial(font, { color })
  Object.assign(m.uniforms, shared)
  m.vertexShader = m.vertexShader
    .replace('varying float vShow;', `varying float vShow;
uniform sampler2D tSim;
uniform float uTime;
varying float vTrail;
float panelHash(float n) { return fract(sin(n) * 43758.5453); }`)
    .replace('float k = floor((1.0 - settle) * 5.753) * uScramble;', `float k = floor((1.0 - settle) * 5.753) * uScramble;
  // jejak mouse di pusat glyph: scramble ulang lokal, glyph berganti acak sekitar 14 kali per detik
  vec4 gclip = projectionMatrix * modelViewMatrix * vec4(aPen.xy + vec2(0.3, 0.35) * aPen.w, 0.0, 1.0);
  vec2 sim = textureLod(tSim, gclip.xy / gclip.w * 0.5 + 0.5, 0.0).rg;
  vTrail = sim.r;
  float tick = floor(uTime * 14.0);
  // ambang minimal 0.02: hash fract(sin) float32 sering tepat 0, tanpa ambang glyph tanpa jejak ikut ter-scramble
  float hit = step(0.02 + 0.98 * panelHash(aText.w * 91.7 + tick * 1.37), sim.r * 1.6 + sim.g * 8.0);
  k = max(k, hit * (1.0 + mod(tick + floor(aText.w * 23.0), 4.0)));`)
  m.fragmentShader = m.fragmentShader
    .replace('varying float vShow;', `varying float vShow;
uniform vec2 uResolution;
uniform vec4 uClip; // (bawah0, bawah1, atas1, atas0) pecahan tinggi buffer dari bawah
varying float vTrail;`)
    .replace(`if (alpha < 0.002) discard;
  gl_FragColor = vec4(uColor, alpha);`, `float fy = gl_FragCoord.y / uResolution.y;
  alpha *= smoothstep(uClip.x, uClip.y, fy) * (1.0 - smoothstep(uClip.z, uClip.w, fy));
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(mix(uColor, vec3(0.8), clamp(vTrail, 0.0, 1.0) * 0.6), alpha);`)
  if (!m.vertexShader.includes('vTrail = sim.r') || !m.fragmentShader.includes('uClip.x')) {
    throw new Error('DetailPanel: patch shader teks gagal, cek src/text/textMaterial.js')
  }
  return m
}

export class DetailPanel extends Group {
  /**
   * @param {import('../../text/MsdfFont.js').MsdfFont} font
   * @param {{value: import('three').Texture}} simUniform tekstur sim mouse detail (MouseSim.uniform)
   * @param {object} globals uniform global engine (uTime, uResolution)
   */
  constructor(font, simUniform, globals, engine) {
    super()
    this.name = 'detail_panel'
    this.font = font
    this.engine = engine
    this.shared = { tSim: simUniform, uTime: globals.uTime, uResolution: globals.uResolution, uClip: { value: new Vector4(0, 0.1, 0.9, 1) } }
    const mk = (color, seed) => new MsdfText(font, { material: createPanelTextMaterial(font, color, this.shared), seed })
    this.heading = mk(COLOR_HEADING, 31)
    this.body = mk(COLOR_TEXT, 32)
    this.discover = mk(COLOR_HEADING, 33)
    this.chips = []
    this.arrows = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: new Color(COLOR_TEXT), transparent: true, depthTest: false, depthWrite: false }))
    this.arrows.frustumCulled = false
    this.content = new Group()
    this.content.add(this.heading, this.body, this.discover, this.arrows)
    this.add(this.content)
    this.project = null
    this.width = 1
    this.height = 1
    this.colX = 0
    this.colW = PANEL.maxWidth
    this.contentH = 0
    this.scrollY = 0
    this.scrollTarget = 0
    this.scrollMax = 0
    this.shown = false
    this.hoverChip = -1
    this.tl = null
    this.visible = false
    this._bind()
  }

  _bind() {
    bus.on('resize', ({ width, height }) => this.resize(width, height))
    bus.on('wheel', ({ deltaY, pinch }) => {
      if (this.shown && !pinch) this.scrollTarget = clamp(this.scrollTarget + deltaY, 0, this.scrollMax)
    })
    bus.on('touch_drag', (d01) => {
      if (this.shown) this.scrollTarget = clamp(this.scrollTarget + d01.y * this.height, 0, this.scrollMax)
    })
    bus.on('pointer_move', (input) => this._hover(input.position))
    bus.on('click', (input) => {
      if (!this.shown) return
      const i = this.hitChip(input.position.x, input.position.y)
      if (i >= 0) this.openLink(i)
    })
  }

  /** Precompile material panel (dipanggil sekali sesudah panel ditambahkan ke scene UI). */
  async compile(renderer, camera, scene) {
    const saved = this.visible
    this.visible = true
    for (const m of this._meshes()) m.uniforms.uShow1.value = 1
    await renderer.compileAsync(scene, camera)
    for (const m of this._meshes()) m.uniforms.uShow1.value = 0
    this.visible = saved
  }

  _meshes() {
    return [this.heading, this.body, this.discover, ...this.chips]
  }

  /** Isi panel dari objek proyek content.js. */
  setProject(project) {
    this.project = project
    this.heading.setText(project.panelHeading || '////// Summary')
    this.body.setText((project.description || [project.summary || '']).join('\n\n'))
    this.discover.setText(project.discoverHeading || '/// Discover')
    const links = project.links || []
    while (this.chips.length < links.length) {
      const chip = new MsdfText(this.font, { material: createPanelTextMaterial(this.font, COLOR_TEXT, this.shared), seed: 40 + this.chips.length })
      chip.uniforms.uShow1.value = 0
      this.chips.push(chip)
      this.content.add(chip)
    }
    this.chips.forEach((c, i) => {
      c.visible = i < links.length
      if (i < links.length) c.setText(`[${links[i].label}]`)
    })
    this.scrollY = this.scrollTarget = 0
    this.layout()
  }

  resize(width, height) {
    this.width = width
    this.height = height
    // fade tepi area scroll: tak terlihat di luar 65 px, penuh mulai 130 px dari tepi
    const H = height
    const m = PANEL.margin
    this.shared.uClip.value.set(m / H, (2 * m) / H, 1 - (2 * m) / H, 1 - m / H)
    this.layout()
  }

  layout() {
    if (!this.project) return
    const fs = UI_BREAKPOINTS[uiBreakpoint(this.width, this.height)].text
    const f = this.font
    const lh = PANEL.lineHeight
    this.colW = Math.min(this.width - PANEL.sideGap, PANEL.maxWidth)
    this.colX = Math.round((this.width - this.colW) / 2)
    const top = 2 * PANEL.margin
    const opts = { size: fs, lineHeight: lh, maxWidth: this.colW }
    let y = top + f.ascender * fs // baseline baris pertama (y ke bawah)
    this.heading.relayout(opts)
    this.heading.position.set(0, -y, 0)
    y += PANEL.bodyBelowHeading * fs
    this.body.relayout(opts)
    this.body.position.set(0, -y, 0)
    y += (this.body.layout.lineCount - 1) * lh * fs + PANEL.headingBelowBody * fs
    this.discover.relayout(opts)
    this.discover.position.set(0, -y, 0)
    y += PANEL.chipsBelowHeading * fs
    // chip: label + panah, berjajar, lebar dari layout
    const arrows = []
    const a = PANEL.arrowSize * fs
    let x = 0
    this.chipRects = []
    this.chips.forEach((c) => {
      if (!c.visible) return
      c.relayout({ size: fs, lineHeight: lh, maxWidth: Infinity })
      c.position.set(x, -y, 0)
      const ax = x + c.layout.width + PANEL.arrowGap * fs
      const ay = -y // baseline
      // panah serong kanan atas: batang + dua kaki di ujung
      arrows.push(ax, ay, 0, ax + a, ay + a, 0)
      arrows.push(ax + a * 0.35, ay + a, 0, ax + a, ay + a, 0)
      arrows.push(ax + a, ay + a * 0.35, 0, ax + a, ay + a, 0)
      const capTop = y - f.capHeight * fs
      this.chipRects.push({ x0: x - 6, x1: ax + a + 6, y0: capTop - 8, y1: y + 8 })
      x = ax + a + PANEL.chipGap * fs
    })
    this.arrows.geometry.setAttribute('position', new BufferAttribute(new Float32Array(arrows), 3))
    this.arrows.geometry.computeBoundingSphere()
    this.contentH = y + 3 * fs - top + 2 * PANEL.margin
    this.scrollMax = Math.max(0, this.contentH - (this.height - PANEL.margin * 4))
    this.scrollTarget = clamp(this.scrollTarget, 0, this.scrollMax)
    this.content.position.x = this.colX
  }

  /** Reveal berurutan: heading, isi, discover, chip (uShow1 0.4 s + uShow2 0.75 s sine.out). */
  show({ instant = false } = {}) {
    this.tl?.kill()
    this.shown = true
    this.visible = true
    const meshes = this._meshes().filter((m) => m.visible)
    if (instant) {
      for (const m of meshes) m.uniforms.uShow1.value = m.uniforms.uShow2.value = 1
      this.arrows.material.opacity = 1
      return
    }
    const tl = gsap.timeline()
    meshes.forEach((m, i) => {
      tl.fromTo(m.uniforms.uShow1, { value: 0 }, { value: 1, ...SHOW1 }, i * PANEL.stagger)
      tl.fromTo(m.uniforms.uShow2, { value: 0 }, { value: 1, ...SHOW2 }, i * PANEL.stagger)
    })
    tl.fromTo(this.arrows.material, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'none' }, meshes.length * PANEL.stagger)
    this.tl = tl
  }

  /** Sembunyikan cepat (0.3 s), lalu panel tidak dirender. */
  hide() {
    this.tl?.kill()
    this.shown = false
    this._setHover(-1)
    const tl = gsap.timeline({ onComplete: () => (this.visible = false) })
    for (const m of this._meshes()) {
      tl.to(m.uniforms.uShow1, { value: 0, duration: 0.3, ease: 'none' }, 0)
      tl.to(m.uniforms.uShow2, { value: 0, duration: 0.3, ease: 'none' }, 0)
    }
    tl.to(this.arrows.material, { opacity: 0, duration: 0.3, ease: 'none' }, 0)
    this.tl = tl
  }

  /** Indeks chip di titik (x, y) piksel CSS (y ke bawah), -1 kalau tidak ada. */
  hitChip(x, y) {
    if (!this.chipRects) return -1
    const lx = x - this.colX
    const ly = y + this.scrollY
    return this.chipRects.findIndex((r) => lx >= r.x0 && lx <= r.x1 && ly >= r.y0 && ly <= r.y1)
  }

  openLink(i) {
    const link = this.project?.links?.[i]
    if (!link || !link.url) return false
    window.open(link.url, '_blank', 'noopener')
    return true
  }

  _hover(pos) {
    this._setHover(this.shown ? this.hitChip(pos.x, pos.y) : -1)
  }

  _setHover(i) {
    if (i === this.hoverChip) return
    const prev = this.chips[this.hoverChip]
    if (prev) prev.uniforms.uColor.value.set(COLOR_TEXT)
    this.hoverChip = i
    this.engine?.setCursor('detail_chip', i >= 0)
    const chip = this.chips[i]
    if (!chip) return
    chip.uniforms.uColor.value.set(COLOR_CHIP_HOVER)
    // hover = scramble ulang label + bunyi pendek (igloo: "ui-short")
    gsap.fromTo(chip.uniforms.uShow2, { value: 0 }, { value: 1, ...SHOW2 })
    audio.play(SOUNDS.uiShort)
  }

  update(ratio) {
    if (!this.visible) return
    this.scrollY = lerpFPS(this.scrollY, this.scrollTarget, PANEL.scrollLerp, ratio)
    if (Math.abs(this.scrollY - this.scrollTarget) < 0.01) this.scrollY = this.scrollTarget
    this.content.position.y = this.scrollY
  }
}
