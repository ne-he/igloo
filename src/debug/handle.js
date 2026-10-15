// Handle verifikasi (blueprint 7.4 nomor 6). Hanya dipasang di dev (import.meta.env.DEV),
// tidak ikut bundle produksi. Dipakai script Playwright untuk screenshot deterministik.
import gsap from 'gsap'

export function installDebugHandle(engine) {
  window.__igloo = {
    engine,
    setScroll(n, { snap = true } = {}) {
      // lompat manual = minta frame istirahat: intro yang masih jalan diselesaikan dulu
      engine.intro?.finish()
      engine.scroll.setN(n)
      // lompat langsung tanpa damping kamera supaya screenshot deterministik
      if (snap) for (const s of engine.scenes) s.camera.snap()
    },
    enableScroll(on = true) {
      // debug mengambil alih kunci scroll, intro tidak lagi membukanya di detik 5
      if (engine.intro) engine.intro.manageScroll = false
      engine.scroll.enabled = on
    },
    freeze(t) {
      engine.ticker.freeze(t)
    },
    unfreeze() {
      engine.ticker.unfreeze()
    },
    setPointer(x11, y11) {
      engine.input.position11.set(x11, y11)
    },
    // Kontrol timeline intro (blueprint 6.5) untuk tools/verify/intro_shots.py.
    intro: {
      play: () => engine.intro?.play(),
      seek: (t) => engine.intro?.seek(t),
      progress: (p) => engine.intro?.progress(p),
      get time() {
        return engine.intro ? engine.intro.timeline.time() : 0
      },
      get duration() {
        return engine.intro ? engine.intro.duration : 0
      },
      get running() {
        return !!engine.intro?.running
      },
    },
    // Detail view + router (M6) untuk tools/verify/detail_shots.py.
    detail: {
      state() {
        const c = engine.detailController
        const u = engine.composite.uniforms
        return {
          state: c ? c.state : null,
          slug: c ? c.slug : null,
          dp: u.uDetailProgress.value,
          dp2: u.uDetailProgress2.value,
          path: window.location.pathname,
          blocked: !!engine.router?.blocked,
          scrollEnabled: engine.scroll.enabled,
          hovered: engine.scenes.find((s) => s.key === 'crystals')?.hovered ?? -1,
          cursor: engine.renderer.domElement.style.cursor,
          panelScroll: c ? c.panel.scrollY : 0,
          panelScrollMax: c ? c.panel.scrollMax : 0,
        }
      },
      // buka lewat router (sama seperti klik kristal), indeks proyek 0..2
      open: (index) => engine.detailController?.requestOpen(index),
      close: () => engine.detailController?.requestClose(),
      // posisi chip link dan tombol Close dalam piksel CSS (untuk klik Playwright)
      targets() {
        const c = engine.detailController
        const ui = engine.ui
        const chips = (c?.panel.chipRects || []).map((r) => ({
          x: (r.x0 + r.x1) / 2 + c.panel.colX, y: (r.y0 + r.y1) / 2 - c.panel.scrollY,
        }))
        const r = ui?.closeRect
        return { chips, close: r ? { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 } : null }
      },
    },
    // Bekukan semua tween gsap (transisi detail, kamera, reveal) supaya frame transisi bisa difoto tepat
    // di detik tertentu walau screenshot Playwright lambat. Render tetap jalan.
    pauseTweens(on = true) {
      if (on) gsap.globalTimeline.pause()
      else gsap.globalTimeline.resume()
    },
    adaptive(on) {
      engine.adaptive.enabled = on
    },
    state() {
      const s = engine.scroll.state
      return {
        n: s.n,
        current: s.current,
        next: s.next,
        transition: s.transition,
        velocity: engine.scroll.velocity,
        centering: !!engine.scroll.centering,
        fps: engine.ticker.avgFps,
        dpr: engine.currentDpr,
      }
    },
    info() {
      const i = engine.renderer.info
      return { calls: i.render.calls, triangles: i.render.triangles, textures: i.memory.textures, geometries: i.memory.geometries, programs: i.programs?.length }
    },
  }
}
