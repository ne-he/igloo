// Data carousel link di ruang entry (M7b). Sengaja file terpisah dari content.js (dipegang agent lain).
// Tiap link: judul yang tampil, url (dibuka di tab baru lewat kotak "Visit"), volume SDF buatan sendiri
// (public/assets/volumes/<volume>.vol, dari tools/volumes/build_volumes.py), dan skala volume (makin besar = bentuk makin kecil).
//
// PLACEHOLDER: semua url di bawah BELUM url asli Nehemiah. Ganti sebelum ship (M9), lalu hapus flag placeholder.
const links = [
  {
    title: 'GitHub',
    url: 'https://github.com/', // PLACEHOLDER, ganti ke profil asli
    volume: 'github_64',
    scale: 1.15,
    placeholder: true,
  },
  {
    title: 'LinkedIn',
    url: 'https://www.linkedin.com/', // PLACEHOLDER, ganti ke profil asli
    volume: 'linkedin_64',
    scale: 1.2,
    placeholder: true,
  },
  {
    title: 'Email',
    url: 'mailto:hello@example.com', // PLACEHOLDER, ganti ke alamat asli
    volume: 'email_64',
    scale: 1.2,
    placeholder: true,
  },
]

export default links
