import {
  TextureLoader, SRGBColorSpace, NoColorSpace, RepeatWrapping, ClampToEdgeWrapping,
  NearestFilter, LinearFilter, LinearMipmapLinearFilter,
} from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'

// Loader aset terpusat dengan cache (blueprint 6.7). Geometri = glb + Draco, tekstur = PNG/WebP.
// Mode tekstur meniru string mode igloo: gabungan 'srgb' | 'data', 'repeat', 'nearest', 'nomips'.
const draco = new DRACOLoader().setDecoderPath('/draco/').setDecoderConfig({ type: 'wasm' })
const gltfLoader = new GLTFLoader().setDRACOLoader(draco)
const textureLoader = new TextureLoader()
const geoCache = new Map()
const texCache = new Map()

/** Geometri mesh pertama di /assets/geometries/<name>.glb (atribut custom jadi huruf kecil, mis. _centr). */
export function loadGeometry(name) {
  if (!geoCache.has(name)) {
    geoCache.set(name, gltfLoader.loadAsync(`/assets/geometries/${name}.glb`).then((gltf) => {
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
