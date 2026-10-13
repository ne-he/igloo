import {
  BatchedMesh, BufferGeometry, BufferAttribute, ShaderMaterial, DataTexture, RGBAFormat, FloatType,
  NearestFilter, Matrix4, Quaternion, Euler, Vector3, Group,
} from 'three'
import '../../glsl/chunks.js'
import { loadGeometry, loadTexture } from '../../engine/Assets.js'
import { fit, smoothstep, lerp, lerpFPS, clamp } from '../../engine/math.js'
import { createOutline, createCage } from './IglooLines.js'
import { Plexus, createDigitsTexture } from './Plexus.js'
import { IntroDigits } from './IntroDigits.js'

// Igloo bata (M3). Aset: tools/blender/build_igloo.py (70 bata, atribut _batchid/_centr/_rand/_emission,
// dua bake di UV yang sama: rakit dan meledak). Runtime meniru cara igloo.inc (blueprint 5.1, skill ref 01 2.2,
// ref 02 4.1): satu BatchedMesh, satu geometri per bata, CPU menggeser tiap bata keluar sepanjang centroid,
// displacement + pantulan tanah per bata ditulis ke DataTexture yang dibaca shader.

export const BLUE = new Vector3(0.5, 0.7, 1.0)
const sineIn = (t) => 1 - Math.cos((t * Math.PI) / 2)

/**
 * Pecah geometri igloo per _batchid. Tiap bata di-recenter ke centroid-nya (matrix bata = posisi centroid).
 * Atribut _batchid/_centr/_rand dibuang dari geometri bata (disimpan di objek JS), _emission + uv dipertahankan.
 */
export function splitBricks(geo) {
  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  const ids = geo.attributes._batchid
  const centr = geo.attributes._centr
  const rand = geo.attributes._rand
  const emis = geo.attributes._emission
  const index = geo.index ? geo.index.array : Array.from({ length: pos.count }, (_, i) => i)
  const vCount = pos.count

  const brickOf = new Int32Array(vCount)
  const local = new Int32Array(vCount)
  const bricks = []
  for (let v = 0; v < vCount; v++) {
    const id = Math.round(ids.getX(v))
    brickOf[v] = id
    if (!bricks[id]) {
      bricks[id] = {
        index: id,
        centroid: new Vector3(centr.getX(v), centr.getY(v), centr.getZ(v)),
        rand: new Vector3(rand.getX(v), rand.getY(v), rand.getZ(v)),
        verts: [],
        tris: [],
      }
    }
    local[v] = bricks[id].verts.length
    bricks[id].verts.push(v)
  }
  for (let i = 0; i < index.length; i += 3) {
    const b = bricks[brickOf[index[i]]]
    b.tris.push(local[index[i]], local[index[i + 1]], local[index[i + 2]])
  }
  for (const b of bricks) {
    const n = b.verts.length
    const p = new Float32Array(n * 3)
    const t = new Float32Array(n * 2)
    const e = new Float32Array(n)
    b.verts.forEach((v, k) => {
      p[k * 3] = pos.getX(v) - b.centroid.x
      p[k * 3 + 1] = pos.getY(v) - b.centroid.y
      p[k * 3 + 2] = pos.getZ(v) - b.centroid.z
      t[k * 2] = uv.getX(v)
      t[k * 2 + 1] = uv.getY(v)
      e[k] = emis.getX(v)
    })
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(p, 3))
    g.setAttribute('uv', new BufferAttribute(t, 2))
    g.setAttribute('_emission', new BufferAttribute(e, 1))
    g.setIndex(new BufferAttribute(n > 65535 ? new Uint32Array(b.tris) : new Uint16Array(b.tris), 1))
    g.computeBoundingBox()
    g.computeBoundingSphere()
    b.geometry = g
    b.radius = g.boundingSphere.radius
    delete b.verts
    delete b.tris
  }
  return bricks
}

