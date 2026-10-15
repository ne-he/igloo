// Router mikro (blueprint 6.6, skill ref 01 bagian 6.2): pushState/replaceState + popstate, gaya navaid.
// Rute: '/' (home) dan '/portfolio/:slug' (detail proyek). Path lain dialihkan ke '/'.
// Logika murni: history, location, dan target event disuntik, jadi bisa dites di node tanpa DOM.
//
// Aturan:
//  - Rute proyek ditolak kalau canEnterProject() false (scene kristal tidak terlihat). Kecuali navigasi
//    pertama (deep link): main.js sendiri yang memindahkan scroll ke kristalnya.
//  - Selama block(): go() ditolak. popstate (back/forward browser) ditunda, lalu dijalankan saat unblock(),
//    supaya urutan history browser tetap utuh.
//  - Slug yang tidak dikenal dialihkan ke '/'.

export const PROJECT_PREFIX = '/portfolio/'

export const HOME = Object.freeze({ name: 'home', path: '/' })

/** Path untuk slug proyek. */
export const projectPath = (slug) => `${PROJECT_PREFIX}${encodeURIComponent(slug)}`

/**
 * Path -> rute. Mengembalikan null kalau path tidak dikenal.
 * @param {string} pathname
 * @param {string} [base='/'] BASE_URL Vite (selalu diakhiri '/')
 */
export function parseRoute(pathname, base = '/') {
  let p = String(pathname || '/')
  if (base !== '/' && p.startsWith(base)) p = '/' + p.slice(base.length)
  p = p.replace(/index\.html$/, '')
  if (p.length > 1) p = p.replace(/\/+$/, '')
  if (p === '' || p === '/') return HOME
  if (p.startsWith(PROJECT_PREFIX)) {
    const rest = p.slice(PROJECT_PREFIX.length)
    if (!rest || rest.includes('/')) return null
    let slug
    try {
      slug = decodeURIComponent(rest)
    } catch {
      return null
    }
    return { name: 'project', path: projectPath(slug), slug }
  }
  return null
}

export class Router {
  /**
   * @param {object} o
   * @param {History} o.history
   * @param {Location} o.location
   * @param {EventTarget} o.events sumber popstate (window)
   * @param {string[]} o.slugs slug proyek yang sah
   * @param {() => boolean} [o.canEnterProject] scene kristal sedang terlihat?
   * @param {(route, info: {first: boolean, from: object|null, source: string}) => void} o.onRoute
   * @param {string} [o.base='/']
   */
  constructor({ history, location, events, slugs, canEnterProject = () => true, onRoute, base = '/' }) {
    this.history = history
    this.location = location
    this.events = events
    this.slugs = new Set(slugs)
    this.canEnterProject = canEnterProject
    this.onRoute = onRoute
    this.base = base
    this.current = null
    this.blocked = false
    this.pending = null // path popstate yang ditunda selama block
    this._onPop = () => this._popstate()
  }

  _url(path) {
    return this.base === '/' ? path : this.base.replace(/\/$/, '') + path
  }

  /** Rute dari path, slug asing dan path asing jadi null. */
  resolve(path) {
    const r = parseRoute(path, this.base)
    if (!r) return null
    if (r.name === 'project' && !this.slugs.has(r.slug)) return null
    return r
  }

  /**
   * Navigasi pertama dari URL sekarang. Path tak dikenal diganti '/' lewat replaceState.
   * @returns rute awal
   */
  start() {
    this.events.addEventListener('popstate', this._onPop)
    let route = this.resolve(this.location.pathname)
    if (!route) {
      route = HOME
      this.history.replaceState({ path: route.path }, '', this._url(route.path))
    }
    this.current = route
    this.onRoute(route, { first: true, from: null, source: 'start' })
    return route
  }

  stop() {
    this.events.removeEventListener('popstate', this._onPop)
  }

  /**
   * Navigasi programatik (klik kristal, tombol Close, Escape).
   * @returns true kalau navigasi dijalankan
   */
  go(path, { replace = false } = {}) {
    if (this.blocked) return false
    const route = this.resolve(path)
    if (!route) return false
    if (this.current && route.path === this.current.path) return false
    if (route.name === 'project' && !this.canEnterProject()) return false
    const method = replace ? 'replaceState' : 'pushState'
    this.history[method]({ path: route.path }, '', this._url(route.path))
    this._apply(route, 'go')
    return true
  }

  block() {
    this.blocked = true
  }

  /** Buka blok, lalu jalankan popstate yang tertunda (kalau berbeda dari rute sekarang). */
  unblock() {
    this.blocked = false
    const path = this.pending
    this.pending = null
    if (path != null) this._handlePath(path)
  }

  _popstate() {
    const path = this.location.pathname
    if (this.blocked) {
      this.pending = path
      return
    }
    this._handlePath(path)
  }

  _handlePath(path) {
    let route = this.resolve(path)
    if (route && route.name === 'project' && !this.canEnterProject()) route = null
    if (!route) {
      // ditolak / tak dikenal: pantulkan ke '/' tanpa menambah entri history
      route = HOME
      this.history.replaceState({ path: route.path }, '', this._url(route.path))
    }
    if (this.current && route.path === this.current.path) return
    this._apply(route, 'popstate')
  }

  _apply(route, source) {
    const from = this.current
    this.current = route
    this.onRoute(route, { first: false, from, source })
  }
}
