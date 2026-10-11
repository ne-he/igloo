// Titik ganti konten (blueprint 7.5, meniru objek config igloo). Semua teks, proyek, dan link di sini.
// Brand belum diputuskan: "NEMI" cuma wordmark placeholder. Jangan pakai nama/aset igloo.
// Nilai bertanda [?] = belum ada data asli, JANGAN diisi tebakan (aturan L9).

export default {
  brand: {
    name: 'NEMI',
    logoSvg: null, // [?] belum ada logo, sementara wordmark MSDF dari font
  },

  // Di igloo, copyright dan manifesto hidup di dalam scene igloo (kena LUT + transisi).
  // Sementara copyright ditaruh di UIScene, lihat src/scenes/ui/UIScene.js.
  copyright: {
    title: '// Copyright © 2026',
    text: 'NEMI.\nAll Rights Reserved.',
  },

  ui: {
    scrollHint: 'Scroll down to discover.',
    sound: { label: 'Sound:', on: 'On', off: 'Off' },
  },

  manifesto: {
    title: '////// Manifesto',
    // PLACEHOLDER: copy asli menyusul dari Nehemiah. Empat baris pendek ini cuma pengisi layout.
    text: [
      'We build small, honest tools',
      'at the edge of data, design,',
      'and machine learning, one',
      'shipped project at a time.',
    ],
  },

  // 3 kristal portofolio. Semua isi placeholder sampai keputusan K2 (proyek mana yang dipajang).
  projects: [
    {
      slug: 'project-a',
      title: 'PORTFOLIO_CO_01 PLACEHOLDER A',
      date: 'dd/mm/yyyy', // [?]
      temp: 1.05,
      crystal: 'crystal1',
      inner: 'inner1',
      summary: 'Placeholder summary for project A. Real copy pending.',
      links: [{ label: 'GH', url: '' }], // [?]
    },
    {
      slug: 'project-b',
      title: 'PORTFOLIO_CO_02 PLACEHOLDER B',
      date: 'dd/mm/yyyy', // [?]
      temp: -2.4,
      crystal: 'crystal2',
      inner: 'inner2',
      summary: 'Placeholder summary for project B. Real copy pending.',
      links: [{ label: 'GH', url: '' }], // [?]
    },
    {
      slug: 'project-c',
      title: 'PORTFOLIO_CO_03 PLACEHOLDER C',
      date: 'dd/mm/yyyy', // [?]
      temp: 0.6,
      crystal: 'crystal3',
      inner: 'inner3',
      summary: 'Placeholder summary for project C. Real copy pending.',
      links: [{ label: 'GH', url: '' }], // [?]
    },
  ],

  // 3 bentuk partikel di ruang link. URL sengaja kosong sampai Nehemiah memilih.
  links: [
    { title: 'GitHub', url: '', volume: 'github_64', scale: 1.2 }, // [?]
    { title: 'LinkedIn', url: '', volume: 'linkedin_64', scale: 1.3 }, // [?]
    { title: 'Email', url: '', volume: 'email_64', scale: 1.25 }, // [?]
  ],
}
