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
  // 26 Okt 2026: ditulis ulang jadi kalimat pendek per blok supaya orang non-IT gampang membaca.
  // heading = kata besar di panel detail, summary = satu kalimat pembuka, blocks = { label, lines } (DetailPanel).
  // Font atlas cuma punya ASCII + (c) (r) dan beberapa tanda kutip, jadi jangan pakai simbol lain.
  projects: [
    {
      slug: 'about',
      title: 'NEMI_SEC_01 ABOUT',
      date: '17/10/2026', // tanggal konten diperbarui
      temp: 1.05,
      crystal: 'crystal1',
      inner: 'inner1',
      heading: 'About',
      summary: 'Data Science student in Jakarta. I turn data into AI tools and websites people can use.',
      blocks: [
        { label: 'WHO I AM', lines: [
          'Nehemiah Wilhelmus Junaidi, from Jakarta, Indonesia.',
          'Data Science student at BINUS University, semester 5.',
          'Looking for AI, machine learning and data internships.',
        ] },
        { label: 'STUDY', lines: [
          'Bachelor of Data Science, School of Computer Science, BINUS.',
          'Full four-year merit scholarship.',
          'Classes in machine learning, deep learning, statistics, databases and big data.',
          'BINUS Ambassador. Took part in the DataHeist 2025 ML competition.',
        ] },
        { label: 'WHAT I DO', lines: [
          'I take a project from raw data all the way to the screen people tap on.',
          'Clean the data, train the model, then build the app around it.',
          'AI agents handle the repetitive parts, so I ship fast and keep improving.',
        ] },
        { label: 'TOOLS I USE', lines: [
          'Data: Python, pandas, NumPy, Polars, DuckDB, SQL.',
          'Machine learning: scikit-learn, CatBoost, PyTorch, TensorFlow, Keras.',
          'AI search and chat: Gemini API, RAG with hybrid dense + BM25 search, pgvector, golden-set tests.',
          'Servers: FastAPI, PostgreSQL, Redis, Docker, GitHub Actions, MLflow.',
          'Web and 3D: Three.js, React Three Fiber, Next.js, TypeScript, Blender, GSAP.',
        ] },
        { label: 'CERTIFICATES', lines: [
          'NVIDIA: Deep Learning (PyTorch).',
          'RevoU: Applied AI and Integration.',
          'DSarea: AI Engineering and Data Mining.',
          'MySkill: Data Analyst and Visualization.',
          'talenta.id: n8n Automation.',
        ] },
        { label: 'LANGUAGES', lines: [
          'Indonesian: native.',
          'English: professional working level (IELTS 6.5).',
          'Mandarin: beginner, still learning.',
        ] },
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
      heading: 'Journey',
      summary: 'How I got here, from my first dataset to apps that are live online.',
      blocks: [
        { label: 'MAR TO SEP 2024 / HOPHOP OFFICE', lines: [
          'Content and event intern for the Genshin Impact x HopHop Indonesia 2024 event.',
          'Same year: liaison officer at the BNI National Conference 2024, escorting international directors.',
        ] },
        { label: '2024 / BINUS UNIVERSITY', lines: [
          'Started Data Science in Jakarta on a full merit scholarship.',
          'First lines of Python, first real datasets.',
        ] },
        { label: 'AUG 2024 TO NOW / BINUS ADMISSIONS', lines: [
          'Admissions marketing next to my degree: campus tours, workshops and test sessions.',
          'I present in front of people every week.',
          'Best month: 45 new students enrolled, against a monthly target of 3.',
        ] },
        { label: 'JUL 2025 TO MAY 2026 / STORYTELLING COACH', lines: [
          'Coached around 40 high school students for storytelling and monologue contests.',
          'My students won 1st place at FLS3N Storytelling and went on to the provincial round.',
        ] },
        { label: 'EARLY 2026 / FROM NOTEBOOK TO APP', lines: [
          'Projects like churn prediction and credit scoring stopped at a notebook before.',
          'Now each one becomes a working online service (FastAPI, deployed endpoint).',
        ] },
        { label: 'MID 2026 / BUILDING IT PROPERLY', lines: [
          'The Feature Store, a CatBoost rebuild and an image model benchmark.',
          'The shift: from a model that works to tests, CI, Docker, model cards and honest limits.',
        ] },
        { label: 'SEP 2026 / SEMESTER 5', lines: [
          'Taking older projects all the way to public.',
          'FinSight was rewritten into one live Next.js app.',
          'KENNETH, a parking app for a venture course team, went live on Firebase.',
        ] },
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
      heading: 'Projects',
      summary: 'Things I built. The code for all of them is on github.com/ne-he.',
      blocks: [
        { label: 'VERDICT ANALYST', lines: [
          'An AI data analyst you can ask questions about your data.',
          'It writes and runs its own code inside a locked box (Docker sandbox).',
          'Every number is calculated twice, two different ways (pandas and DuckDB SQL).',
          'Cause-and-effect questions go to a statistics engine, never to the AI.',
        ] },
        { label: 'FINSIGHT V2', lines: [
          'Answers questions about company annual reports (SEC 10-K filings).',
          'Points to the exact section it used, or says it cannot answer.',
          'Tested: right source found 18/18 (top 6), off-topic questions refused 4/4, zero wrong refusals.',
        ] },
        { label: 'ASK NEMI', lines: [
          'A chatbot about me. You ask, instead of reading a CV.',
          'It searches my own notes and shows where each answer came from.',
          'Built with Gemini, Supabase pgvector, hybrid search and a confidence check.',
        ] },
        { label: 'PHISHGUARD V2', lines: [
          'Checks whether a website link is a phishing scam.',
          'Blocklist, allowlist, then a small AI model (MiniLM + 20 link features).',
          'On 1,000 test links: 95.70% accuracy, 95.80% recall. 37 automated tests.',
        ] },
        { label: 'FEATURE STORE MVP', lines: [
          'Keeps shopper data ready for AI models in an online store.',
          '23 features per user, PostgreSQL for history and Redis for live use.',
          'Serves one user in about 22 ms. Drift dashboard, 174 tests, 95% coverage.',
        ] },
        { label: 'WASTE CLASSIFIER', lines: [
          'Sorts photos of trash by type.',
          'Three image models compared on TrashNet in PyTorch.',
          'ResNet50 won: 91.6% accuracy (macro AUC 0.99). The live demo shows where it looks (Grad-CAM).',
        ] },
        { label: 'ICEBERG', lines: [
          'My 3D website CV.',
          'React Three Fiber, Blender models made with an AI agent pipeline, real-time ice refraction.',
          'The Ask Nemi chat is built in.',
        ] },
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
// menggambarkan siapa dia saja (24 Okt 2026: IELTS dan DataHeist dibuang). 26 Okt 2026: 70 fakta = 70 bata, tiap
// bata satu fakta unik. Urutan penting: fakta paling depan jatuh ke bata yang paling terlihat dari kamera (facts.js).
// Blok kedua = jawaban Nehemiah sendiri di chat 26 Okt. ASCII saja, atlas font tidak punya simbol lain. Maks 24 huruf.
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
  'PLAYS PIANO',
  'MUSIC LOVER',
  'MEAT LOVER',
  'COFFEE PERSON',
  'EDM ON REPEAT',
  'FAV FILM: AGAK LAEN',
  'PLAYS MOBILE LEGENDS',
  'ALSO PLAYS BASKETBALL',
  'FAV PLACE: HOME',
  'DREAM TRIP: NORWAY',
  'MOTTO: PAKE IMAN',
  'FRIENDS SAY: SELAW',
  'MORNING PERSON',
  'FUTURE CEO',
  'FIRST LANGUAGE: C',
  'INTP',
  'PYTHON + SQL',
  'PYTORCH + TENSORFLOW',
  'BUILT ASK NEMI CHATBOT',
  'BUILT VERDICT ANALYST',
  'PHISHGUARD: 95.7% ACC',
  'FEATURE STORE: 22 MS',
  'WASTE AI: 91.6% ACC',
  'MADE ICEBERG 3D CV',
  'FINSIGHT V2 BUILDER',
  'KENNETH PARKING APP',
  'NVIDIA DEEP LEARNING',
  '45 SIGN-UPS IN A MONTH',
  'COACHED FLS3N WINNERS',
  '40 STUDENTS COACHED',
  'HOPHOP 2024 INTERN',
  'BNI CONFERENCE LO 2024',
  'PRESENTS EVERY WEEK',
  'N8N AUTOMATION',
  'DOCKER + FASTAPI',
  'RAG + GEMINI API',
  'NEXT.JS + TYPESCRIPT',
  'AGENTIC WORKFLOWS',
  'BUILDS 3D WEBSITES',
  'SHIP FAST, ITERATE',
  'SEMESTER 5',
  'MODEL CARDS + CI',
  'REVOU: APPLIED AI',
  'DSAREA: AI ENGINEERING',
  'MYSKILL: DATA ANALYST',
  'SCIKIT-LEARN + CATBOOST',
  'PANDAS + POLARS + DUCKDB',
  'MLFLOW + GITHUB ACTIONS',
  'POSTGRES + REDIS',
  'CHURN MODEL TO API',
  'CREDIT SCORING API',
  'NLP ON 617K REVIEWS',
  'SWIFTUI NOTES APP',
  'SECOND BRAIN CLI',
  'JAKARTA AIR QUALITY AI',
  '174 TESTS, 95% COVERAGE',
  'OPEN TO INTERNSHIPS',
  'GITHUB: NE-HE',
]
