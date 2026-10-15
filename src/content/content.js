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
    close: 'Close', // tombol tutup detail proyek (M6)
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
  // Detail view (M6, rute /portfolio/<slug>):
  //   description = paragraf panel teks (PLACEHOLDER, jangan dianggap copy asli)
  //   links = chip [X] [IG] [LI] [TK], dibuka di tab baru. URL example.com = PLACEHOLDER, ganti dengan link asli.
  projects: [
    {
      slug: 'project-a',
      title: 'PORTFOLIO_CO_01 PLACEHOLDER A',
      date: 'dd/mm/yyyy', // [?]
      temp: 1.05,
      crystal: 'crystal1',
      inner: 'inner1',
      summary: 'Placeholder summary for project A. Real copy pending.',
      // PLACEHOLDER [?]: dua paragraf pengisi layout panel, copy asli menyusul dari Nehemiah
      description: [
        'Placeholder description for project A. This paragraph only exists to fill the detail panel '
          + 'layout while the real copy is pending. It describes nothing real and should be replaced.',
        'Second placeholder paragraph for project A. Lorem-style filler text that wraps across several '
          + 'lines so the column width, line height and panel scroll can be checked against the reference.',
      ],
      // PLACEHOLDER [?]: URL contoh, bukan akun asli
      links: [
        { label: 'X', url: 'https://example.com/placeholder-x' },
        { label: 'IG', url: 'https://example.com/placeholder-ig' },
        { label: 'LI', url: 'https://example.com/placeholder-li' },
        { label: 'TK', url: 'https://example.com/placeholder-tk' },
      ],
    },
    {
      slug: 'project-b',
      title: 'PORTFOLIO_CO_02 PLACEHOLDER B',
      date: 'dd/mm/yyyy', // [?]
      temp: -2.4,
      crystal: 'crystal2',
      inner: 'inner2',
      summary: 'Placeholder summary for project B. Real copy pending.',
      // PLACEHOLDER [?]: dua paragraf pengisi layout panel, copy asli menyusul dari Nehemiah
      description: [
        'Placeholder description for project B. This paragraph only exists to fill the detail panel '
          + 'layout while the real copy is pending. It describes nothing real and should be replaced.',
        'Second placeholder paragraph for project B. Lorem-style filler text that wraps across several '
          + 'lines so the column width, line height and panel scroll can be checked against the reference.',
      ],
      // PLACEHOLDER [?]: URL contoh, bukan akun asli
      links: [
        { label: 'X', url: 'https://example.com/placeholder-x' },
        { label: 'IG', url: 'https://example.com/placeholder-ig' },
        { label: 'LI', url: 'https://example.com/placeholder-li' },
        { label: 'TK', url: 'https://example.com/placeholder-tk' },
      ],
    },
    {
      slug: 'project-c',
      title: 'PORTFOLIO_CO_03 PLACEHOLDER C',
      date: 'dd/mm/yyyy', // [?]
      temp: 0.6,
      crystal: 'crystal3',
      inner: 'inner3',
      summary: 'Placeholder summary for project C. Real copy pending.',
      // PLACEHOLDER [?]: dua paragraf pengisi layout panel, copy asli menyusul dari Nehemiah
      description: [
        'Placeholder description for project C. This paragraph only exists to fill the detail panel '
          + 'layout while the real copy is pending. It describes nothing real and should be replaced.',
        'Second placeholder paragraph for project C. Lorem-style filler text that wraps across several '
          + 'lines so the column width, line height and panel scroll can be checked against the reference.',
      ],
      // PLACEHOLDER [?]: URL contoh, bukan akun asli
      links: [
        { label: 'X', url: 'https://example.com/placeholder-x' },
        { label: 'IG', url: 'https://example.com/placeholder-ig' },
        { label: 'LI', url: 'https://example.com/placeholder-li' },
        { label: 'TK', url: 'https://example.com/placeholder-tk' },
      ],
    },
  ],

  // 3 bentuk partikel di ruang link. URL sengaja kosong sampai Nehemiah memilih.
  links: [
    { title: 'GitHub', url: '', volume: 'github_64', scale: 1.2 }, // [?]
    { title: 'LinkedIn', url: '', volume: 'linkedin_64', scale: 1.3 }, // [?]
    { title: 'Email', url: '', volume: 'email_64', scale: 1.25 }, // [?]
  ],
}
