import {
  TextureLoader, FileLoader, SRGBColorSpace, NoColorSpace, RepeatWrapping, ClampToEdgeWrapping,
  NearestFilter, LinearFilter, LinearMipmapLinearFilter,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

// Loader aset terpusat dengan cache (blueprint 6.7). Geometri = glb + Draco, tekstur = PNG/WebP.
// Mode tekstur meniru string mode igloo: gabungan 'srgb' | 'data', 'repeat', 'nearest', 'nomips'.
const draco = new DRACOLoader().setDecoderPath('/draco/').setDecoderConfig({ type: 'wasm' })
const gltfLoader = new GLTFLoader().setDRACOLoader(draco)
const textureLoader = new TextureLoader()
const fileLoader = new FileLoader().setResponseType('arraybuffer')
const geoCache = new Map()
const texCache = new Map()

// Magic glb = "glTF" (0x46546C67 little endian). Vite dev mengembalikan index.html (status 200) untuk file
// yang tidak ada, jadi tanpa cek ini error-nya cuma "Unexpected token '<'" dari parser tanpa nama file.
const GLB_MAGIC = 0x46546c67

/** Pastikan buffer benar-benar glb, kalau tidak lempar error yang menyebut URL dan isi awalnya. */
export function assertGlb(buffer, url) {
  const bytes = new Uint8Array(buffer, 0, Math.min(16, buffer.byteLength))
  const magic = buffer.byteLength >= 4 ? new DataView(buffer).getUint32(0, true) : 0
  if (magic === GLB_MAGIC) return
  const head = String.fromCharCode(...bytes).replace(/[^\x20-\x7e]/g, '.')
  const html = /^\s*</.test(head)
  throw new Error(
    `loadGeometry: ${url} bukan glb (${buffer.byteLength} byte, awal "${head}"). `
      + (html ? 'Server mengembalikan HTML: file kemungkinan tidak ada di public/assets/geometries/.' : 'Magic "glTF" tidak ditemukan.'),
  )
}

/** Geometri mesh pertama di /assets/geometries/<name>.glb (atribut custom jadi huruf kecil, mis. _centr). */
export function loadGeometry(name) {
  if (!geoCache.has(name)) {
    const url = `/assets/geometries/${name}.glb`
    // FileLoader (bukan fetch) supaya tetap tercatat DefaultLoadingManager untuk progress loader
    geoCache.set(name, fileLoader.loadAsync(url).then((buffer) => {
      assertGlb(buffer, url)
      return gltfLoader.parseAsync(buffer, '/assets/geometries/')
    }).then((gltf) => {
      let geo = null
      gltf.scene.traverse((o) => {
        if (!geo && o.isMesh) geo = o.geometry
      })
      if (!geo) throw new Error(`glb tanpa mesh: ${name}`)
      return geo
    }))
  }
  return geoCache.get(name)
}

/** Tekstur /assets/textures/<file>. mode contoh: 'srgb', 'srgb-repeat', 'data-repeat-nearest-nomips'. */
export function loadTexture(file, mode = 'srgb') {
  const key = `${file}|${mode}`
  if (!texCache.has(key)) {
    const m = new Set(mode.split('-'))
    texCache.set(key, textureLoader.loadAsync(`/assets/textures/${file}`).then((tex) => {
      tex.colorSpace = m.has('srgb') ? SRGBColorSpace : NoColorSpace
      tex.wrapS = tex.wrapT = m.has('repeat') ? RepeatWrapping : ClampToEdgeWrapping
      const nearest = m.has('nearest')
      const mips = !m.has('nomips') && !m.has('data') && !nearest
      tex.generateMipmaps = mips
      tex.magFilter = nearest ? NearestFilter : LinearFilter
      tex.minFilter = nearest ? NearestFilter : mips ? LinearMipmapLinearFilter : LinearFilter
      tex.anisotropy = mips ? 4 : 1
      tex.needsUpdate = true
      return tex
    }))
  }
  return texCache.get(key)
}