const VERT = /* glsl */ `
  #include <igloo_globals>
  #include <batching_pars_vertex>
  uniform sampler2D tOptions;
  attribute float _emission;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vEmission;
  varying vec2 vOpt;
  void main() {
    #include <batching_vertex>
    vec4 world = modelMatrix * batchingMatrix * vec4(position, 1.0);
    int id = int(batchId + 0.5);
    int size = textureSize(tOptions, 0).x;
    vOpt = texelFetch(tOptions, ivec2(id % size, id / size), 0).xy;
    // UV glTF (v dari atas) dibaca tekstur flipY default three
    vUv = vec2(uv.x, 1.0 - uv.y);
    vWorld = world.xyz;
    vEmission = _emission;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

const FRAG = /* glsl */ `
  #include <igloo_globals>
  uniform sampler2D tMap;
  uniform sampler2D tMapExploded;
  uniform sampler2D tTriangles;
  uniform float uIntroMaterialize;
  uniform float uExposure;
  uniform vec3 uBlue;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying float vEmission;
  varying vec2 vOpt;
  void main() {
    float disp = vOpt.x;
    // dua lightmap: rakit (muka kontak gelap) dan meledak (tiap sisi kena cahaya), dicampur oleh displacement
    vec3 c = mix(texture2D(tMap, vUv).rgb, texture2D(tMapExploded, vUv).rgb + 0.05, clamp(5.0 * disp, 0.0, 1.0));
    // bake mengikuti eksposur lembah (rata-rata muka luar ~0.49 sRGB), LUT scene menghancurkan bayangan,
    // jadi bata dinaikkan di sini (linear) supaya sisi yang menghadap kamera tetap abu terang seperti ref 03
    c *= uExposure;

    // intro: dibangun dari atas ke bawah, pita scan biru berpola segitiga, di bawah pita belum ada (discard)
    if (uIntroMaterialize < 1.0) {
      float front = mix(3.95 + 1.5, -0.4 - 1.5, uIntroMaterialize);
      float e = 1.0 - smoothstep(front - 0.75, front + 0.75, vWorld.y);
      if (e > 0.995) discard;
      float tri = texture2D(tTriangles, vUv * 5.0).r;
      c += (e + clamp(e * tri * 13.0, 0.0, 1.0)) * uBlue;
    }

    // emisi biru dari dalam: muncul saat bata bergeser, plus sapuan idle (fase sama dengan glow tanah)
    float e2 = vEmission * vEmission;
    float e8 = e2 * e2;
    e8 *= e8;
    float far = smoothstep(0.0, 2.0, 0.5 * vWorld.x - 0.5 * vWorld.z);
    float sweep = sin(vWorld.x - uTime + 3.2) * 0.5 + 0.5;
    c += (e2 * clamp(disp, 0.0, 1.0) + e8 * 0.5 * sweep) * uBlue * (1.0 + far);
    // SSS palsu: sisi matahari (+x) dan bagian atas sedikit lebih terang
    c += (0.1 * vWorld.x + 0.4) * 0.3 * min(vWorld.y + 0.5, 1.0) * 0.5;
    c = clamp(c, 0.0, 1.0);
    // pantulan glow tanah (mouse) ke kaki bata
    c += (1.0 - smoothstep(-1.5, 1.0, vWorld.y)) * vOpt.y * vec3(0.8, 0.9, 1.0) * 0.25;
    gl_FragColor = vec4(c, 1.0);
  }
