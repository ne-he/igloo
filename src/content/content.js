// Titik ganti konten (blueprint 7.5, meniru objek config igloo). Semua teks, proyek, dan link di sini.
// Brand belum diputuskan: "NEMI" cuma wordmark placeholder. Jangan pakai nama/aset igloo.
// Nilai bertanda [?] = belum ada data asli, JANGAN diisi tebakan (aturan L9).

export default {
  brand: {
    name: 'NEMI',
    logoSvg: null, // [?] belum ada logo, sementara wordmark MSDF dari font
  },

  // Pojok kiri cuma wordmark NEMI (permintaan Nehemiah 24 Okt 2026). Isi lagi { title, text } kalau baris
  // copyright mau dimunculkan kembali, UIScene melewatinya kalau null.
  copyright: null,

  ui: {
    scrollHint: 'Scroll down to discover.', // hint lama, sekarang cuma di salinan DOM a11y
    // cue scroll tengah bawah (ScrollCue.js), versi sentuh dan versi sesudah semua fakta igloo ketemu. ASCII saja.
    scrollCue: 'SCROLL TO ENTER',
    scrollCueTouch: 'SWIPE UP TO ENTER',
    scrollCueDone: 'ALL FOUND. NOW SCROLL',
    scrollCueDoneTouch: 'ALL FOUND. NOW SWIPE UP',
    // indeks section kanan bawah (SectionIndex.js), urutan sama dengan SECTIONS di sections.js
    sections: ['IGLOO', 'WORK', 'LINKS'],
    sectionsLabel: 'Sections', // aria-label navigasi a11y
    sound: { label: 'Sound:', on: 'On', off: 'Off' },
    close: 'Close', // tombol tutup detail proyek (M6)
    // kartu fakta bata igloo ('FACT 03/12') dan penghitung ('FOUND 3/12'), {total} = jumlah iglooFacts
    facts: { header: 'FACT', found: 'FOUND', complete: 'ALL {total} FOUND' },
    // label kristal: tombol buka detail + ajakan saat pengunjung diam (ASCII saja, atlas font)
    crystal: { open: '[ OPEN ]', nudge: 'CLICK THE ICE', nudgeTouch: 'TAP THE ICE' },
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

  // 3 kristal = profil Nehemiah, ditulis ulang dari konten ICEBERG v2 (icev2/src/content.js, sudah
  // diverifikasi di sana). Angka dan klaim harus sama persis dengan sumbernya, jangan ditambah (L9).
  // Font atlas cuma punya ASCII + (c) (r) dan beberapa tanda kutip, jadi jangan pakai simbol lain.
  projects: [
    {
      slug: 'about',
      title: 'NEMI_SEC_01 ABOUT',
      date: '17/10/2026', // tanggal konten diperbarui
      temp: 1.05,
      crystal: 'crystal1',
      inner: 'inner1',
      summary: 'Nehemiah Wilhelmus Junaidi, Data Science at BINUS University.',
      description: [
        'NEHEMIAH WILHELMUS JUNAIDI. Data Science undergraduate at BINUS University, Jakarta. Semester 5, '
          + 'building at the intersection of machine learning and the web. Open to AI/ML and data internships.',
        'EDUCATION. Bachelor of Data Science, School of Computer Science, BINUS University, on a full '
          + 'four-year merit-based scholarship. Coursework in machine learning, deep learning, statistics, '
          + 'databases and big data. BINUS Ambassador, and a participant in the DataHeist 2025 ML competition.',
        'WHAT I DO. End-to-end work: from raw data and model training to the interface people actually touch. '
          + 'Agentic workflows by default: LLM pipelines, automation-first tooling, ship fast and iterate.',
        'STACK. Python, pandas, NumPy, Polars, DuckDB, SQL. scikit-learn, CatBoost, PyTorch, TensorFlow and Keras. '
          + 'Gemini API, RAG with hybrid dense and BM25 retrieval, pgvector, golden-set evals. FastAPI, PostgreSQL, '
          + 'Redis, Docker, GitHub Actions, MLflow. Three.js, React Three Fiber, Next.js, TypeScript, Blender, GSAP.',
        'CERTIFICATIONS. NVIDIA: Deep Learning (PyTorch). RevoU: Applied AI and Integration. DSarea: AI '
          + 'Engineering and Data Mining. MySkill: Data Analyst and Visualization. talenta.id: n8n Automation.',
        'LANGUAGES. Indonesian, native. English, professional working proficiency (IELTS 6.5). Mandarin, '
          + 'elementary and still learning.',
      ],
      links: [
        { label: 'CV', url: 'https://ice-nemi.vercel.app/Nehemiah-Wilhelmus-Junaidi-CV.pdf' },
        { label: 'GH', url: 'https://github.com/ne-he' },
        { label: 'LI', url: 'https://www.linkedin.com/in/nehemiahwj/' },
        { label: 'MAIL', url: 'mailto:nehewj@gmail.com' },
      ],
    },
    {
      slug: 'journey',
      title: 'NEMI_SEC_02 JOURNEY',
      date: '17/10/2026',
      temp: -2.4,
      crystal: 'crystal2',
      inner: 'inner2',
      summary: 'How I got here, from first datasets to deployed systems.',
      description: [
        'MAR TO SEP 2024 / HOPHOP OFFICE. Content creator and event organizer intern for the Genshin Impact x '
          + 'HopHop Indonesia 2024 event. The same year, a liaison officer at the BNI National Conference 2024, '
          + 'escorting international directors.',
        '2024 / BINUS UNIVERSITY. Started the Data Science program in Jakarta on a full merit scholarship. '
          + 'First lines of Python, first real datasets.',
        'AUG 2024 TO NOW / BINUS ADMISSIONS. Admissions marketing alongside the degree: campus tours, workshops '
          + 'and aptitude-test sessions, presenting every week. Personal record of 45 enrollments in a single '
          + 'month against a monthly target of 3.',
        'JUL 2025 TO MAY 2026 / PERFORMING-ARTS COACH. Coached around 40 high-school students for storytelling '
          + 'and monologue competitions. Students took 1st place at FLS3N Storytelling and went on to the '
          + 'provincial round.',
        'EARLY 2026 / OUT OF THE NOTEBOOK. Churn modelling, credit scoring and end-to-end cases stopped ending '
          + 'at the last notebook cell. Each one got pushed into a FastAPI service and a deployed endpoint.',
        'MID 2026 / PRODUCTION HABITS. The Feature Store, the CatBoost rebuild and the CNN benchmark. The shift '
          + 'was from a model that works to tests, CI, Docker, model cards, and honest failure modes.',
        'SEP 2026 / SEMESTER 5. Taking earlier builds all the way to public. FinSight was rewritten into one '
          + 'deployed Next.js app, and KENNETH, a parking app for a venture course team, went live on Firebase.',
      ],
      links: [
        { label: 'CV', url: 'https://ice-nemi.vercel.app/Nehemiah-Wilhelmus-Junaidi-CV.pdf' },
        { label: 'ICEBERG', url: 'https://ice-nemi.vercel.app' },
      ],
    },
    {
      slug: 'projects',
      title: 'NEMI_SEC_03 PROJECTS',
      date: '17/10/2026',
      temp: 0.6,
      crystal: 'crystal3',
      inner: 'inner3',
      summary: 'Selected work. All repos at github.com/ne-he.',
      description: [
        'VERDICT ANALYST. A data-analyst agent that writes and runs its own code in a locked Docker sandbox, '
          + 'then recomputes every number a second way, pandas against DuckDB SQL. Causal questions route to a '
          + 'deterministic statistics engine, never to the language model.',
        'FINSIGHT V2. Answers questions from SEC 10-K filings, cited down to the section, or refuses. Hybrid '
          + 'retrieval with RRF and a measured refusal gate: hit-rate@6 18/18, out-of-scope refusals 4/4, zero '
          + 'false refusals.',
        'ASK NEMI. A portfolio you talk to instead of read. Gemini embeddings over a personal knowledge base in '
          + 'Supabase pgvector, hybrid retrieval, a confidence gate and streamed answers with citations.',
        'PHISHGUARD V2. Phishing URL detection API: blocklist, allowlist, then a small model on MiniLM '
          + 'embeddings plus 20 lexical features. 95.70% accuracy and 95.80% recall on a 1,000-URL holdout, '
          + '37 tests.',
        'FEATURE STORE MVP. An e-commerce feature store end to end: 23 user features, PostgreSQL offline and '
          + 'Redis online, one user served in about 22 ms, drift dashboard, 174 tests at 95% coverage.',
        'WASTE CLASSIFIER. Three CNNs benchmarked on TrashNet in PyTorch. ResNet50 won at 91.6% test accuracy '
          + '(macro AUC 0.99) and runs the live demo with Grad-CAM.',
        'ICEBERG. My 3D web CV: React Three Fiber, Blender assets through an agentic pipeline, real-time '
          + 'refraction, and the Ask Nemi chat inside.',
      ],
      links: [
        { label: 'VERDICT', url: 'https://agentic-verdict-sand.vercel.app' },
        { label: 'FINSIGHT', url: 'https://finsight-v2-nine.vercel.app' },
        { label: 'ASK NEMI', url: 'https://web-portofolio-rag.vercel.app' },
        { label: 'GH', url: 'https://github.com/ne-he' },
      ],
    },
  ],

  // Data link ruang partikel yang dipakai ada di src/content/links.js.
}

// Fakta pendek yang muncul saat bata igloo di-hover (src/scenes/igloo/BrickFacts.js). Semua dari kata-kata
// Nehemiah sendiri atau profil yang sudah diverifikasi, jangan tambah fakta karangan (L9). Isinya yang
// menggambarkan siapa dia saja (24 Okt 2026: IELTS dan DataHeist dibuang). Tiap fakta cuma muncul di SATU bata,
// dipilih dari bata yang menghadap kamera titik istirahat dan disebar rata (facts.js). Bata lain tetap melayang
// saat di-hover, tanpa label. ASCII saja, atlas font tidak punya simbol lain. Maks sekitar 24 huruf.
export const iglooFacts = [
  'BINUSIAN 2028',
  'INDONESIAN',
  'DATA SCIENCE',
  'BASED IN JAKARTA',
  'FULL MERIT SCHOLARSHIP',
  'BINUS AMBASSADOR',
  'FUTURE AI / ML ENGINEER',
  '12+ LIVE DEMOS SHIPPED',
  'BLENDER + THREE.JS',
  'STORYTELLING COACH',
  'LEARNING MANDARIN',
  'GYM: PUSH / PULL / LEGS',
]
