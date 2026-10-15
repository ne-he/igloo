import gsap from 'gsap'
import { bus } from '../../engine/Bus.js'
import { fit, mod } from '../../engine/math.js'
import { crystalCenter } from '../sections.js'
import { projectPath, HOME } from '../../router/Router.js'
import { audio, SOUNDS } from './audio.js'
import content from '../../content/content.js'

// Orkestrasi buka/tutup detail proyek (blueprint 5.4, skill ref 01 bagian 6.2). Angka persis igloo:
//  buka : scroll dipusatkan ke kristal (durasi expo.out(fit(jarak, 0, 0.2, 0.05, 1)) * 1.5), a = setengahnya,
//         uDetailProgress 0 -> 1 (1.25 s power3.in) di a, uDetailProgress2 0 -> 1 (1.25 s sine.out) di a + 0.75,
//         navigasi diblokir sampai a + 2.
//  tutup: uDetailProgress -> 0 (1.25 s power2.out), uDetailProgress2 -> 0 (0.6 s), scroll aktif lagi setelah 1 s.
//  deep link: langsung state akhir (progress 1), intro dilewati main.js.
export const DETAIL_TIMING = {
  in: 1.25,
  in2: 1.25,
  in2Delay: 0.75,
  out: 1.25,
  out2: 0.6,
  scrollBack: 1,
  settle: 2, // detik sesudah a sampai navigasi dibuka lagi
  panelAt: 1.0, // detik sesudah a: panel teks + tombol Close mulai muncul [?] angka igloo tidak tercatat
}

const expoOut = (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x))

export class DetailController {
  /**
   * @param {object} o
   * @param {import('../../engine/Engine.js').Engine} o.engine
   * @param {import('../crystals/CrystalsScene.js').CrystalsScene} o.crystals
   * @param {import('./DetailScene.js').DetailScene} o.detail
   * @param {import('./DetailPanel.js').DetailPanel} o.panel
   */
  constructor({ engine, crystals, detail, panel }) {
    this.engine = engine
    this.crystals = crystals
    this.detail = detail
    this.panel = panel
    this.router = null // dipasang main.js sesudah Router dibuat
    this.u = engine.composite.uniforms
    this.state = 'closed' // closed | opening | open | closing
    this.index = -1
    this.slug = null
    this.tl = null

    bus.on('crystal_click', ({ index }) => this.requestOpen(index))
    bus.on('detail_close', () => this.requestClose())
    bus.on('keydown', (e) => {
      if (e.key === 'Escape') this.requestClose()
    })
  }

  /** Router: rute proyek hanya boleh kalau scene kristal sedang terlihat dan detail tertutup. */
  canEnterProject() {
    return this.crystals.active && this.state === 'closed'
  }

  /** Handler onRoute Router. */
  route(route, { first }) {
    if (route.name === 'project') this.open(route.slug, { instant: first })
    else if (!first) this.close()
  }

  requestOpen(index) {
    const p = content.projects[index]
    if (!p || !this.router || this.state !== 'closed') return false
    return this.router.go(projectPath(p.slug))
  }

  requestClose() {
    if (this.state !== 'open' || !this.router) return false
    return this.router.go(HOME.path)
  }

  _kill() {
    this.tl?.kill()
    this.tl = null
    gsap.killTweensOf([this.u.uDetailProgress, this.u.uDetailProgress2])
  }

