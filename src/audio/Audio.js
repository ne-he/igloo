import { bus } from '../engine/Bus.js'
import { clamp, fit } from '../engine/math.js'

// Manajer audio Web Audio (blueprint 5.7, forensik arsitektur bagian 8). Semua file buatan sendiri,
// disintesis tools/audio/synth.py (Ogg Opus 48 kHz). Tidak ada sampel atau file igloo.
//
// Alur:
//   - Master gain mulai 0 (mute). AudioContext baru dibuat + di-resume di gesture pertama (klik/tap/tombol),
//     karena browser menolak AudioContext tanpa gesture. Gesture pertama hanya MEMBUKA kunci.
//   - Bunyi baru keluar setelah pengguna menyalakan "Sound: Off" -> "On" (event bus 'audio_mute_toggle').
//   - Tab tersembunyi -> master 0, kembali lagi saat terlihat.
//   - Volume loop mengikuti progress scene dan aktivitas mouse, BUKAN kecepatan scroll.
//
// Event bus yang didengar:
//   'audio_play'        { name }         one-shot. 'beeps' = acak beeps/beeps2/beeps3, jeda minimal 0.4 s.
//   'audio_mute_toggle' (tanpa data)     nyala/mati suara (tombol Sound di UIScene, tombol a11y).
//   'audio_param'       { name, value }  volume loop yang digerakkan scene lain. Dipakai ruang partikel
//                                        (src/scenes/entry): bus.emit('audio_param', { name: 'particles', value })
//                                        dengan value 0..1 (dijepit). Kirim 0 saat scene disembunyikan.
//                                        Nama lain yang belum punya loop disimpan saja (tidak error), jadi
//                                        scene boleh memancarkan parameter baru sebelum loop-nya dibuat.
// Event bus yang dipancarkan:
//   'audio_state'       { enabled, unlocked }  UIScene menukar teks "Sound: On/Off".

const BASE = '/assets/audio/'
// Bantalan sirkular di kedua ujung file loop dan panjang crossfade penyembuh sambungan.
// HARUS sama dengan LOOP_PAD dan HEAL di tools/audio/synth.py.
export const LOOP_PAD = 0.05
const HEAL_SEC = 0.01

const MASTER_VOLUME = 1
const MASTER_TAU = 0.35 // setTargetAtTime master (forensik: 0.35)
const CHANNEL_TAU = 0.12
const BEEP_GAP = 0.4 // detik, jeda minimal antar beep (forensik)

// Loop. sync = mulai di detik konteks yang sama (tiga loop utama panjangnya persis sama, 60 s).
const LOOPS = {
  music: { file: 'music', sync: true },
  wind: { file: 'wind', sync: true },
  room: { file: 'room', sync: true },
  portals: { file: 'circles' },
  particles: { file: 'particles' },
}

// Volume dasar one-shot (forensik: beeps dan project-text 0.5, sisanya 1).
const ONE_SHOTS = {
  beeps: 0.5, beeps2: 0.5, beeps3: 0.5,
  'click-project': 0.8, 'enter-project': 0.7, 'leave-project': 0.7,
  'project-text': 0.5, logo: 0.6, 'ui-long': 0.5, 'ui-short': 0.5,
}
const BEEPS = ['beeps', 'beeps2', 'beeps3']

// Campuran loop. Angka igloo: music-bg 0.2, room-bg 0.45, wind = vol * 0.4, igloo = vol * 0.5, portals puncak 0.9.
// File kita dinormalisasi berbeda (room = dengung, bukan ambience ruang), jadi bed room lebih kecil.
export const MIX = {
  music: 0.22,
  roomBed: 0.08,
  roomPlexus: 0.5,
  wind: 0.4,
  portals: 0.9,
  particles: 0.5, // EntryScene mengirim sampai 1.0 saat kick ganti link, igloo jarang di atas 0.3
}

/** Angin igloo (forensik): naik di awal scene, turun di akhir. p = progress scene igloo. */
export const windVolume = (p) => fit(p, 0.05, 0.2, 0, 1) * fit(p, 0.75, 0.95, 1, 0)

// Puncak suara cincin portal di progress entry (forensik): lewat tiap cincin.
export const PORTAL_PEAKS = [0.28, 0.375, 0.465]
const PORTAL_WIDTH = 0.03
/** Volume cincin portal 0..1: maksimum dari tiga lonceng gaussian di sekitar puncak. */
export const portalVolume = (p) =>
  PORTAL_PEAKS.reduce((m, c) => Math.max(m, Math.exp(-0.5 * ((p - c) / PORTAL_WIDTH) ** 2)), 0)

/** Aktivitas plexus igloo 0..1 (jumlah titik yang sedang muncul, jenuh di 4 titik). */
function plexusActivity(iglooScene) {
  const items = iglooScene?.igloo?.plexus?.items
  if (!items) return 0
  let s = 0
  for (const it of items.values()) s += it.appear
  return clamp(s / 4, 0, 1)
}

