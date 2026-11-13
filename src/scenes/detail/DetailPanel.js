import { Group, Mesh, LineSegments, BufferGeometry, BufferAttribute, LineBasicMaterial, ShaderMaterial, Vector3, Vector4, Color, Quaternion } from 'three'
import gsap from 'gsap'
import { bus } from '../../engine/Bus.js'
import { clamp, lerpFPS } from '../../engine/math.js'
import { MsdfText } from '../../text/MsdfText.js'
import { createTextMaterial } from '../../text/textMaterial.js'
import { PANEL, layoutPanel, chipText, panelMargin } from './panelLayout.js'
import { LabelPlate } from '../crystals/LabelParts.js'
import { audio, SOUNDS } from './audio.js'
import content from '../../content/content.js'

// Panel teks proyek (blueprint 5.4, skill ref 01 bagian 2.6 "QF"): hidup di scene UI (piksel CSS, y ke bawah
// negatif), jadi tidak kena transisi composite, cuma bloom. Scroll sendiri (wheel / drag, lerp 0.1), chip link
// [CV] [GH] ... buka tab baru. Huruf di bawah jejak mouse (sim detail) ter-scramble ulang.
//
// 26 Okt 2026, review pengunjung non-IT: panel lama satu esai panjang berhuruf 12.8 px. Sekarang (tata letak di
// panelLayout.js): kata section besar sebagai judul halaman, kalimat pembuka lebih besar, lalu blok-blok
// { label, lines }: label kecil kapital di bawah garis tipis, tiap baris jadi butir dengan kotak penanda kecil.
// Teks badan 17.5 px di 1024 (15.5 px di ponsel), kolom maks 640 px. Reveal tetap wipe + scramble igloo, tapi
// blok per blok dengan jeda pendek, jadi isi panjang tidak lambat muncul.

export { PANEL }

const COLORS = {
  heading: '#E8EEF5',
  lead: '#C9D2DD',
  body: '#AEB8C5',
  label: '#AFC2D6',
  chip: '#C9D2DD',
  chipHover: '#FFFFFF',
  rule: '#B4CDE0',
  marker: '#8FA9C0',
}
const RULE_ALPHA = 0.24
const MARKER_ALPHA = 0.95
const HEADING_BOLD = 0.06
const LABEL_BOLD = 0.05
const SHOW1 = { duration: 0.4, ease: 'none' }
const SHOW2 = { duration: 0.75, ease: 'sine.out' }

/**
 * Material teks MSDF bawaan + tambahan panel: sampling tSim di pusat glyph (layar), jejak memicu scramble
 * ulang dan menggeser warna ke abu terang, fade di tepi atas/bawah area scroll (uClip, pecahan buffer).
 */
