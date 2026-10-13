import { Engine } from './engine/Engine.js'
import { SECTIONS } from './scenes/sections.js'
import { IglooScene } from './scenes/igloo/IglooScene.js'
import { CrystalsScene } from './scenes/crystals/CrystalsScene.js'
import { EntryScene } from './scenes/entry/EntryScene.js'
import { UIScene } from './scenes/ui/UIScene.js'
import { IntroTimeline, shouldSkipIntro } from './intro/IntroTimeline.js'

const IGLOO_REST_N = 0.658 // progress igloo 0.495

async function boot() {
  const engine = new Engine(document.getElementById('app'), SECTIONS)
  const byKey = Object.fromEntries(SECTIONS.map((s) => [s.key, s]))
  const igloo = engine.addScene(new IglooScene(byKey.igloo))
  engine.addScene(new CrystalsScene(byKey.crystals))
  engine.addScene(new EntryScene(byKey.entry))
  // Scene UI ortho (logo, copyright, hint, sound), dirender setelah composite sebelum bloom.
  engine.setUI(new UIScene())

  if (import.meta.env.DEV) {
    const { installDebugHandle } = await import('./debug/handle.js')
    installDebugHandle(engine)
  }

  await engine.init()
  engine.scroll.setN(IGLOO_REST_N)
  // Intro igloo (blueprint 6.5): scroll dikunci sampai detik 5. Deep link dan ?nointro (dev) langsung ke state akhir.
  const intro = (engine.intro = new IntroTimeline(engine, igloo))
  const skip = shouldSkipIntro()
  if (!skip) intro.prepare() // state detik 0 sudah terpasang sebelum frame pertama, tidak ada kedip dunia penuh
  engine.start()
  document.getElementById('loader').classList.add('hidden')
  if (skip) intro.skip()
  else intro.play()
}

boot().catch((err) => {
  console.error(err)
  document.getElementById('loader').textContent = 'WebGL2 error, cek console'
})
