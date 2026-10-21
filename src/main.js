import { Engine } from './engine/Engine.js'
import { SECTIONS } from './scenes/sections.js'
import { IglooScene } from './scenes/igloo/IglooScene.js'
import { CrystalsScene } from './scenes/crystals/CrystalsScene.js'
import { EntryScene } from './scenes/entry/EntryScene.js'
import { UIScene } from './scenes/ui/UIScene.js'
import { IntroTimeline, shouldSkipIntro } from './intro/IntroTimeline.js'
import { DetailScene } from './scenes/detail/DetailScene.js'
import { DetailPanel } from './scenes/detail/DetailPanel.js'
import { DetailController } from './scenes/detail/DetailController.js'
import { Router } from './router/Router.js'
import { bus } from './engine/Bus.js'
import { LoaderProgress } from './engine/LoaderProgress.js'
import { AudioManager } from './audio/Audio.js'
import content from './content/content.js'

const IGLOO_REST_N = 0.658 // progress igloo 0.495

const loaderEl = document.getElementById('loader')
// Loader dekripsi nama dipasang paling awal supaya semua muatan aset ikut terhitung
const loader = new LoaderProgress(loaderEl)

async function boot() {
  const engine = new Engine(document.getElementById('app'), SECTIONS)
  const byKey = Object.fromEntries(SECTIONS.map((s) => [s.key, s]))
  const igloo = engine.addScene(new IglooScene(byKey.igloo))
  const crystals = engine.addScene(new CrystalsScene(byKey.crystals))
  engine.addScene(new EntryScene(byKey.entry))
  // Scene UI ortho (logo, copyright, hint, sound), dirender setelah composite sebelum bloom.
  const ui = engine.setUI(new UIScene())
  // Scene detail proyek (M6): render target sendiri, dicampur composite lewat uDetailProgress.
  const detail = engine.setDetail(new DetailScene())

  if (import.meta.env.DEV) {
    const { installDebugHandle } = await import('./debug/handle.js')
    installDebugHandle(engine)
  }

  await engine.init()
  // Panel teks proyek hidup di scene UI (tidak kena transisi), memakai font UI dan sim mouse detail.
  const panel = new DetailPanel(ui.font, detail.sim.uniform, engine.globals, engine)
  ui.add(panel)
  panel.resize(engine.container.clientWidth, engine.container.clientHeight)
  await panel.compile(engine.renderer, ui.camera, ui)
  const controller = (engine.detailController = new DetailController({ engine, crystals, detail, panel }))
  bus.on('prerender', ({ ratio }) => controller.update(ratio))
  engine.scroll.setN(IGLOO_REST_N)
  // Intro igloo (blueprint 6.5): scroll dikunci sampai detik 5. Deep link dan ?nointro (dev) langsung ke state akhir.
  const intro = (engine.intro = new IntroTimeline(engine, igloo))
  const skip = shouldSkipIntro()
  if (!skip) intro.prepare() // state detik 0 sudah terpasang sebelum frame pertama, tidak ada kedip dunia penuh
  // Audio (M8): mute sampai gesture pertama + tombol Sound On. File diunduh di belakang setelah loader hilang.
  const audio = (engine.audio = new AudioManager(engine))
  engine.start()
  // Loader menahan nama utuh sebentar sebelum pudar: intro baru diputar saat pudar dimulai (detik 0 tidak
  // habis di balik loader). Kalau intro sudah diselesaikan duluan (handle debug), jangan diputar ulang.
  const fading = loader.finish(loaderEl)
  setTimeout(() => audio.prefetch(), 1500)
  if (skip) intro.skip()
  else fading.then(() => intro.running && intro.play())

  // Router mikro (blueprint 6.6): '/' dan '/portfolio/:slug'. Deep link membuka detail langsung (intro sudah
  // dilewati shouldSkipIntro). Semua ini jalan sebelum frame pertama (ticker baru berdetak di rAF berikutnya).
  const router = (engine.router = new Router({
    history: window.history,
    location: window.location,
    events: window,
    base: import.meta.env.BASE_URL || '/',
    slugs: content.projects.map((p) => p.slug),
    canEnterProject: () => controller.canEnterProject(),
    onRoute: (route, info) => controller.route(route, info),
  }))
  controller.router = router
  router.start()
}

boot().catch((err) => {
  console.error(err)
  loader.stop()
  loaderEl.textContent = 'WebGL2 error, cek console'
})
