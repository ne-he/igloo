import { Engine } from './engine/Engine.js'
import { SECTIONS } from './scenes/sections.js'
import { IglooScene } from './scenes/igloo/IglooScene.js'
import { CrystalsScene } from './scenes/crystals/CrystalsScene.js'
import { EntryScene } from './scenes/entry/EntryScene.js'
import { UIScene } from './scenes/ui/UIScene.js'

const IGLOO_REST_N = 0.658 // progress igloo 0.495

async function boot() {
  const engine = new Engine(document.getElementById('app'), SECTIONS)
  const byKey = Object.fromEntries(SECTIONS.map((s) => [s.key, s]))
  engine.addScene(new IglooScene(byKey.igloo))
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
  engine.start()
  // Intro igloo (scroll dikunci 5 s) datang di M3. Untuk sekarang scroll langsung aktif.
  engine.scroll.enabled = true
  document.getElementById('loader').classList.add('hidden')
}

boot().catch((err) => {
  console.error(err)
  document.getElementById('loader').textContent = 'WebGL2 error, cek console'
})
