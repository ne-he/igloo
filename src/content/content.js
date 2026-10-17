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

  // 3 kristal portofolio: proyek live Nehemiah (fakta dari catatan projek, 17 Okt 2026).
  // Detail view (M6, rute /portfolio/<slug>):
  //   description = paragraf panel teks (PLACEHOLDER, jangan dianggap copy asli)
  //   links = chip [X] [IG] [LI] [TK], dibuka di tab baru. URL example.com = PLACEHOLDER, ganti dengan link asli.
  projects: [
    {
      slug: 'iceberg',
      title: 'PORTFOLIO_CO_01 ICEBERG',
      date: '03/10/2026', // ICEBERG v2, catatan projek 3 Okt 2026
      temp: 1.05,
      crystal: 'crystal1',
      inner: 'inner1',
      summary: 'A scrollable 3D web CV.',
      description: [
        'ICEBERG is my CV told as a 3D descent: an ice cave, an ice block portal, a particle world and a '
          + 'face, all driven by scroll. Built with React Three Fiber, drei and Blender assets.',
        'The Ask Nemi chatbot lives inside it through a small API proxy, so visitors can ask about my work '
          + 'without leaving the scene.',
      ],
      links: [
        { label: 'LIVE', url: 'https://ice-nemi.vercel.app' },
        { label: 'GH', url: 'https://github.com/ne-he/icee' },
      ],
    },
    {
      slug: 'ask-nemi',
      title: 'PORTFOLIO_CO_02 ASK-NEMI',
      date: '08/06/2026', // live sejak 8 Jun 2026
      temp: -2.4,
      crystal: 'crystal2',
      inner: 'inner2',
      summary: 'A RAG chatbot that answers questions about my resume.',
      description: [
        'Ask Nemi answers questions about my background from a knowledge base I maintain. Next.js App '
          + 'Router, Gemini, and Supabase pgvector with 768 dimension embeddings.',
        'Retrieval is hybrid: dense search and BM25 merged with reciprocal rank fusion, plus a confidence '
          + 'gate so the bot says it does not know instead of guessing.',
      ],
      links: [
        { label: 'LIVE', url: 'https://web-portofolio-rag.vercel.app' },
        { label: 'GH', url: 'https://github.com/ne-he/web_portofolio_RAG' },
      ],
    },
    {
      slug: 'verdict-analyst',
      title: 'PORTFOLIO_CO_03 VERDICT',
      date: '08/08/2026', // M2 + deploy 8 Agu 2026
      temp: 0.6,
      crystal: 'crystal3',
      inner: 'inner3',
      summary: 'An analytics agent with a causal inference engine.',
      description: [
        'VERDICT ANALYST is an agent that turns a data question into an analysis plan, runs it, and '
          + 'reports what the numbers support. The frontend runs on Vercel, the backend on a Hugging Face Space.',
        'Runs keep durable state, and the agent is tested against adversarial prompts so it refuses '
          + 'conclusions the data cannot back.',
      ],
      links: [
        { label: 'LIVE', url: 'https://agentic-verdict-sand.vercel.app' },
        { label: 'GH', url: 'https://github.com/ne-he/agentic_verdict' },
      ],
    },
  ],

  // 3 bentuk partikel di ruang link. URL sengaja kosong sampai Nehemiah memilih.
  // Data link ruang partikel yang dipakai ada di src/content/links.js.
}
