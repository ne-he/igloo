import { describe, it, expect, beforeEach } from 'vitest'
import { Router, parseRoute, projectPath, HOME } from '../src/router/Router.js'

// History palsu: tumpukan entri + indeks, back()/forward() memicu popstate seperti browser.
function fakeBrowser(initial = '/') {
  const listeners = new Set()
  const b = {
    stack: [initial],
    index: 0,
    location: { pathname: initial },
    events: {
      addEventListener: (t, f) => t === 'popstate' && listeners.add(f),
      removeEventListener: (t, f) => listeners.delete(f),
    },
    history: {
      pushState(_s, _t, url) {
        b.stack.splice(b.index + 1)
        b.stack.push(url)
        b.index++
        b.location.pathname = url
      },
      replaceState(_s, _t, url) {
        b.stack[b.index] = url
        b.location.pathname = url
      },
    },
    move(d) {
      b.index += d
      b.location.pathname = b.stack[b.index]
      for (const f of listeners) f()
    },
    back: () => b.move(-1),
    forward: () => b.move(1),
  }
  return b
}

const SLUGS = ['project-a', 'project-b', 'project-c']

function setup(initial = '/', { canEnter = true } = {}) {
  const b = fakeBrowser(initial)
  const calls = []
  const state = { canEnter }
  const router = new Router({
    history: b.history,
    location: b.location,
    events: b.events,
    slugs: SLUGS,
    canEnterProject: () => state.canEnter,
    onRoute: (route, info) => calls.push({ route, ...info }),
  })
  return { b, router, calls, state }
}

describe('parseRoute', () => {
  it('root dan index.html -> home', () => {
    expect(parseRoute('/')).toBe(HOME)
    expect(parseRoute('')).toBe(HOME)
    expect(parseRoute('/index.html')).toBe(HOME)
  })

  it('/portfolio/:slug -> project, garis miring ekor diabaikan', () => {
    expect(parseRoute('/portfolio/project-a')).toEqual({ name: 'project', path: '/portfolio/project-a', slug: 'project-a' })
    expect(parseRoute('/portfolio/project-a/').slug).toBe('project-a')
    expect(projectPath('project-b')).toBe('/portfolio/project-b')
  })

  it('path asing dan rute lama /project/ -> null', () => {
    expect(parseRoute('/project/project-a')).toBeNull()
    expect(parseRoute('/portfolio/')).toBeNull()
    expect(parseRoute('/portfolio/a/b')).toBeNull()
    expect(parseRoute('/foo')).toBeNull()
  })

  it('base selain root dipotong dulu', () => {
    expect(parseRoute('/study/portfolio/project-c', '/study/').slug).toBe('project-c')
    expect(parseRoute('/study/', '/study/')).toBe(HOME)
  })
})

describe('Router', () => {
  let ctx
  beforeEach(() => {
    ctx = setup('/')
  })

  it('start di root: satu onRoute first=true, history tidak berubah', () => {
    const r = ctx.router.start()
    expect(r.name).toBe('home')
    expect(ctx.calls).toHaveLength(1)
    expect(ctx.calls[0].first).toBe(true)
    expect(ctx.b.stack).toEqual(['/'])
  })

  it('deep link: navigasi pertama ke proyek lolos walau scene kristal belum terlihat', () => {
    const c = setup('/portfolio/project-b', { canEnter: false })
    const r = c.router.start()
    expect(r).toMatchObject({ name: 'project', slug: 'project-b' })
    expect(c.calls[0]).toMatchObject({ first: true, source: 'start' })
  })

  it('path asing dan slug asing di awal dialihkan ke / lewat replaceState', () => {
    for (const p of ['/nope', '/portfolio/unknown', '/project/project-a']) {
      const c = setup(p)
      expect(c.router.start()).toBe(HOME)
      expect(c.b.stack).toEqual(['/'])
      expect(c.b.location.pathname).toBe('/')
    }
  })

  it('go ke proyek: pushState + onRoute, rute sama diabaikan', () => {
    ctx.router.start()
    expect(ctx.router.go('/portfolio/project-a')).toBe(true)
    expect(ctx.b.stack).toEqual(['/', '/portfolio/project-a'])
    expect(ctx.calls.at(-1)).toMatchObject({ route: { slug: 'project-a' }, first: false, source: 'go', from: HOME })
    expect(ctx.router.go('/portfolio/project-a')).toBe(false)
    expect(ctx.calls).toHaveLength(2)
  })

  it('rute proyek ditolak kalau scene kristal tidak terlihat', () => {
    ctx.router.start()
    ctx.state.canEnter = false
    expect(ctx.router.go('/portfolio/project-a')).toBe(false)
    expect(ctx.b.stack).toEqual(['/'])
    expect(ctx.calls).toHaveLength(1)
  })

  it('go ditolak selama block', () => {
    ctx.router.start()
    ctx.router.block()
    expect(ctx.router.go('/portfolio/project-a')).toBe(false)
    ctx.router.unblock()
    expect(ctx.router.go('/portfolio/project-a')).toBe(true)
  })

  it('back browser menutup detail, forward membukanya lagi', () => {
    ctx.router.start()
    ctx.router.go('/portfolio/project-c')
    ctx.b.back()
    expect(ctx.calls.at(-1)).toMatchObject({ route: { name: 'home' }, source: 'popstate' })
    ctx.b.forward()
    expect(ctx.calls.at(-1)).toMatchObject({ route: { slug: 'project-c' }, source: 'popstate' })
    expect(ctx.calls).toHaveLength(4)
  })

  it('popstate selama transisi ditunda sampai unblock, history tetap utuh', () => {
    ctx.router.start()
    ctx.router.go('/portfolio/project-a')
    ctx.router.block()
    ctx.b.back()
    expect(ctx.calls).toHaveLength(2) // belum diproses
    expect(ctx.router.current.name).toBe('project')
    ctx.router.unblock()
    expect(ctx.calls.at(-1)).toMatchObject({ route: { name: 'home' }, source: 'popstate' })
    expect(ctx.b.stack).toEqual(['/', '/portfolio/project-a'])
    expect(ctx.b.index).toBe(0)
  })

  it('popstate tertunda yang kembali ke rute sekarang tidak memicu apa pun', () => {
    ctx.router.start()
    ctx.router.go('/portfolio/project-a')
    ctx.router.block()
    ctx.b.back()
    ctx.b.forward()
    ctx.router.unblock()
    expect(ctx.calls).toHaveLength(2)
  })

  it('forward ke proyek saat kristal tidak terlihat dipantulkan ke / (replaceState)', () => {
    ctx.router.start()
    ctx.router.go('/portfolio/project-b')
    ctx.b.back()
    ctx.state.canEnter = false
    ctx.b.forward()
    expect(ctx.b.location.pathname).toBe('/')
    expect(ctx.b.stack).toEqual(['/', '/'])
    expect(ctx.router.current.name).toBe('home')
    expect(ctx.calls).toHaveLength(3) // start, go, back; forward ditolak tanpa onRoute
  })

  it('stop melepas listener popstate', () => {
    ctx.router.start()
    ctx.router.go('/portfolio/project-a')
    ctx.router.stop()
    ctx.b.back()
    expect(ctx.calls).toHaveLength(2)
  })
})
