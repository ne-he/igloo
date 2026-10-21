import { DefaultLoadingManager } from 'three'
import plexMonoUrl from '@ibm/plex-mono/fonts/complete/woff2/IBMPlexMono-Medium.woff2?url'
import { bus } from './Bus.js'

// Loader "dekripsi nama" dengan progress asli (M8, desain ulang dari bar ASCII +=-). Glyph kode acak jatuh dari
// atas ke tiap slot nama, slot terus berganti karakter (terenkripsi), lalu dari kiri ke kanan satu per satu
// mendarat dan terkunci jadi NEHEMIAH WILHELMUS. Huruf ke-k terkunci saat progress tampil melewati (k + 1) / 17.
// Sumber progress (sama dengan versi bar):
//   - aset: DefaultLoadingManager three (TextureLoader, FileLoader glb, RGBELoader, decoder Draco) PLUS fetch()
//     biasa (json font, atlas teks buram, volume SDF) yang dibungkus sementara selama boot supaya ikut terhitung.
//   - precompile: event bus 'init_progress' 0..1 dari Engine.init (upload + compileAsync per scene).
// Bobot: aset 75%, precompile 25%. Angka hanya naik (jumlah item bisa bertambah di tengah jalan).
// Biaya per frame dijaga kecil karena loader jalan saat main thread sibuk compile shader: jatuhnya kolom memakai
// Web Animations (transform + opacity, dijalankan compositor jadi tetap mengalir saat main thread macet),
// rAF hanya mengganti teks beberapa span per frame.

export const NAME = 'NEHEMIAH WILHELMUS'
// karakter acak "kode": ASCII saja, tanpa I/J/O/Q/W/Y supaya tidak tertukar dengan 1/0 dan huruf nama
export const GLYPHS = '#%&*/<>{}[]=+$@!?;:01ABCDEFGHKLMNPRSTUVXZ23456789'

const ASSET_WEIGHT = 0.75
const TRAIL = 5 // baris per kolom hujan, kepala (paling terang) di bawah
const FALL = 'calc(-50vh - 1.5em)' // posisi awal kolom: kepala tepat di atas tepi atas layar (nama di tengah)
// ms. normal: selama muat. fast: setelah finish(), sisa huruf dikejar supaya tahan akhir tidak lama
const TIMING = {
  normal: { stagger: 70, land: 420, settle: 170 },
  fast: { stagger: 35, land: 150, settle: 80 },
}
const HOLD = 240 // nama utuh ditahan sebelum pudar (transisi opacity 0.75 s di index.html)
const TAIL_MAX = 3000 // pengaman: rAF berhenti di tab tersembunyi, loader tetap hilang lewat timer

const ENC = 0 // terenkripsi: glyph redup berganti terus, kolom hujan jatuh ke slot
const LAND = 1 // kolom sedang jatuh terakhir kali ke slot
const SETTLE = 2 // sudah mendarat: glyph terang berganti cepat sebentar
const LOCK = 3 // huruf final

/** Jumlah huruf yang boleh terkunci pada progress p: huruf ke-k terkunci saat p >= (k + 1) / n. */
export function lockedCount(p, n) {
  return Math.max(0, Math.min(n, Math.floor(p * n + 1e-6)))
}

/** Karakter acak dari GLYPHS, tidak pernah sama dengan `avoid` supaya tiap pergantian terlihat. */
export function scrambleChar(rand = Math.random, avoid = '') {
  let i = Math.floor(rand() * GLYPHS.length) % GLYPHS.length
  if (GLYPHS[i] === avoid) i = (i + 1) % GLYPHS.length
  return GLYPHS[i]
}

/** Progress tampil mengejar target dengan halus, tidak pernah mundur dan tidak pernah melewati target. */
export function follow(shown, target) {
  if (target <= shown) return shown
  const next = shown + (target - shown) * 0.25
  return target - next < 0.002 ? target : next
}

/** Persen 3 digit di bawah nama. */
export function pct(p) {
  return String(Math.round(Math.min(1, Math.max(0, p)) * 100)).padStart(3, '0')
}

/** Opacity kolom hujan pada progress iterasi p (cermin keyframe di _rain). */
function rainOpacity(p, peak) {
  if (p < 0.25) return (peak * p) / 0.25
  if (p < 0.8) return peak
  return (peak * (1 - p)) / 0.2
}

