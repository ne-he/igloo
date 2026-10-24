// Pembagian fakta ke bata igloo (logika murni tanpa three, dites di tests/facts.test.js).
// Titik = centroid bata ({x, y, z}) di ruang dunia.

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2

/**
 * Tiap fakta tepat di SATU bata (tidak ada fakta dobel, permintaan 24 Okt 2026). Kandidat = bata yang menghadap
 * titik pandang `view` (arah centroid dari pusat kubah searah arah ke kamera, dot >= minFacing), lalu dipilih
 * menyebar dengan farthest point sampling mulai dari bata yang paling menghadap kamera. Kalau kandidat kurang,
 * ambang dot diturunkan bertahap. Bata yang tidak terpilih = -1 (melayang saat hover, tanpa label). Deterministik.
 * @param {{x:number,y:number,z:number}[]} points centroid bata (ruang dunia, sama dengan view)
 * @param {{x:number,y:number,z:number}} view posisi kamera di titik istirahat
 * @returns {number[]} indeks fakta per titik, -1 kalau bata tanpa fakta
 */
export function assignUniqueFacts(points, factCount, view, { minFacing = 0.5 } = {}) {
  const out = points.map(() => -1)
  if (!factCount || !points.length) return out
  const n = points.length
  const center = points.reduce((c, p) => ({ x: c.x + p.x / n, y: c.y + p.y / n, z: c.z + p.z / n }), { x: 0, y: 0, z: 0 })
  const unit = (v) => {
    const l = Math.hypot(v.x, v.y, v.z) || 1
    return { x: v.x / l, y: v.y / l, z: v.z / l }
  }
  const toView = unit({ x: view.x - center.x, y: view.y - center.y, z: view.z - center.z })
  const facing = points.map((p) => {
    const d = unit({ x: p.x - center.x, y: p.y - center.y, z: p.z - center.z })
    return d.x * toView.x + d.y * toView.y + d.z * toView.z
  })
  const want = Math.min(factCount, n)
  let min = minFacing
  let cand = []
  while (true) {
    cand = points.map((_, i) => i).filter((i) => facing[i] >= min)
    if (cand.length >= want || min <= -1) break
    min -= 0.1
  }
  const chosen = [cand.reduce((a, b) => (facing[b] > facing[a] ? b : a))]
  const gap = cand.map((i) => dist2(points[i], points[chosen[0]]))
  while (chosen.length < want) {
    let best = -1
    for (let k = 0; k < cand.length; k++) {
      if (chosen.includes(cand[k])) continue
      if (best < 0 || gap[k] > gap[best] + 1e-9) best = k
    }
    const pick = cand[best]
    chosen.push(pick)
    for (let k = 0; k < cand.length; k++) gap[k] = Math.min(gap[k], dist2(points[cand[k]], points[pick]))
  }
  chosen.forEach((i, f) => (out[i] = f))
  return out
}
