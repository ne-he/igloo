import { Raycaster, Vector2, Vector3, Matrix4, Ray, Sphere, DoubleSide } from 'three'
import { MeshBVH } from 'three-mesh-bvh'
import { bus } from '../../engine/Bus.js'
import { assignFacts } from './facts.js'

// Fakta di bata igloo: hover (mouse) atau tap (sentuh) satu bata, bata itu melayang sedikit (Bricks.hovered,
// HOVER_LIFT) dan label MSDF pendek muncul di scene UI (src/scenes/ui/FactLabel.js).
// Bicara ke UI lewat bus, sama seperti scene lain:
//   'igloo_fact' { index, text, anchor, camera }  anchor = Vector3 hidup (b.anchor), diproyeksikan UI tiap frame
//   'igloo_fact' null                              label pudar
// Raycast: bola pembatas per bata dulu, lalu BVH per geometri bata (three-mesh-bvh, mode indirect supaya
// index geometri tidak diubah) di ruang lokal bata. Hanya aktif di sekitar titik istirahat igloo, tidak
// saat intro, tidak saat detail proyek terbuka.

export const FACTS = {
  rest: 0.495, // progress titik istirahat igloo
  restWindow: 0.05, // label hanya hidup kalau |progress - rest| di bawah ini (kira-kira 0.17 unit scroll)
  switchDelay: 0.08, // detik, kursor bergerak: bata baru harus kena terus selama ini sebelum label pindah
  leaveDelay: 0.25, // detik, kursor menjauh dari bata berlabel: label dilepas setelah ini
  // Kursor diam tapi bata di bawahnya berganti (parallax kamera + dorongan mouse bata tetangga masih jalan
  // sekitar 1.5 s sesudah kursor berhenti): label ditahan selama ini sebelum pindah, supaya tidak reveal ulang
  // terus. Kursor dianggap diam kalau tidak ada pointer_move selama moveWindow, dan masih dekat kalau sinar
  // lewat dalam nearRadius x jari-jari bata berlabel (diam + dekat = label ditahan tanpa batas).
  holdDelay: 1.2,
  moveWindow: 0.15,
  nearRadius: 1.6,
  tapHold: 4, // detik, label hasil tap di layar sentuh bertahan selama ini
  neighbors: 6, // k tetangga terdekat untuk pembagian fakta
}

const _ray = new Ray()
const _sphere = new Sphere()
const _mat = new Matrix4()
const _inv = new Matrix4()
const _c = new Vector3()
const _one = new Vector3(1, 1, 1)

export class BrickFacts {
  /**
   * @param {object} o
   * @param {import('../../engine/Engine.js').Engine} o.engine
   * @param {import('./Bricks.js').Bricks} o.bricks
   * @param {string[]} o.facts daftar fakta (content.js iglooFacts)
   * @param {import('three').Camera} o.camera kamera scene igloo
   */
  constructor({ engine, bricks, facts, camera }) {
    this.engine = engine
    this.bricks = bricks
    this.facts = facts || []
    this.camera = camera
    this.raycaster = new Raycaster()
    this.current = -1 // bata yang labelnya tampil
    this._pending = -1
    this._pendingTime = 0
    this._leaveTime = 0
    this._sinceMove = Infinity // detik sejak pointer_move mouse terakhir
    this._tap = null // posisi -1..1 tap sentuh yang belum diproses
    this._tapTime = 0
    this._pointerSeen = false // sebelum mouse pertama kali bergerak, position11 = tengah layar (bukan hover)
    this._pointerInside = true

    const list = bricks.bricks
    this.assignment = assignFacts(list.map((b) => b.centroid), this.facts.length, { k: FACTS.neighbors })
    for (const b of list) b.bvh = new MeshBVH(b.geometry, { indirect: true })

    bus.on('pointer_move', (input) => {
      if (input.pointerType === 'mouse') {
        this._pointerSeen = true
        this._sinceMove = 0
      }
      this._pointerInside = true
    })
    bus.on('click', (input) => {
      if (input.pointerType !== 'mouse') this._tap = input.position11.clone()
    })
    const el = engine?.renderer?.domElement
    el?.addEventListener('pointerleave', () => (this._pointerInside = false))
    this.writeA11y()
  }

  factOf(index) {
    const f = this.assignment[index]
    return f >= 0 ? this.facts[f] : null
  }

  /** Boleh hover sekarang? Scene di titik istirahat, intro dan UI sudah selesai, detail tertutup. */
  enabled(progress) {
    const e = this.engine
    if (!this.facts.length || !this.bricks.mesh.visible) return false
    if (e?.intro?.running) return false
    if (e?.ui && !e.ui.introStarted) return false
    if (e?.ui?.detailMode) return false
    if (e?.detail && e.composite.uniforms.uDetailProgress.value > 0) return false
    return Math.abs(progress - FACTS.rest) < FACTS.restWindow
  }

  update(frame, progress) {
    const dt = Math.min(0.1, (frame.delta || 16.667) / 1000)
    if (!this.enabled(progress)) {
      this._tap = null
      this._tapTime = 0
      this._set(-1)
      return
    }

    const input = frame.input
    if (input.pointerType === 'mouse') {
      // mouse: hover tiap frame (bata dan kamera terus bergerak walau kursor diam)
      const live = this._pointerSeen && this._pointerInside
      const hit = live ? this.pick(input.position11) : -1
      const near = live && hit !== this.current && this._nearCurrent()
      this._hover(hit, near, this._sinceMove < FACTS.moveWindow, dt)
      this._sinceMove += dt
    } else {
      // sentuh: tap = tampilkan fakta bata itu beberapa detik, tap di luar bata = lepas
      if (this._tap) {
        const hit = this.pick(this._tap)
        this._tap = null
        this._tapTime = hit >= 0 ? FACTS.tapHold : 0
        this._set(hit)
      } else if (this.current >= 0) {
        this._tapTime -= dt
        if (this._tapTime <= 0) this._set(-1)
      }
    }
  }

