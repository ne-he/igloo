import gsap from 'gsap'
import { bus } from './Bus.js'

const FRAME_MS = 1000 / 60

// Satu-satunya loop. gsap.ticker menggerakkan tween dan render di frame yang sama.
export class Ticker {
  constructor() {
    this.time = 0 // detik
    this.delta = FRAME_MS // ms
    this.ratio = 1
    this.frame = 0
    this.avgFps = 60
    this.frozenTime = null
    this._samples = []
    this._sampleStart = 0
    this._sampleFrames = 0
    this._tick = this._tick.bind(this)
  }

  start() {
    gsap.ticker.add(this._tick)
  }

  stop() {
    gsap.ticker.remove(this._tick)
  }

  /** Bekukan waktu untuk screenshot deterministik (hanya dipakai handle debug). */
  freeze(t) {
    this.frozenTime = t
  }

  unfreeze() {
    this.frozenTime = null
  }

  _tick(time, deltaTime) {
    if (this.frozenTime !== null) {
      this.time = this.frozenTime
      this.delta = FRAME_MS
    } else {
      this.time = time
      this.delta = deltaTime
    }
    this.ratio = Math.min(5, this.delta / FRAME_MS)
    this.frame++
    this._measureFps(time)

    bus.emit('prerender', this)
    bus.emit('render', this)
    bus.emit('postrender', this)
  }

  // Rata-rata FPS tiap 0.5 s, dipakai AdaptiveDPR.
  _measureFps(time) {
    this._sampleFrames++
    const elapsed = time - this._sampleStart
    if (elapsed >= 0.5) {
      const fps = this._sampleFrames / elapsed
      this._samples.push(fps)
      if (this._samples.length > 8) this._samples.shift()
      this.avgFps = this._samples.reduce((a, b) => a + b, 0) / this._samples.length
      this._sampleStart = time
      this._sampleFrames = 0
    }
  }

  get sampleCount() {
    return this._samples.length
  }
}
