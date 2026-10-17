// Data carousel link di ruang entry (M7b). Sengaja file terpisah dari content.js (dipegang agent lain).
// Tiap link: judul yang tampil, url (dibuka di tab baru lewat kotak "Visit"), volume SDF buatan sendiri
// (public/assets/volumes/<volume>.vol, dari tools/volumes/build_volumes.py), dan skala volume (makin besar = bentuk makin kecil).
//
// Link asli Nehemiah (17 Okt 2026).
const links = [
  {
    title: 'GitHub',
    url: 'https://github.com/ne-he',
    volume: 'github_64',
    scale: 1.15,
  },
  {
    title: 'LinkedIn',
    url: 'https://www.linkedin.com/in/nehemiahwj',
    volume: 'linkedin_64',
    scale: 1.2,
  },
  {
    title: 'Email',
    url: 'mailto:nehewj@gmail.com',
    volume: 'email_64',
    scale: 1.2,
  },
]

export default links
