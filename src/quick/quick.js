import plexMonoUrl from '@ibm/plex-mono/fonts/complete/woff2/IBMPlexMono-Medium.woff2?url'
import content from '../content/content.js'
import links from '../content/links.js'

// Halaman ringkas tanpa 3D (quick.html, audit 10 Nov 2026). Untuk rekruter yang buru-buru, HP lemah, atau browser
// tanpa WebGL. Isinya SAMA dengan situs utama karena dibangun dari content.js dan links.js yang sama, jadi tidak
// ada salinan teks kedua yang bisa basi. DOM biasa, tanpa three, supaya terbuka seketika.

/** Bagian halaman dari daftar proyek content.js: [{ id, kicker, heading, summary, blocks, links }]. Murni, dites. */
export function quickSections(projects) {
  return projects.map((p) => {
    const kicker = String(p.title || '').split(' ')[0]
    return {
      id: p.slug,
      kicker,
      heading: p.heading || String(p.title || '').split(' ').slice(1).join(' '),
      summary: p.summary || '',
      blocks: (p.blocks || []).map((b) => ({ label: b.label, lines: b.lines.slice() })),
      links: (p.links || []).map((l) => ({ label: l.label, url: l.url })),
    }
  })
}

/** Link kontak dari carousel ruang link, tanpa item yang menunjuk ke situs ini sendiri ('/'). */
export function quickContacts(list) {
  return list.filter((l) => l.url !== '/').map((l) => ({ label: l.title.toUpperCase(), url: l.url }))
}

const el = (tag, props = {}, children = []) => {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'text') n.textContent = v
    else n.setAttribute(k, v)
  }
  n.append(...children)
  return n
}

const anchor = (label, url) => {
  const a = el('a', { href: url, text: label })
  if (!url.startsWith('mailto:') && !url.startsWith('/')) {
    a.target = '_blank'
    a.rel = 'noopener'
  }
  return a
}

function render() {
  const main = document.getElementById('quick')
  if (!main) return
  // pesan kalau dialihkan dari situs 3D yang gagal jalan
  const from = new URLSearchParams(location.search).get('from')
  const note = document.getElementById('note')
  if (note && from === 'no3d') {
    note.textContent = 'The 3D version could not start in this browser, so here is the same content as a simple page.'
    note.hidden = false
  }

  const sections = quickSections(content.projects)
  const jump = el('nav', { class: 'jump', 'aria-label': 'Sections' }, [
    ...sections.map((s) => el('a', { href: `#${s.id}`, text: s.heading.toUpperCase() })),
    el('a', { href: '#contact', text: 'CONTACT' }),
  ])
  main.append(jump)

  for (const s of sections) {
    const sec = el('section', { id: s.id }, [
      el('div', { class: 'kicker', text: s.kicker }),
      el('h2', { text: s.heading }),
      el('p', { class: 'sum', text: s.summary }),
    ])
    for (const b of s.blocks) {
      sec.append(el('div', { class: 'block' }, [
        el('h3', { text: b.label }),
        el('ul', {}, b.lines.map((line) => el('li', { text: line }))),
      ]))
    }
    if (s.links.length) sec.append(el('div', { class: 'links' }, s.links.map((l) => anchor(l.label, l.url))))
    main.append(sec)
  }

  const contacts = quickContacts(links)
  main.append(el('section', { id: 'contact' }, [
    el('div', { class: 'kicker', text: 'NEMI_SEC_04' }),
    el('h2', { text: 'Contact' }),
    el('p', { class: 'sum', text: 'The fastest way to reach me is email or WhatsApp.' }),
    el('div', { class: 'links' }, contacts.map((l) => anchor(l.label, l.url))),
  ]))
}

if (typeof document !== 'undefined') {
  // font sama dengan situs utama, dipasang setelah termuat supaya teks tidak pernah kosong
  new FontFace('IglooPlexMono', `url(${plexMonoUrl})`, { weight: '500' }).load()
    .then((f) => document.fonts.add(f)).catch(() => {})
  render()
}
