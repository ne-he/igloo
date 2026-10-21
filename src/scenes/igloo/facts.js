// Pembagian fakta ke bata igloo (logika murni tanpa three, dites di tests/facts.test.js).
// Titik = centroid bata ({x, y, z}). Tetangga = k centroid terdekat, dibuat simetris.

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2

/** Daftar tetangga tiap titik (indeks terurut). Simetris: kalau j tetangga i, i juga tetangga j. */
export function brickNeighbors(points, k = 6) {
  const n = points.length
  const sets = Array.from({ length: n }, () => new Set())
  for (let i = 0; i < n; i++) {
    const d = []
    for (let j = 0; j < n; j++) if (j !== i) d.push([dist2(points[i], points[j]), j])
    d.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    for (let m = 0; m < Math.min(k, d.length); m++) {
      sets[i].add(d[m][1])
      sets[d[m][1]].add(i)
    }
  }
  return sets.map((s) => [...s].sort((a, b) => a - b))
}

/**
 * Bagi `factCount` fakta ke titik: pewarnaan graf greedy, tetangga tidak boleh dapat fakta yang sama,
 * di antara fakta yang boleh dipilih yang paling jarang dipakai (sebaran rata). Deterministik.
 * Urutan Welsh-Powell (derajat terbesar dulu) supaya greedy jarang buntu. Kalau tetap buntu (tetangga
 * lebih banyak dari jumlah fakta), fakta yang paling jarang dipakai dipakai ulang.
 * @returns {number[]} indeks fakta per titik (-1 kalau daftar fakta kosong)
 */
export function assignFacts(points, factCount, { k = 6 } = {}) {
  if (!factCount) return points.map(() => -1)
  const nb = brickNeighbors(points, k)
  const out = new Array(points.length).fill(-1)
  const used = new Array(factCount).fill(0)
  const order = points.map((_, i) => i).sort((a, b) => nb[b].length - nb[a].length || a - b)
  for (const i of order) {
    const banned = new Set(nb[i].map((j) => out[j]))
    let best = -1
    let fallback = -1
    for (let s = 0; s < factCount; s++) {
      const f = (s + i) % factCount // rotasi awal per titik supaya seri tidak selalu jatuh ke fakta 0
      if (fallback < 0 || used[f] < used[fallback]) fallback = f
      if (banned.has(f)) continue
      if (best < 0 || used[f] < used[best]) best = f
    }
    out[i] = best >= 0 ? best : fallback
    used[out[i]]++
  }
  return out
}
