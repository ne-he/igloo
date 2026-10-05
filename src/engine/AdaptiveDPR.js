// Adaptive DPR (blueprint 6.8): mulai 2 s setelah start, evaluasi tiap 4 s.
// Rata-rata < 30 fps turunkan multiplier 0.1 (lantai 0.6), >= 60 fps naikkan 0.1 (maks 1).
// Berhenti setelah 4 kali bolak-balik arah supaya tidak berosilasi.
export class AdaptiveDPR {
  constructor(onChange) {
    this.onChange = onChange
    this.multiplier = 1
    this.enabled = true
    this._startAt = null
    this._lastEval = 0
    this._lastDir = 0
    this._flips = 0
  }

  update(time, avgFps, sampleCount) {
    if (!this.enabled) return
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    if (this._startAt === null) {
      this._startAt = time
      this._lastEval = time
      return
    }
    if (time - this._startAt < 2 || time - this._lastEval < 4 || sampleCount < 5) return
    this._lastEval = time
    let dir = 0
    if (avgFps < 30 && this.multiplier > 0.6) dir = -1
    else if (avgFps >= 60 && this.multiplier < 1) dir = 1
    if (!dir) return
    if (this._lastDir && dir !== this._lastDir) this._flips++
    this._lastDir = dir
    this.multiplier = Math.round((this.multiplier + dir * 0.1) * 10) / 10
    this.onChange(this.multiplier)
    if (this._flips >= 4) {
      this.enabled = false
      console.info('[igloo] Adaptive DPR stopped at', this.multiplier)
    }
  }
}