export class LoaderProgress {
  /** el: elemen #loader (atau anak di dalamnya). Slot nama dibangun ulang di #loader-name. */
  constructor(el) {
    this.root = el.closest?.('#loader') || el
    this.loaded = 0
    this.total = 0
    this.compile = 0
    this.shown = 0
    this.target = 0
    this.done = false
    this._raf = 0
    this._hidden = false
    this._attached = true
    this._next = 0 // huruf berikutnya yang mendarat (kiri ke kanan)
    this._lastEnd = -1e9
    this._locked = 0
    this._hideAt = 0
    this._pct = ''
    this.calm = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    this._loadFont()
    this._build()

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

  /**
   * Plex Mono Medium: file yang sama dengan atlas plexus igloo (import ?url sama, jadi satu aset, tidak ada
   * unduhan font baru). Ditambahkan ke document.fonts SETELAH termuat supaya teks tidak pernah tak terlihat,
   * sebelum itu loader memakai monospace sistem (lebar slot tetap, jadi tidak ada geseran saat font berganti).
   */
  _loadFont() {
    if (typeof FontFace === 'undefined' || !document.fonts) return
    try {
      new FontFace('IglooPlexMono', `url(${plexMonoUrl})`, { weight: '500' })
        .load()
        .then((f) => document.fonts.add(f))
        .catch(() => {})
    } catch {
      // tetap monospace sistem
    }
  }

  _build() {
    let name = this.root.querySelector('#loader-name')
    if (!name) {
      name = document.createElement('div')
      name.id = 'loader-name'
      this.root.append(name)
    }
    this.pctEl = this.root.querySelector('#loader-pct')
    this.letters = []
    const frag = document.createDocumentFragment()
    for (const ch of NAME) {
      const slot = document.createElement('span')
      slot.className = 'ls'
      frag.append(slot)
      if (ch === ' ') continue // celah antar kata tetap kosong
      const glyph = document.createElement('b')
      glyph.className = 'lg'
      glyph.textContent = scrambleChar()
      slot.append(glyph)
      const s = { ch, slot, glyph, col: null, anim: null, chars: null, peak: 1, state: ENC, flip: 0, colFlip: 0, until: 0 }
      if (!this.calm) this._rain(s)
      this.letters.push(s)
    }
    name.replaceChildren(frag)
  }

  /** Kolom glyph yang jatuh berulang ke slot lalu memudar masuk ke glyph redup slot. */
  _rain(s) {
    const col = document.createElement('i')
    col.className = 'lc'
    s.chars = Array.from({ length: TRAIL }, () => scrambleChar())
    col.textContent = s.chars.join('\n')
    s.slot.append(col)
    const d = 900 + Math.random() * 800
    s.peak = 0.55 + Math.random() * 0.35
    s.col = col
    s.anim = col.animate(
      [
        { transform: `translateY(${FALL})`, opacity: 0 },
        { opacity: s.peak, offset: 0.25 },
        { opacity: s.peak, offset: 0.8 },
        { transform: 'translateY(0)', opacity: 0 },
      ],
      { duration: d, delay: -Math.random() * d, iterations: Infinity },
    )
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
    // tampilan mengejar target dengan halus, tapi tidak pernah mundur. Setelah finish() langsung penuh: frame
    // pertama engine berat (50 ms+), kejaran per frame di sana hanya menambah ekor sebelum pudar.
    this.shown = this.done ? this.target : follow(this.shown, this.target)
    const pc = pct(this.shown)
    if (pc !== this._pct && this.pctEl) this.pctEl.textContent = this._pct = pc

    // semua huruf yang sudah jatuh tempo mulai mendarat di frame ini (frame bisa macet 1 s saat compile, antre
    // satu per frame membuat ekor panjang). Kesan satu per satu dijaga _land: waktu sampai berjarak stagger.
    const timing = this.done ? TIMING.fast : TIMING.normal
    const due = lockedCount(this.shown, this.letters.length)
    while (this._next < due) this._land(this.letters[this._next++], now, timing)

    let prevLocked = true
    for (const s of this.letters) {
      const left = prevLocked
      prevLocked = s.state === LOCK
      if (s.state === LOCK) continue
      if (s.state === LAND && now >= s.until) {
        // kepala kolom sampai di slot: kolom dilepas, glyph slot menyala dan berganti cepat
        s.anim?.cancel()
        s.col?.remove()
        s.col = s.anim = null
        s.state = SETTLE
        s.glyph.textContent = s.chars ? s.chars[TRAIL - 1] : s.glyph.textContent
        s.slot.classList.add('hot')
        s.until = now + timing.settle
        s.flip = now + 45
      }
      if (s.state === SETTLE) {
        // kunci hanya kalau huruf di kirinya sudah terkunci (urutan tetap walau tempo normal/fast berganti)
        if (now >= s.until && left) {
          this._lock(s)
          prevLocked = true
        } else if (now >= s.flip) {
          s.glyph.textContent = scrambleChar(Math.random, s.glyph.textContent)
          s.flip = now + 45
        }
        continue
      }
      if (this.calm) continue
      if (now >= s.flip) {
        s.glyph.textContent = scrambleChar(Math.random, s.glyph.textContent)
        s.flip = now + 80 + Math.random() * 120
      }
      if (s.col && now >= s.colFlip) {
        // kepala selalu berganti, plus satu karakter ekor acak
        s.chars[TRAIL - 1] = scrambleChar(Math.random, s.chars[TRAIL - 1])
        s.chars[Math.floor(Math.random() * (TRAIL - 1))] = scrambleChar()
        s.col.textContent = s.chars.join('\n')
        s.colFlip = now + (s.state === LAND ? 40 : 70 + Math.random() * 70)
      }
    }

    if (this.done && this._locked === this.letters.length && !this._hideAt) this._hideAt = now + HOLD
    if (this._hideAt && now >= this._hideAt) return this._hide(false)
    this._raf = requestAnimationFrame(this._tick)
  }

  /** Mulai pendaratan huruf s. Waktu sampai dijaga urut: tidak pernah lebih awal dari huruf sebelumnya + stagger. */
  _land(s, now, timing) {
    let dur
    if (s.anim) {
      // lanjutkan dari posisi jatuh sekarang, dipercepat (ease-in seperti gravitasi) sampai kepala di slot
      const p = s.anim.effect.getComputedTiming().progress ?? 0
      s.anim.cancel()
      dur = Math.max(90, timing.land * (1 - p), this._lastEnd + timing.stagger - now)
      s.anim = s.col.animate(
        [
          { transform: `translateY(calc(${FALL} * ${(1 - p).toFixed(3)}))`, opacity: Math.max(0.6, rainOpacity(p, s.peak)) },
          { transform: 'translateY(0)', opacity: 1 },
        ],
        { duration: dur, easing: 'cubic-bezier(0.5, 0, 0.9, 0.6)', fill: 'forwards' },
      )
      s.state = LAND
      s.colFlip = now
    } else {
      // reduced motion: tidak ada jatuh dan tidak ada acak, huruf memudar di tempat (transisi CSS index.html)
      dur = Math.max(0, this._lastEnd + timing.stagger - now)
      s.state = SETTLE
      s.flip = Infinity
    }
    s.until = now + dur
    this._lastEnd = s.until
  }

  _lock(s) {
    s.state = LOCK
    s.glyph.textContent = s.ch
    s.slot.classList.remove('hot')
    s.slot.classList.add('on')
    this._locked++
  }

  _hide(force) {
    if (this._hidden) return
    this._hidden = true
    clearTimeout(this._watchdog)
    cancelAnimationFrame(this._raf)
    if (force) {
      // tab tersembunyi / rAF macet: kunci semua huruf sekaligus
      for (const s of this.letters) {
        if (s.state === LOCK) continue
        s.anim?.cancel()
        s.col?.remove()
        this._lock(s)
      }
    }
    if (this.pctEl) this.pctEl.textContent = '100'
    this._loaderEl.classList.add('hidden')
    performance.mark?.('loader:hidden')
    this._resolve?.()
  }

  _detach() {
    if (!this._attached) return
    this._attached = false
    window.fetch = this._fetch
    this._restore()
    bus.off('init_progress', this._onInit)
  }

  /**
   * Init selesai: sisa huruf dikejar sampai nama utuh, ditahan sebentar, lalu elemen loader dipudarkan.
   * Mengembalikan Promise yang selesai saat pudar dimulai (main.js memulai intro di titik itu).
   */
  finish(loaderEl = this.root) {
    this.done = true
    this.target = 1
    this._loaderEl = loaderEl
    this._detach()
    performance.mark?.('loader:finish')
    return new Promise((resolve) => {
      this._resolve = resolve
      this._watchdog = setTimeout(() => this._hide(true), TAIL_MAX)
    })
  }

  /** Gagal boot: hentikan animasi dan kembalikan fetch, elemen loader dipakai untuk pesan error. */
  stop() {
    this.done = true
    this._hidden = true
    this.shown = 1
    cancelAnimationFrame(this._raf)
    clearTimeout(this._watchdog)
    for (const s of this.letters) s.anim?.cancel()
    this._detach()
  }

  get progress() {
    return this.target
  }
}
