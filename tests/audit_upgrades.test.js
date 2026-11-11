import { describe, it, expect } from 'vitest'
import { versioned } from '../src/engine/assetVersion.js'
import { layoutTopLinks, TOP_LINKS } from '../src/scenes/ui/TopLinks.js'
import { quickSections, quickContacts } from '../src/quick/quick.js'
import content from '../src/content/content.js'
import links from '../src/content/links.js'

describe('versi aset', () => {
  it('menambah ?v= hanya ke aset situs sendiri', () => {
    expect(versioned('/assets/textures/a.webp', 'abc')).toBe('/assets/textures/a.webp?v=abc')
    expect(versioned('/draco/draco_decoder.wasm', 'abc')).toBe('/draco/draco_decoder.wasm?v=abc')
    expect(versioned('/quick.html', 'abc')).toBe('/quick.html')
    expect(versioned('https://example.com/assets/a.png', 'abc')).toBe('https://example.com/assets/a.png')
    expect(versioned('data:image/png;base64,AAAA', 'abc')).toBe('data:image/png;base64,AAAA')
    expect(versioned('/assets/a.png?x=1', 'abc')).toBe('/assets/a.png?x=1')
  })
  it('tanpa id build (dev) tidak mengubah apa pun', () => {
    expect(versioned('/assets/textures/a.webp', '')).toBe('/assets/textures/a.webp')
  })
})

describe('tombol cepat kanan atas', () => {
  const lay = layoutTopLinks({ right: 1000, baseline: 60, size: 12, capHeight: 0.7 }, [44, 100])
  it('rata kanan, urutan kiri ke kanan, tidak bertumpuk', () => {
    expect(lay.items[1].x + lay.items[1].width).toBe(1000)
    expect(lay.items[0].x + lay.items[0].width).toBeLessThan(lay.items[1].x)
    expect(lay.items[1].x - (lay.items[0].x + lay.items[0].width)).toBeCloseTo(TOP_LINKS.gap * 12)
  })
  it('area klik lebih besar dari teks dan tidak saling menimpa', () => {
    expect(lay.hits[0].x1).toBeLessThanOrEqual(lay.hits[1].x0)
    expect(lay.hits[0].y1 - lay.hits[0].y0).toBeGreaterThanOrEqual(28)
  })
  it('isi dari content.js: CV tab baru, profil ringkas halaman sendiri, ASCII', () => {
    const t = content.ui.topLinks
    expect(t.length).toBe(2)
    expect(t[0].url).toMatch(/\.pdf$/)
    expect(t[0].newTab).toBe(true)
    expect(t[1].url).toBe('/quick.html')
    for (const l of t) expect(l.label).toMatch(/^[\x20-\x7e]+$/)
    for (const s of content.ui.sections) expect(s).toMatch(/^[\x20-\x7e]+$/)
  })
})

describe('profil ringkas', () => {
  it('memuat semua blok dan baris yang sama dengan panel detail', () => {
    const secs = quickSections(content.projects)
    expect(secs.map((s) => s.id)).toEqual(content.projects.map((p) => p.slug))
    secs.forEach((s, i) => {
      const p = content.projects[i]
      expect(s.heading).toBe(p.heading)
      expect(s.kicker).toMatch(/^NEMI_SEC_0\d$/)
      expect(s.blocks.flatMap((b) => b.lines)).toEqual(p.blocks.flatMap((b) => b.lines))
      expect(s.links.map((l) => l.url)).toEqual(p.links.map((l) => l.url))
    })
  })
  it('kontak = link ruang partikel tanpa link ke situs sendiri', () => {
    const c = quickContacts(links)
    expect(c.some((l) => l.url === '/')).toBe(false)
    expect(c.length).toBe(links.length - 1)
    expect(c.some((l) => l.url.startsWith('mailto:'))).toBe(true)
  })
})