function createPanelTextMaterial(font, color, shared, bold = 0) {
  const m = createTextMaterial(font, { color, bold })
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

/**
 * Garis blok + kotak penanda butir dalam satu mesh per blok. Warna + alpha per vertex, reveal = wipe kiri ke kanan
 * (aWipe = x / lebar kolom) mengikuti uShow, fade tepi area scroll sama dengan teks (uClip).
 */
function createShapesMaterial(shared) {
  return new ShaderMaterial({
    uniforms: { uShow: { value: 0 }, uResolution: shared.uResolution, uClip: shared.uClip },
    vertexShader: /* glsl */ `
attribute float aWipe;
attribute vec4 aColor;
varying float vWipe;
varying vec4 vColor;
void main() {
  vWipe = aWipe;
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform float uShow;
uniform vec2 uResolution;
uniform vec4 uClip;
varying float vWipe;
varying vec4 vColor;
void main() {
  float a = vColor.a * clamp((uShow * 1.25 - vWipe) / 0.25, 0.0, 1.0);
  float fy = gl_FragCoord.y / uResolution.y;
  a *= smoothstep(uClip.x, uClip.y, fy) * (1.0 - smoothstep(uClip.z, uClip.w, fy));
  if (a < 0.002) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
}

const _col = new Color()
const _center = new Vector3()
const _flat = new Quaternion()

/** Tulis ulang geometri mesh garis/penanda: quads = [{ x, y, w, h, color, alpha }] (y ke bawah, tepi atas). */
function writeQuads(mesh, quads, colW) {
  const n = quads.length
  const pos = new Float32Array(n * 12)
  const wipe = new Float32Array(n * 4)
  const color = new Float32Array(n * 16)
  const index = new Uint16Array(n * 6)
  quads.forEach((q, i) => {
    const x0 = q.x
    const x1 = q.x + q.w
    const y0 = -q.y
    const y1 = -(q.y + q.h)
    pos.set([x0, y1, 0, x1, y1, 0, x1, y0, 0, x0, y0, 0], i * 12)
    wipe.set([x0 / colW, x1 / colW, x1 / colW, x0 / colW], i * 4)
    _col.set(q.color)
    for (let c = 0; c < 4; c++) color.set([_col.r, _col.g, _col.b, q.alpha], (i * 4 + c) * 4)
    const a = i * 4
    index.set([a, a + 1, a + 2, a, a + 2, a + 3], i * 6)
  })
  mesh.geometry.dispose()
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  g.setAttribute('aWipe', new BufferAttribute(wipe, 1))
  g.setAttribute('aColor', new BufferAttribute(color, 4))
  g.setIndex(new BufferAttribute(index, 1))
  mesh.geometry = g
}

const ruleQuad = (y, colW) => ({ x: 0, y, w: colW, h: 1, color: COLORS.rule, alpha: RULE_ALPHA })

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
    // jalur baca gelap di belakang kolom, diam di layar (bukan anak content, jadi tidak ikut scroll)
    this.lane = new LabelPlate(PANEL.lane.color)
    this.lane.renderOrder = -1
    this.laneShow = { value: 0 }
    this.add(this.lane)
    this.content = new Group()
    this.add(this.content)
    this.heading = this._text(COLORS.heading, 31, HEADING_BOLD)
    this.lead = this._text(COLORS.lead, 32)
    // blok isi (dibuat sesuai kebutuhan, dipakai ulang antar proyek): { label, items[], shapes }
    this.blocks = []
    // blok link di akhir: label LINKS + garis, chip, panah
    this.linkBlock = { label: this._text(COLORS.label, 33, LABEL_BOLD), items: [], shapes: this._shapes() }
    this.chips = []
    this.arrows = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: new Color(COLORS.chip), transparent: true, depthTest: false, depthWrite: false }))
    this.arrows.frustumCulled = false
    this.content.add(this.arrows)
    this.project = null
    this.L = null // hasil layoutPanel terakhir
    this.width = 1
    this.height = 1
    this.colX = 0
    this.colW = PANEL.maxWidth
    this.scrollY = 0
    this.scrollTarget = 0
    this.scrollMax = 0
    this.chipRects = []
    this.shown = false
    this.hoverChip = -1
    this.tl = null
    this.visible = false
    this._bind()
  }

  _text(color, seed, bold = 0) {
    const t = new MsdfText(this.font, { material: createPanelTextMaterial(this.font, color, this.shared, bold), seed })
    t.uniforms.uShow1.value = 0
    t.frustumCulled = false
    this.content.add(t)
    return t
  }

  _shapes() {
    const m = new Mesh(new BufferGeometry(), createShapesMaterial(this.shared))
    m.frustumCulled = false
    this.content.add(m)
    return m
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

  /**
   * Precompile material panel (dipanggil sekali sesudah panel ditambahkan ke scene UI). Semua proyek diisi dulu
   * supaya kolam mesh butir/label/chip sudah lengkap sebelum detail pertama dibuka (dulu buka pertama tersendat
   * sekitar 300 ms: puluhan material baru + program yang belum ada). Compile memakai render target UI karena
   * varian program three ikut ruang warna target (kanvas sRGB vs RT UI linear).
   */
  async compile(renderer, camera, scene) {
    const saved = this.visible
    for (const p of content.projects) this.setProject(p, { a11y: false })
    this.project = null
    this.visible = true
    const meshes = this._meshes(true)
    const flags = meshes.map((m) => m.visible)
    const shapes = [...this.blocks, this.linkBlock].map((b) => b.shapes)
    const shapeFlags = shapes.map((m) => m.visible)
    for (const m of meshes) {
      m.visible = true
      m.uniforms.uShow1.value = 1
    }
    for (const m of shapes) m.visible = true
    const prev = renderer.getRenderTarget()
    if (this.engine?.uiRT) renderer.setRenderTarget(this.engine.uiRT)
    await renderer.compileAsync(scene, camera)
    renderer.setRenderTarget(prev)
    meshes.forEach((m, i) => {
      m.visible = flags[i]
      m.uniforms.uShow1.value = 0
    })
    shapes.forEach((m, i) => (m.visible = shapeFlags[i]))
    this.visible = saved
  }

  /** Semua mesh teks panel (all = termasuk yang tidak dipakai proyek ini). */
  _meshes(all = false) {
    const list = [this.heading, this.lead]
    for (const b of [...this.blocks, this.linkBlock]) list.push(b.label, ...b.items)
    list.push(...this.chips)
    return all ? list : list.filter((m) => m.visible)
  }

  _shapeMeshes() {
    return [...this.blocks, this.linkBlock].map((b) => b.shapes).filter((m) => m.visible)
  }

  /** Isi panel dari objek proyek content.js (heading, summary, blocks, links). a11y false = tanpa cermin DOM. */
  setProject(project, { a11y = true } = {}) {
    this.project = project
    this.heading.setText(project.heading || project.title || '')
    this.lead.setText(project.summary || '')
    const blocks = project.blocks || []
    while (this.blocks.length < blocks.length) {
      const i = this.blocks.length
      this.blocks.push({ label: this._text(COLORS.label, 40 + i, LABEL_BOLD), items: [], shapes: this._shapes() })
    }
    this.blocks.forEach((g, i) => {
      const b = blocks[i]
      const on = !!b
      g.label.visible = g.shapes.visible = on
      const lines = on ? b.lines || [] : []
      while (g.items.length < lines.length) g.items.push(this._text(COLORS.body, 100 + i * 10 + g.items.length))
      g.items.forEach((t, k) => {
        t.visible = k < lines.length
        if (t.visible) t.setText(lines[k])
      })
      if (on) g.label.setText(b.label || '')
    })
    const links = project.links || []
    const lb = this.linkBlock
    lb.label.visible = lb.shapes.visible = links.length > 0
    lb.label.setText(PANEL.linksLabel)
    while (this.chips.length < links.length) this.chips.push(this._text(COLORS.chip, 80 + this.chips.length))
    this.chips.forEach((c, i) => {
      c.visible = i < links.length
      if (c.visible) c.setText(chipText(links[i]))
    })
    this.scrollY = this.scrollTarget = 0
    this.layout()
    if (a11y) this._writeA11y()
  }

  resize(width, height) {
    this.width = width
    this.height = height
    // fade tepi area scroll: tak terlihat di luar 65 px, penuh mulai 130 px dari tepi (layar pendek lebih kecil)
    const H = height
    const m = panelMargin(H)
    this.shared.uClip.value.set(m / H, (2 * m) / H, 1 - (2 * m) / H, 1 - m / H)
    this.layout()
  }

  /** Pasang satu mesh teks dari elemen layout (y ke bawah). */
  _place(mesh, o) {
    mesh.relayout({
      size: o.size,
      lineHeight: o.lineHeight ?? this.font.lineHeight,
      letterSpacing: o.letterSpacing ?? 0,
      maxWidth: o.maxWidth ?? Infinity,
      align: 'left',
    })
    mesh.position.set(o.x, -o.y, 0)
  }

  layout() {
    if (!this.project) return
    const L = (this.L = layoutPanel(this.font, this.project, this.width, this.height))
    this.colW = L.colW
    this.colX = L.colX
    this._place(this.heading, L.heading)
    this._place(this.lead, L.lead)
    L.blocks.forEach((b, i) => {
      const g = this.blocks[i]
      this._place(g.label, b.label)
      const quads = [ruleQuad(b.ruleY, L.colW)]
      b.items.forEach((it, k) => {
        this._place(g.items[k], it)
        const mk = it.marker
        quads.push({ x: mk.x, y: mk.y, w: mk.size, h: mk.size, color: COLORS.marker, alpha: MARKER_ALPHA })
      })
      writeQuads(g.shapes, quads, L.colW)
    })
    // blok link: label + garis, chip berjajar (pindah baris kalau penuh), panah serong kanan atas tiap chip
    const arrows = []
    this.chipRects = []
    const lk = L.links
    if (lk) {
      this._place(this.linkBlock.label, lk.label)
      writeQuads(this.linkBlock.shapes, [ruleQuad(lk.ruleY, L.colW)], L.colW)
      lk.chips.forEach((c, i) => {
        this._place(this.chips[i], { x: c.x, y: c.y, size: c.size })
        const { x: ax, size: a } = c.arrow
        const ay = -c.arrow.y // baseline
        // batang + dua kaki di ujung
        arrows.push(ax, ay, 0, ax + a, ay + a, 0)
        arrows.push(ax + a * 0.35, ay + a, 0, ax + a, ay + a, 0)
        arrows.push(ax + a, ay + a * 0.35, 0, ax + a, ay + a, 0)
        this.chipRects.push(c.rect)
      })
    }
    this.arrows.geometry.dispose()
    this.arrows.geometry = new BufferGeometry()
    this.arrows.geometry.setAttribute('position', new BufferAttribute(new Float32Array(arrows), 3))
    this.scrollMax = L.scrollMax
    this.scrollTarget = clamp(this.scrollTarget, 0, this.scrollMax)
    this.content.position.x = this.colX
    const ln = L.lane
    _center.set(ln.x + ln.w / 2, -this.height / 2, 0)
    // tinggi melebihi layar: tepi lembut atas/bawah di luar layar, yang terlihat cuma tepi kiri/kanan
    this.lane.set(_center, _flat, ln.w, this.height + 4 * PANEL.lane.soft, PANEL.lane.soft, PANEL.lane.soft * 0.5, 1)
  }

  /**
   * Reveal blok per blok: judul, kalimat pembuka, lalu tiap blok (label + semua butir + garis) mulai bersamaan
   * dengan jeda antar blok pendek. Tiap mesh tetap uShow1 0.4 s + uShow2 0.75 s sine.out (wipe + scramble igloo).
   */
  show({ instant = false } = {}) {
    this.tl?.kill()
    this.shown = true
    this.visible = true
    this._a11yHidden(false)
    const meshes = this._meshes()
    const shapes = this._shapeMeshes()
    if (instant) {
      for (const m of meshes) m.uniforms.uShow1.value = m.uniforms.uShow2.value = 1
      for (const s of shapes) s.material.uniforms.uShow.value = 1
      this.arrows.material.opacity = 1
      this.laneShow.value = 1
      return
    }
    const P = PANEL
    const tl = gsap.timeline()
    tl.to(this.laneShow, { value: 1, duration: 0.6, ease: 'power2.out' }, 0)
    const add = (list, shape, at) => {
      list.forEach((m, k) => {
        const t = at + k * P.revealItem
        tl.fromTo(m.uniforms.uShow1, { value: 0 }, { value: 1, ...SHOW1 }, t)
        tl.fromTo(m.uniforms.uShow2, { value: 0 }, { value: 1, ...SHOW2 }, t)
      })
      if (shape?.visible) tl.fromTo(shape.material.uniforms.uShow, { value: 0 }, { value: 1, duration: 0.45, ease: 'power2.out' }, at)
    }
    add([this.heading], null, P.revealHeading)
    add([this.lead], null, P.revealLead)
    const groups = this.blocks.filter((g) => g.label.visible)
    groups.forEach((g, i) => add([g.label, ...g.items.filter((t) => t.visible)], g.shapes, P.revealBlocks + i * P.revealStagger))
    const lb = this.linkBlock
    const at = P.revealBlocks + groups.length * P.revealStagger
    if (lb.label.visible) add([lb.label, ...this.chips.filter((c) => c.visible)], lb.shapes, at)
    tl.fromTo(this.arrows.material, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'none' }, at + 0.2)
    this.tl = tl
  }

  /** Sembunyikan cepat (0.3 s), lalu panel tidak dirender. */
  hide() {
    this.tl?.kill()
    this.shown = false
    this._setHover(-1)
    this._a11yHidden(true)
    const tl = gsap.timeline({ onComplete: () => (this.visible = false) })
    for (const m of this._meshes()) {
      tl.to(m.uniforms.uShow1, { value: 0, duration: 0.3, ease: 'none' }, 0)
      tl.to(m.uniforms.uShow2, { value: 0, duration: 0.3, ease: 'none' }, 0)
    }
    for (const s of this._shapeMeshes()) tl.to(s.material.uniforms.uShow, { value: 0, duration: 0.3, ease: 'none' }, 0)
    tl.to(this.arrows.material, { opacity: 0, duration: 0.3, ease: 'none' }, 0)
    tl.to(this.laneShow, { value: 0, duration: 0.3, ease: 'none' }, 0)
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
    if (prev) prev.uniforms.uColor.value.set(COLORS.chip)
    this.hoverChip = i
    this.engine?.setCursor('detail_chip', i >= 0)
    const chip = this.chips[i]
    if (!chip) return
    chip.uniforms.uColor.value.set(COLORS.chipHover)
    // hover = scramble ulang label + bunyi pendek (igloo: "ui-short")
    gsap.fromTo(chip.uniforms.uShow2, { value: 0 }, { value: 1, ...SHOW2 })
    audio.play(SOUNDS.uiShort)
  }

  /**
   * Cermin DOM tersembunyi (pembaca layar, SEO): section sendiri di <main id="a11y">. Judul = h2 (h1 dipakai
   * nama situs di UIScene), label blok = h3, tiap baris = li, link = a sungguhan. Disembunyikan saat panel tutup.
   */
  _writeA11y() {
    if (typeof document === 'undefined') return
    const main = document.getElementById('a11y')
    const p = this.project
    if (!main || !p) return
    let sec = main.querySelector('section[data-detail]')
    if (!sec) {
      sec = document.createElement('section')
      sec.dataset.detail = ''
      main.append(sec)
    }
    sec.replaceChildren()
    const add = (parent, tag, text) => {
      const el = document.createElement(tag)
      if (text) el.textContent = text
      parent.append(el)
      return el
    }
    add(sec, 'h2', p.heading || p.title)
    if (p.summary) add(sec, 'p', p.summary)
    for (const b of p.blocks || []) {
      add(sec, 'h3', b.label)
      const ul = add(sec, 'ul')
      for (const line of b.lines || []) add(ul, 'li', line)
    }
    const links = (p.links || []).filter((l) => l.url)
    if (links.length) {
      add(sec, 'h3', PANEL.linksLabel)
      const ul = add(sec, 'ul')
      for (const l of links) {
        const a = add(add(ul, 'li'), 'a', l.label)
        a.href = l.url
        a.target = '_blank'
        a.rel = 'noopener'
        a.title = l.url
      }
    }
    sec.hidden = !this.shown
  }

  _a11yHidden(hidden) {
    if (typeof document === 'undefined') return
    const sec = document.querySelector('#a11y section[data-detail]')
    if (sec) sec.hidden = hidden
  }

  update(ratio) {
    if (!this.visible) return
    this.lane.material.uniforms.uAlpha.value = this.laneShow.value * PANEL.lane.alpha
    this.scrollY = lerpFPS(this.scrollY, this.scrollTarget, PANEL.scrollLerp, ratio)
    if (Math.abs(this.scrollY - this.scrollTarget) < 0.01) this.scrollY = this.scrollTarget
    this.content.position.y = this.scrollY
  }
}