`

const _m = new Matrix4()
const _q = new Quaternion()
const _e = new Euler()
const _p = new Vector3()
const _one = new Vector3(1, 1, 1)

/** BatchedMesh 70 bata + simulasi CPU per frame. */
export class Bricks {
  constructor(globals, bricks, { tMap, tMapExploded, tTriangles }) {
    this.bricks = bricks
    const size = Math.ceil(Math.sqrt(bricks.length))
    this.options = new DataTexture(new Float32Array(size * size * 4), size, size, RGBAFormat, FloatType)
    this.options.magFilter = this.options.minFilter = NearestFilter
    this.options.needsUpdate = true
    this.breath = { value: 1 } // modulator napas, 0 -> 1 saat intro (blueprint 6.5 detik 2.0)

    this.material = new ShaderMaterial({
      uniforms: {
        ...globals,
        tMap: { value: tMap },
        tMapExploded: { value: tMapExploded },
        tTriangles: { value: tTriangles },
        tOptions: { value: this.options },
        uIntroMaterialize: { value: 1 },
        uExposure: { value: 1.15 }, // grade igloo v2 (M2): bata ~0.85x terang tanah di dekatnya, seperti ref 03
        uBlue: { value: BLUE },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    })

    let vCount = 0
    let iCount = 0
    for (const b of bricks) {
      vCount += b.geometry.attributes.position.count
      iCount += b.geometry.index.count
    }
    const mesh = new BatchedMesh(bricks.length, vCount, iCount, this.material)
    // r165: renderer membandingkan object.colorTexture (bukan _colorsTexture), tanpa ini program dicek ulang tiap frame
    mesh.colorTexture = null
    mesh.frustumCulled = false
    mesh.name = 'igloo'
    for (const b of bricks) {
      b.id = mesh.addGeometry(b.geometry)
      b.d1 = b.d2 = b.b1 = b.b2 = 0
      b.disp = 0
      b.position = b.centroid.clone()
      b.anchor = b.centroid.clone()
      _m.makeTranslation(b.centroid)
      mesh.setMatrixAt(b.id, _m)
    }
    this.mesh = mesh
    this._lastTime = null
  }

  /** Lompat langsung ke target (dipanggil saat scene muncul lagi atau dari handle debug). */
  snap() {
    this._snap = true
  }

  update({ time, ratio }, progress, mouse) {
    if (this._lastTime === null || Math.abs(time - this._lastTime) > 0.5) this._snap = true
    this._lastTime = time
    const snap = this._snap
    this._snap = false
    const T = time
    const rest = fit(progress, 0, 0.495, 0, 1) // pengaruh mouse naik sampai titik istirahat
    const scroll = sineIn(fit(progress, 0, 0.4, 1, 0)) // ledakan saat scroll ke atas
    const data = this.options.image.data
    for (const b of this.bricks) {
      const c = b.centroid
      const r = b.rand
      const breathe = 0.4 * (Math.sin(-2 * T + c.x) * 0.5 + 0.5) * (Math.cos(-T) * 0.5 + 0.5) * lerp(0.5, 2, r.z) * 0.5 * this.breath.value
      const wobble = Math.sin(T + r.x * 6.2832)
      const near = fit(smoothstep(1, 3, c.distanceTo(mouse)), 0, 1, 0.5 + 0.3 * wobble, 0)
      const target = Math.max(breathe, near * rest) * smoothstep(0.45, 0.7, c.y)
      const bounce = near * rest
      if (snap) {
        b.d1 = b.d2 = target
        b.b1 = b.b2 = bounce
      } else {
        b.d1 = lerpFPS(b.d1, target, 0.06, ratio)
        b.d2 = lerpFPS(b.d2, b.d1, 0.06, ratio)
        b.b1 = lerpFPS(b.b1, bounce, 0.05, ratio)
        b.b2 = lerpFPS(b.b2, b.b1, 0.05, ratio)
      }
      const sd = scroll * (0.3 + 0.2 * clamp(c.y, 0, 4)) * lerp(0.5, 1.5, r.y)
      const d = b.d2 + sd
      b.disp = d
      b.position.copy(c).multiplyScalar(1 + d)
      // jangkar plexus: sedikit keluar dari permukaan bata
      b.anchor.copy(c).normalize().multiplyScalar(0.2).add(b.position)
      const k = d * 0.8
      _e.set((r.x - 0.5) * k, (r.y - 0.5) * k, (r.z - 0.5) * k)
      _q.setFromEuler(_e)
      _m.compose(b.position, _q, _one)
      this.mesh.setMatrixAt(b.id, _m)
      data[b.id * 4] = d
      data[b.id * 4 + 1] = b.b2
    }
    this.options.needsUpdate = true
  }
}

/**
 * Semua bagian igloo dalam satu grup: bata, outline, cage, plexus, angka intro.
 * IglooScene cukup: `this.igloo = await IglooHero.create(globals, mouse)` lalu `this.igloo.update(frame, progress, camera)`.
 */
export class IglooHero extends Group {
  static async create(globals, mouse) {
    const [geo, tMap, tMapExploded, tTriangles, digits] = await Promise.all([
      loadGeometry('igloo'),
      loadTexture('igloo_color.webp', 'srgb'),
      loadTexture('igloo_exploded_color.webp', 'srgb'),
      loadTexture('triangles_tiling.png', 'srgb-repeat'),
      createDigitsTexture(),
    ])
    return new IglooHero(globals, mouse, geo, { tMap, tMapExploded, tTriangles }, digits)
  }

  constructor(globals, mouse, geo, textures, digits) {
    super()
    this.name = 'iglooHero'
    this.mouse = mouse
    this.bricks = new Bricks(globals, splitBricks(geo), textures)
    this.outline = createOutline(globals, geo)
    this.cage = createCage(globals)
    this.plexus = new Plexus(globals, digits.plexus)
    this.introDigits = new IntroDigits(globals, this.cage.userData.nodes, digits.intro)
    this.add(this.bricks.mesh, this.outline, this.cage, this.plexus, this.introDigits)
  }

  update(frame, progress, camera) {
    this.bricks.update(frame, progress, this.mouse)
    // outline muncul lagi saat scroll di atas titik istirahat (progress < 0.35)
    this.outline.material.uniforms.uScrollAlpha.value = 2 * sineIn(fit(progress, 0, 0.35, 1, 0))
    this.plexus.update(frame, this.bricks.bricks, this.mouse, camera, this.bricks.mesh.visible)
  }

  /** Uniform + flag yang dipakai timeline intro (blueprint 6.5). Semua default = kondisi setelah intro. */
  introControls() {
    const o = this.outline.material.uniforms
    const c = this.cage.material.uniforms
    const d = this.introDigits.material.uniforms
    return {
      igloo: this.bricks.mesh, // .visible (intro: tersembunyi sampai detik 1.1)
      iglooMaterialize: this.bricks.material.uniforms.uIntroMaterialize, // 0 -> 1, 2.25 s igloo_ease_1
      breath: this.bricks.breath, // 0 -> 1, 2 s linear di detik 2.0
      outlineMaterialize: o.uIntroMaterialize, // 0 -> 1, 2.5 s power3.inOut di detik 0
      outlineAlpha: o.uAlpha, // set 1 di awal, 1 -> 0 3 s inOut4 di detik 2.0
      cage: this.cage, // .visible, tampil detik 0 sampai 5.1
      cageProgress: c.uProgress, // shockwave 0 -> 1, 4 s sine.inOut
      cageAlpha: c.uAlpha, // 0 -> 0.4 (0.1 s), lalu 0.4 -> 0 3 s di detik 2.1
      digits: this.introDigits, // .visible, tampil detik 0.5 sampai 3.75
      digitsProgress: d.uProgress, // 0 -> 1, 4 s sine.out di detik 0.5
      digitsAlpha: d.uAlpha, // 1 -> 0, 2 s di detik 1.75
    }
  }
}

/** Helper untuk orkestrator timeline intro: kontrol intro dari IglooScene (atau IglooHero langsung). */
export function getIglooIntroControls(sceneOrHero) {
  const hero = sceneOrHero.isIglooHero ? sceneOrHero : sceneOrHero.igloo
  return hero.introControls()
}

IglooHero.prototype.isIglooHero = true