  /**
   * Mouse. hit = bata di bawah kursor, near = sinar masih dekat bata berlabel, moving = kursor baru bergerak.
   * Kursor pindah ke bata lain: label ikut setelah switchDelay. Kursor diam dan masih dekat bata berlabel
   * (kamera parallax dan bata tetangga tetap bergerak sesudah kursor berhenti): label ditahan terus.
   * Diam tapi sudah jauh dari bata berlabel: pindah/lepas setelah holdDelay. Kursor menjauh: lepas setelah leaveDelay.
   */
  _hover(hit, near, moving, dt) {
    if (hit === this.current) {
      this._pending = -1
      this._leaveTime = 0
      return
    }
    if (hit >= 0 && (this.current < 0 || moving)) {
      if (hit !== this._pending) {
        this._pending = hit
        this._pendingTime = 0
      }
      this._pendingTime += dt
      if (this._pendingTime >= FACTS.switchDelay) {
        this._pending = -1
        this._set(hit)
      }
      return
    }
    this._pending = -1
    if (this.current < 0) return
    if (near && !moving) {
      this._leaveTime = 0
      return
    }
    this._leaveTime += dt
    if (this._leaveTime >= (hit >= 0 || near ? FACTS.holdDelay : FACTS.leaveDelay)) this._set(hit)
  }

  // sinar terakhir (pick) lewat dekat bata berlabel, di posisi sekarang atau posisi dasarnya?
  _nearCurrent() {
    if (this.current < 0) return false
    const b = this.bricks.bricks[this.current]
    const ray = this.raycaster.ray
    const world = this.bricks.mesh.matrixWorld
    const r = b.radius * FACTS.nearRadius
    return ray.distanceToPoint(_c.copy(b.position).applyMatrix4(world)) < r
      || ray.distanceToPoint(_c.copy(b.basePosition).applyMatrix4(world)) < r
  }

  _set(index) {
    this._leaveTime = 0
    if (index === this.current) return
    this.current = index
    this.bricks.hovered = index
    if (index < 0) {
      bus.emit('igloo_fact', null)
      return
    }
    const b = this.bricks.bricks[index]
    bus.emit('igloo_fact', { index, text: this.factOf(index), anchor: b.anchor, camera: this.camera })
    // bunyi label muncul, sama dengan label kristal (Audio.js menjaga jeda minimal antar beep)
    bus.emit('audio_play', { name: 'beeps' })
  }

  /** Lepas label sekarang juga (scene igloo disembunyikan). */
  clear() {
    this._tap = null
    this._pending = -1
    this._set(-1)
  }

  /**
   * Bata terdepan di bawah titik layar p11 (-1..1), -1 kalau tidak ada. Bata yang sedang tampil labelnya
   * menang selama sinar masih mengenainya di mana pun (posisi angkat atau posisi dasar), jadi label tidak
   * melompat ke bata di depannya yang cuma bergeser sedikit.
   */
  pick(p11) {
    const list = this.bricks.bricks
    const world = this.bricks.mesh.matrixWorld
    this.raycaster.setFromCamera(p11 instanceof Vector2 ? p11 : new Vector2(p11.x, p11.y), this.camera)
    const ray = this.raycaster.ray
    let best = -1
    let bestDist = Infinity
    for (const b of list) {
      let d = this._castBrick(ray, b, b.position, world)
      if (b.index === this.current && d < 0) d = this._castBrick(ray, b, b.basePosition, world)
      if (d < 0) continue
      if (b.index === this.current) return b.index
      if (d < bestDist) {
        bestDist = d
        best = b.index
      }
    }
    return best
  }

  // jarak sinar ke bata di posisi `pos` (dunia), -1 kalau meleset
  _castBrick(ray, b, pos, world) {
    _c.copy(pos).applyMatrix4(world)
    _sphere.set(_c, b.radius)
    if (!ray.intersectsSphere(_sphere)) return -1
    _mat.compose(pos, b.quaternion, _one).premultiply(world)
    _inv.copy(_mat).invert()
    _ray.copy(ray).applyMatrix4(_inv)
    const hit = b.bvh.raycastFirst(_ray, DoubleSide)
    // matrix bata tanpa skala, jadi jarak di ruang lokal = jarak dunia
    return hit ? hit.distance : -1
  }

  /** Cermin DOM tersembunyi (pembaca layar): daftar fakta di section sendiri dalam <main id="a11y">. */
  writeA11y() {
    if (typeof document === 'undefined') return
    const main = document.getElementById('a11y')
    if (!main) return
    let sec = main.querySelector('section[data-igloo-facts]')
    if (!sec) {
      sec = document.createElement('section')
      sec.dataset.iglooFacts = ''
      main.append(sec)
    }
    const ul = document.createElement('ul')
    for (const f of this.facts) {
      const li = document.createElement('li')
      li.textContent = f
      ul.append(li)
    }
    sec.replaceChildren(ul)
  }
}
