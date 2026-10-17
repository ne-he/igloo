import { Data3DTexture, RGBAFormat, UnsignedByteType, LinearFilter, ClampToEdgeWrapping, NoColorSpace } from 'three'

// Loader volume SDF .vol (format ditulis tools/volumes/build_volumes.py):
//   header 16 byte 'SDF1' + res + panjang gzip + cadangan, lalu gzip dari 4 bidang planar R,G,B,A
//   yang di-delta per baris x. Dekompresi pakai DecompressionStream bawaan browser (tanpa dependensi npm).
// Hasil: Data3DTexture RGBA8 linear (bukan sRGB), rgb = gradient * 0.5 + 0.5, a = jarak / 4 + 0.5.

const cache = new Map()

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** Bongkar delta planar ke RGBA interleaved [z][y][x][4]. Murni (tanpa GPU), bisa dites di node. */
export function unpackVolume(planar, res) {
  const n = res * res * res
  if (planar.length !== n * 4) throw new Error(`volume rusak: ${planar.length} byte, harusnya ${n * 4}`)
  const out = new Uint8Array(n * 4)
  for (let c = 0; c < 4; c++) {
    const base = c * n
    for (let row = 0; row < res * res; row++) {
      let v = 0
      const o = base + row * res
      for (let x = 0; x < res; x++) {
        v = (v + planar[o + x]) & 255
        out[(row * res + x) * 4 + c] = v
      }
    }
  }
  return out
}

/** Muat /assets/volumes/<name>.vol jadi Data3DTexture (di-cache per nama). */
export function loadVolume(name) {
  if (!cache.has(name)) {
    cache.set(name, (async () => {
      const buf = await fetch(`/assets/volumes/${name}.vol`).then((r) => {
        if (!r.ok) throw new Error(`volume ${name}: HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      const head = new DataView(buf, 0, 16)
      const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4))
      if (magic !== 'SDF1') throw new Error(`volume ${name}: header salah (${magic})`)
      const res = head.getUint32(4, true)
      const len = head.getUint32(8, true)
      const data = unpackVolume(await gunzip(new Uint8Array(buf, 16, len)), res)
      const tex = new Data3DTexture(data, res, res, res)
      tex.format = RGBAFormat
      tex.type = UnsignedByteType
      tex.colorSpace = NoColorSpace
      tex.minFilter = tex.magFilter = LinearFilter
      tex.wrapS = tex.wrapT = tex.wrapR = ClampToEdgeWrapping
      tex.generateMipmaps = false
      tex.unpackAlignment = 1
      tex.needsUpdate = true
      tex.name = name
      return tex
    })())
  }
  return cache.get(name)
}