  open(slug, { instant = false } = {}) {
    const index = content.projects.findIndex((p) => p.slug === slug)
    if (index < 0) return false
    const e = this.engine
    const s = e.scroll
    const u = this.u
    // rute proyek ke proyek lain saat sudah terbuka (lewat history): ganti isi langsung
    if (this.state === 'open' && !instant) {
      this._setContent(index)
      this.detail.setProject(index)
      this.panel.show()
      return true
    }
    this._kill()
    this.index = index
    this.slug = slug
    s.enabled = false
    s.stopAutoCenter()
    const crystalsIndex = e.scenes.indexOf(this.crystals)
    const targetN = s.progressToN(crystalsIndex, crystalCenter(index))

    if (instant) {
      s.setN(targetN)
      this.crystals.camera.snap()
      this.crystals.detailIn(index, 0, { instant: true })
      u.uDetailProgress.value = 1
      u.uDetailProgress2.value = 1
      this.detail.playIn(index, { instant: true })
      this._setContent(index)
      this.panel.show()
      e.ui?.setDetailMode(true, { instant: true })
      this.state = 'open'
      return true
    }

    this.router?.block()
    this.state = 'opening'
    audio.play(SOUNDS.click)
    // pusatkan scroll ke kristal lewat jalur terpendek di loop scroll
    let dy = targetN - mod(s.y, s.total)
    dy = mod(dy + s.total / 2, s.total) - s.total / 2
    const section = s.sections[crystalsIndex]
    const dist = Math.abs(dy) / (section.height + 1) // satuan progress scene kristal
    const dur = expoOut(fit(dist, 0, 0.2, 0.05, 1)) * 1.5
    if (Math.abs(dy) > 1e-5) {
      const from = s.y
      s.centering = e._tween(from, from + dy, dur, (v) => {
        s.y = s.target1 = s.target2 = v
      }, () => {
        s.centering = null
      })
    }
    const a = dur * 0.5
    this.crystals.detailIn(index, a)
    const T = DETAIL_TIMING
    const tl = gsap.timeline()
    tl.call(() => {
      audio.play(SOUNDS.enter)
      this.detail.playIn(index)
    }, null, a)
    tl.fromTo(u.uDetailProgress, { value: 0 }, { value: 1, duration: T.in, ease: 'power3.in', immediateRender: false }, a)
    tl.fromTo(u.uDetailProgress2, { value: 0 }, { value: 1, duration: T.in2, ease: 'sine.out', immediateRender: false }, a + T.in2Delay)
    tl.call(() => {
      this._setContent(index)
      this.panel.show()
      e.ui?.setDetailMode(true)
      audio.play(SOUNDS.projectText)
    }, null, a + T.panelAt)
    tl.call(() => {
      this.state = 'open'
      this.router?.unblock()
    }, null, a + T.settle)
    this.tl = tl
    return true
  }

  close({ instant = false } = {}) {
    if (this.state === 'closed') return false
    this._kill()
    const e = this.engine
    const u = this.u
    const T = DETAIL_TIMING
    this.state = 'closing'
    audio.play(SOUNDS.leave)
    this.crystals.detailOut()
    this.detail.playOut()
    this.panel.hide()
    e.ui?.setDetailMode(false, { instant })
    if (instant) {
      u.uDetailProgress.value = 0
      u.uDetailProgress2.value = 0
      e.scroll.enabled = true
      this.state = 'closed'
      return true
    }
    this.router?.block()
    const tl = gsap.timeline()
    tl.to(u.uDetailProgress, { value: 0, duration: T.out, ease: 'power2.out' }, 0)
    tl.to(u.uDetailProgress2, { value: 0, duration: T.out2, ease: 'power2.out' }, 0)
    tl.call(() => {
      e.scroll.enabled = true
      // timer diam auto-center mulai dari sini, bukan dari input terakhir sebelum detail
      e.scroll.lastInputTime = e.ticker.time * 1000
    }, null, T.scrollBack)
    tl.call(() => {
      this.state = 'closed'
      this.index = -1
      this.slug = null
      this.router?.unblock()
    }, null, T.out)
    this.tl = tl
    return true
  }

  _setContent(index) {
    this.index = index
    this.slug = content.projects[index].slug
    this.panel.setProject(content.projects[index])
  }

  /** Dipanggil tiap frame sebelum render (main.js lewat bus 'prerender'): scroll panel. */
  update(ratio) {
    this.panel.update(ratio)
  }
}