export class AudioManager {
  constructor(engine) {
    this.engine = engine
    this.ctx = null
    this.master = null
    this.unlocked = false
    this.enabled = false // keinginan pengguna (tombol Sound)
    this.hidden = typeof document !== 'undefined' && document.hidden
    this.supported = typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext)
    this.buffers = new Map()
    this.channels = {} // nama loop -> { gain, source, target }
    this.params = {} // nilai dari 'audio_param'
    this.targets = {}
    this._raw = new Map() // ArrayBuffer hasil prefetch, di-decode setelah unlock
    this._lastBeep = -1
    this._labelState = new Map()
    this._warned = new Set()

    bus.on('audio_play', ({ name }) => this.play(name))
    bus.on('audio_mute_toggle', () => this.setEnabled(!this.enabled))
    bus.on('audio_param', ({ name, value }) => {
      this.params[name] = clamp(Number(value) || 0, 0, 1)
    })
    bus.on('postrender', (t) => this.update(t))

    if (typeof window !== 'undefined') {
      this._onGesture = () => this.unlock()
      for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, this._onGesture, { capture: true })
      document.addEventListener('visibilitychange', () => {
        this.hidden = document.hidden
        this._applyMaster()
      })
    }
  }

  /** Unduh semua file (belum di-decode, butuh AudioContext). Dipanggil main.js setelah loader hilang. */
  prefetch() {
    if (!this.supported) return Promise.resolve()
    const names = [...new Set([...Object.values(LOOPS).map((l) => l.file), ...Object.keys(ONE_SHOTS)])]
    return Promise.all(names.map((n) => {
      if (this._raw.has(n)) return this._raw.get(n)
      const p = fetch(`${BASE}${n}.ogg`)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.arrayBuffer()
        })
        .catch((err) => {
          this._warnOnce(n, `audio ${n}.ogg gagal diunduh (${err.message}), bunyi ini dilewati`)
          return null
        })
      this._raw.set(n, p)
      return p
    }))
  }

  /** Gesture pertama: buat + resume AudioContext, decode semua file, mulai loop (master tetap 0 kalau Sound Off). */
  unlock() {
    if (this.unlocked || !this.supported) return
    this.unlocked = true
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(ev, this._onGesture, { capture: true })
    const Ctx = window.AudioContext || window.webkitAudioContext
    this.ctx = new Ctx({ latencyHint: 'interactive' })
    this.ctx.resume()
    this.master = this.ctx.createGain()
    this.master.gain.value = 0
    this.master.connect(this.ctx.destination)
    for (const name of Object.keys(LOOPS)) {
      const gain = this.ctx.createGain()
      gain.gain.value = 0
      gain.connect(this.master)
      this.channels[name] = { gain, source: null, target: 0 }
    }
    bus.emit('audio_state', { enabled: this.enabled, unlocked: true })
    this._load()
    this._applyMaster()
  }

  async _load() {
    this.prefetch()
    const decode = async (name) => {
      const raw = await this._raw.get(name)
      if (!raw) return null
      try {
        // decodeAudioData melepas (detach) ArrayBuffer, jadi beri salinan
        const buf = await this.ctx.decodeAudioData(raw.slice(0))
        this.buffers.set(name, buf)
        return buf
      } catch (err) {
        this._warnOnce(name, `audio ${name}.ogg gagal di-decode (${err?.message || err}), browser ini mungkin belum mendukung Ogg Opus`)
        return null
      }
    }
    // loop sinkron dimulai bersamaan setelah ketiganya siap
    const syncNames = Object.entries(LOOPS).filter(([, l]) => l.sync)
    const others = Object.entries(LOOPS).filter(([, l]) => !l.sync)
    const oneShots = Object.keys(ONE_SHOTS).map((n) => decode(n))
    const syncBufs = await Promise.all(syncNames.map(([, l]) => decode(l.file)))
    const when = this.ctx.currentTime + 0.05
    syncNames.forEach(([name], i) => syncBufs[i] && this._startLoop(name, syncBufs[i], when))
    await Promise.all(others.map(async ([name, l]) => {
      const buf = await decode(l.file)
      if (buf) this._startLoop(name, buf, this.ctx.currentTime + 0.05)
    }))
    await Promise.all(oneShots)
  }

  /** Putar loop di antara bantalan: loopStart = LOOP_PAD, loopEnd = panjang - LOOP_PAD. */
  _startLoop(name, buffer, when) {
    healLoop(buffer)
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.loop = true
    const pad = Math.round(LOOP_PAD * buffer.sampleRate) / buffer.sampleRate
    src.loopStart = pad
    src.loopEnd = buffer.duration - pad
    src.connect(this.channels[name].gain)
    src.start(when, pad)
    this.channels[name].source = src
  }

  setEnabled(on) {
    // klik tombol Sound bisa jadi gesture pertama: buka kunci dulu, baru nyalakan
    if (!this.unlocked) this.unlock()
    this.enabled = !!on
    this._applyMaster()
    bus.emit('audio_state', { enabled: this.enabled, unlocked: this.unlocked })
  }

  _applyMaster() {
    if (!this.ctx) return
    if (this.enabled && this.ctx.state === 'suspended') this.ctx.resume()
    const v = this.enabled && !this.hidden ? MASTER_VOLUME : 0
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, MASTER_TAU)
    this.targets.master = v
  }

  play(name) {
    if (!this.ctx || !this.enabled || this.hidden) return
    if (name === 'beeps') {
      name = BEEPS[Math.floor(Math.random() * BEEPS.length)]
    }
    if (BEEPS.includes(name)) {
      const now = this.ctx.currentTime
      if (now - this._lastBeep < BEEP_GAP) return
      this._lastBeep = now
    }
    const buf = this.buffers.get(name)
    if (!buf) {
      if (!(name in ONE_SHOTS)) this._warnOnce(name, `audio_play: bunyi "${name}" tidak dikenal`)
      return
    }
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    const g = this.ctx.createGain()
    g.gain.value = ONE_SHOTS[name] ?? 1
    src.connect(g).connect(this.master)
    src.start()
    src.onended = () => g.disconnect()
  }

  /** Hitung target volume tiap loop dari state scene, kirim ke AudioParam kalau berubah. */
  update() {
    const engine = this.engine
    const scenes = {}
    for (const s of engine.scenes) scenes[s.key] = s
    const dp = engine.detail ? engine.composite.uniforms.uDetailProgress.value : 0
    const sceneMix = 1 - dp // detail terbuka penuh: bunyi scene scroll diredam, musik tetap
    const igloo = scenes.igloo
    const entry = scenes.entry
    const iglooOn = igloo?.active ? 1 : 0
    const entryOn = entry?.active ? 1 : 0

    const t = this.targets
    t.music = MIX.music
    t.wind = MIX.wind * windVolume(igloo?.progress ?? 0) * iglooOn * sceneMix
    t.room = (MIX.roomBed + MIX.roomPlexus * plexusActivity(igloo) * iglooOn) * (0.5 + 0.5 * sceneMix)
    // pakai progress kamera (CameraFollow), bukan progress scroll mentah, supaya bunyi cincin pas saat kamera lewat
    t.portals = MIX.portals * portalVolume(entry?.follow?.pPosition ?? entry?.progress ?? 0) * entryOn * sceneMix
    t.particles = MIX.particles * (this.params.particles ?? 0) * entryOn * sceneMix

    this._watchLabels(scenes.crystals)

    if (!this.ctx) return
    const now = this.ctx.currentTime
    for (const [name, ch] of Object.entries(this.channels)) {
      const v = t[name] ?? 0
      if (Math.abs(v - ch.target) > 0.002 || (v === 0 && ch.target !== 0)) {
        ch.target = v
        ch.gain.gain.setTargetAtTime(v, now, CHANNEL_TAU)
      }
    }
  }

  // Beep saat label kristal (judul, tanggal, TEMP) mulai muncul (forensik: random beep, jeda min 0.4 s).
  // Hanya membaca state label, CrystalLabels sendiri tidak diubah.
  _watchLabels(crystals) {
    if (!crystals?.crystals || !crystals.active) return
    for (const c of crystals.crystals) {
      for (const l of c.labels?.labels || []) {
        const was = this._labelState.get(l) || false
        if (l.visible && !was) bus.emit('audio_play', { name: 'beeps' })
        this._labelState.set(l, l.visible)
      }
    }
  }

  _warnOnce(key, msg) {
    if (this._warned.has(key)) return
    this._warned.add(key)
    console.warn(`[audio] ${msg}`)
  }

  /** Untuk verifikasi (tools/verify/audio_gains.py): nilai gain sekarang dan target. */
  debugState() {
    const gains = {}
    for (const [name, ch] of Object.entries(this.channels)) gains[name] = ch.gain.gain.value
    return {
      supported: this.supported,
      unlocked: this.unlocked,
      enabled: this.enabled,
      hidden: this.hidden,
      ctxState: this.ctx ? this.ctx.state : null,
      ctxTime: this.ctx ? this.ctx.currentTime : 0,
      master: this.master ? this.master.gain.value : 0,
      gains,
      targets: { ...this.targets },
      params: { ...this.params },
      buffers: Object.fromEntries([...this.buffers].map(([k, b]) => [k, { duration: b.duration, channels: b.numberOfChannels, sampleRate: b.sampleRate }])),
      lastBeep: this._lastBeep,
    }
  }
}

/**
 * Sembuhkan sambungan loop: HEAL_SEC pertama setelah loopStart di-crossfade dari salinan kepala di bantalan
 * belakang. Salinan itu dikode Opus menyambung dengan sampel terakhir loop, jadi lompatan di sambungan hilang
 * (room.ogg: lompatan mentah lebih besar dari semua langkah sampel di file, sesudah heal di persentil 52).
 */
function healLoop(buffer) {
  if (buffer._healed) return
  buffer._healed = true
  const sr = buffer.sampleRate
  const pad = Math.round(LOOP_PAD * sr)
  const core = buffer.length - 2 * pad
  const h = Math.min(Math.round(HEAL_SEC * sr), pad)
  if (core <= h) return
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c)
    for (let i = 0; i < h; i++) {
      const w = i / h
      d[pad + i] = d[pad + core + i] * (1 - w) + d[pad + i] * w
    }
  }
}
