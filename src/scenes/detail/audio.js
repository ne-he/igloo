import { bus } from '../../engine/Bus.js'

// Hook audio no-op untuk M8 (blueprint 5.7). Semua bunyi lewat bus: emit 'audio_play' { name }.
// Sekarang belum ada pendengar, jadi tidak ada suara. Manajer audio M8 cukup bus.on('audio_play', ...).
// Nama mengikuti one-shot igloo (skill ref 01 bagian 6.2 dan 6.4).
export const SOUNDS = Object.freeze({
  click: 'click-project', // klik kristal
  enter: 'enter-project', // detail mulai terbuka (delay a)
  leave: 'leave-project', // Close / Escape / back
  projectText: 'project-text', // teks panel mulai muncul
  uiShort: 'ui-short', // hover chip link
  uiLong: 'ui-long', // hover tombol Close
})

export const audio = {
  play(name) {
    bus.emit('audio_play', { name })
  },
}
