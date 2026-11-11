import { DefaultLoadingManager } from 'three'

// Versi aset (audit 10 Nov 2026). File di public/assets dan public/draco tidak punya hash di namanya, jadi dulu
// Vercel menyajikannya dengan "max-age=0, must-revalidate": tiap kunjungan ulang memeriksa ulang puluhan file.
// Sekarang tiap URL aset diberi "?v=<id build>" dan vercel.json memberi cache setahun (immutable). Build baru =
// id baru = URL baru, jadi pengunjung tidak pernah mendapat aset lama yang tidak cocok dengan kode baru.
// Di dev id-nya kosong dan tidak ada yang diubah.

/* global __BUILD_ID__ */
export const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : ''

const VERSIONED = /^\/(assets|draco)\//

/** URL aset dengan versi build. URL lain (data:, blob:, luar situs, sudah punya query) dikembalikan apa adanya. */
export function versioned(url, id = BUILD_ID) {
  if (!id || typeof url !== 'string' || !VERSIONED.test(url) || url.includes('?')) return url
  return `${url}?v=${id}`
}

/** Pasang sekali di awal: loader three (tekstur, glb, HDR, decoder Draco) dan fetch() biasa (json font, volume, audio). */
export function installAssetVersion() {
  if (!BUILD_ID) return
  DefaultLoadingManager.setURLModifier((url) => versioned(url))
  const orig = window.fetch
  window.fetch = (input, init) => orig.call(window, typeof input === 'string' ? versioned(input) : input, init)
}
