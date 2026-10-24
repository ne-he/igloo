// Data carousel link di ruang entry (M7b). Sengaja file terpisah dari content.js (dipegang agent lain).
// Tiap link: judul yang tampil, url (dibuka di tab baru lewat kotak "Visit"), volume SDF buatan sendiri
// (public/assets/volumes/<volume>.vol, dari tools/volumes/build_volumes.py), dan skala volume (makin besar = bentuk makin kecil).
// Judul tampil lewat atlas MSDF yang cuma berisi ASCII cetak, jadi judul harus ASCII.
//
// Link asli Nehemiah (17 Okt 2026). WhatsApp (19 Okt 2026) sama dengan kontak di situs ICEBERG miliknya
// (icev2/src/content.js, CONTACT.whatsapp). Link pertama = dirinya sendiri (avatar). Visit-nya membuka situs ini
// lagi dari awal (24 Okt 2026), url relatif '/' supaya ikut domain apa pun tempat situs ini di-deploy.
const links = [
  {
    title: 'Nehemiah',
    url: '/',
    volume: 'nehemiah_64',
    scale: 1.15,
  },
  {
    title: 'GitHub',
    url: 'https://github.com/ne-he',
    volume: 'github_64',
    scale: 1.2,
  },
  {
    title: 'LinkedIn',
    url: 'https://www.linkedin.com/in/nehemiahwj',
    volume: 'linkedin_64',
    scale: 1.3, // lempeng persegi penuh terlihat paling berat, dikecilkan sedikit
  },
  {
    title: 'WhatsApp',
    url: 'https://wa.me/6281911497766',
    volume: 'whatsapp_64',
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
