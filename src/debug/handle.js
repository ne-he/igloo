// Handle verifikasi (blueprint 7.4 nomor 6). Hanya dipasang di dev (import.meta.env.DEV),
// tidak ikut bundle produksi. Dipakai script Playwright untuk screenshot deterministik.
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
