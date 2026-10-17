import { DefaultLoadingManager } from 'three'
import { bus } from './Bus.js'

// Loader ASCII dengan progress asli (M8). igloo memakai bar CSS yang berputar tanpa angka (forensik 5.1),
// kita isi dengan progres muatan sungguhan:
//   - aset: DefaultLoadingManager three (TextureLoader, FileLoader glb, RGBELoader, decoder Draco) PLUS fetch()
//     biasa (json font, atlas teks buram, volume SDF) yang dibungkus sementara selama boot supaya ikut terhitung.
//   - precompile: event bus 'init_progress' 0..1 dari Engine.init (upload + compileAsync per scene).
// Bobot: aset 75%, precompile 25%. Angka hanya naik (jumlah item bisa bertambah di tengah jalan).

const CELLS = 24
const ASSET_WEIGHT = 0.75
const HEAD = '+=' // kepala bar berkedip

export class LoaderProgress {
  constructor(el) {
    this.el = el
    this.loaded = 0
    this.total = 0
    this.compile = 0
    this.shown = 0
    this.target = 0
    this.done = false
    this._raf = 0
    this._t0 = performance.now()

    const m = DefaultLoadingManager
    const prev = { start: m.onStart, progress: m.onProgress }
    m.onStart = (url, loaded, total) => {
      prev.start?.(url, loaded, total)
      this._set(loaded, total)
    }
    m.onProgress = (url, loaded, total) => {
      prev.progress?.(url, loaded, total)
      this._set(loaded, total)
    }
    this._restore = () => {
      m.onStart = prev.start
      m.onProgress = prev.progress
    }

    // fetch() di luar loader three: daftarkan sebagai item manager (itemStart/itemEnd = API publik three)
    this._fetch = window.fetch
    const orig = this._fetch
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input?.url || String(input)
      m.itemStart(url)
      return orig.call(window, input, init).finally(() => m.itemEnd(url))
    }

    this._onInit = (v) => {
      this.compile = Math.max(this.compile, v)
      this._update()
    }
    bus.on('init_progress', this._onInit)
    this._tick = this._tick.bind(this)
    this._raf = requestAnimationFrame(this._tick)
  }

  _set(loaded, total) {
    this.loaded = loaded
    this.total = Math.max(this.total, total)
    this._update()
  }

  _update() {
    const assets = this.total > 0 ? this.loaded / this.total : 0
    const p = ASSET_WEIGHT * assets + (1 - ASSET_WEIGHT) * this.compile
    this.target = Math.max(this.target, Math.min(1, p))
  }

  _tick(now) {
    // tampilan mengejar target dengan halus, tapi tidak pernah mundur
    this.shown += (this.target - this.shown) * 0.25
    if (this.target - this.shown < 0.002) this.shown = this.target
    this.el.textContent = bar(this.shown, now - this._t0)
    if (!this.done || this.shown < 1) this._raf = requestAnimationFrame(this._tick)
  }

  /** Init selesai: penuhkan bar, kembalikan fetch dan handler manager, lalu pudarkan elemen loader. */
  finish(loaderEl) {
    this.done = true
    this.target = 1
    window.fetch = this._fetch
    this._restore()
    bus.off('init_progress', this._onInit)
    // beri bar satu kedipan penuh sebelum memudar (transisi opacity 0.75 s di index.html)
    setTimeout(() => {
      cancelAnimationFrame(this._raf)
      this.el.textContent = bar(1, 0)
      loaderEl.classList.add('hidden')
    }, 180)
  }

  /** Gagal boot: hentikan animasi dan kembalikan fetch, elemen loader dipakai untuk pesan error. */
  stop() {
    this.done = true
    this.shown = 1
    cancelAnimationFrame(this._raf)
    window.fetch = this._fetch
    this._restore()
    bus.off('init_progress', this._onInit)
  }

  get progress() {
    return this.target
  }
}

/** Bar karakter: '=' terisi, kepala '+'/'=' berkedip, '-' kosong, lalu persen 3 digit. */
export function bar(p, ms) {
  const n = Math.floor(p * CELLS + 1e-6)
  let s = ''
  for (let i = 0; i < CELLS; i++) {
    if (i < n) s += '='
    else if (i === n) s += HEAD[Math.floor(ms / 120) % HEAD.length]
    else s += '-'
  }
  return `${s} ${String(Math.round(p * 100)).padStart(3, '0')}`
}
