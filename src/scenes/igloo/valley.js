import {
  Mesh, Group, ShaderMaterial, PlaneGeometry, InstancedBufferGeometry, InstancedBufferAttribute,
  Vector2, Vector3,
} from 'three'
import '../../glsl/chunks.js'
import { loadGeometry, loadTexture } from '../../engine/Assets.js'
import { skyUniforms } from './look.js'

// Komponen lembah salju (M2), semua unlit dengan bake Cycles sendiri (tools/blender/build_valley.py).
// Layout (posisi, skala, rotasi, renderOrder) = data hasil bedah (blueprint 5.1, skill references 01).
const DEG = Math.PI / 180
const GROUND_SIZE = new Vector2(1 / 24, 1 / 24)
const MOUNTAIN_SIZE = new Vector2(1 / 20, 1 / 23)
// Penguat linear bake salju (tanah, terrain, patch), satu objek dipakai bersama supaya bisa di-tune live.
export const GROUND_GAIN = { value: 1.2 }

export const TERRAIN_LAYOUT = [
  { pos: [-3.76, -0.58, 12.5], scale: [0.6, 0.6, 0.6], rot: [-5.1, 0, 0], order: 1 },
  { pos: [-17.63, -0.01, 2], scale: [1, 1, 1], rot: [2.7, 0.8, 0], order: 3 },
  { pos: [3.12, -0.75, -1.02], scale: [1.5, 0.66, 1.5], rot: [0, 0, 0], order: 1 },
  { pos: [6, 0.16, 15.78], scale: [1, 1, 1], rot: [1.1, 0, 7], order: 2 },
  { pos: [16.06, 0.34, 4], scale: [1, 1, 1], rot: [0, 0, 0], order: 2 },
]
export const PATCH_LAYOUT = [
  { pos: [-9.34, -1.77, 6.96], scale: 7, rot: [0, 0, 0] },
  { pos: [-8.82, -1.35, 11.69], scale: 8, rot: [-5.5, -25.6, 0] },
]
export const MOUNTAIN_LAYOUT = [
  { pos: [59.53, -1, -11.84], scale: [4, 3.14, 4], rot: [4.1, -42.8, 5] },
  { pos: [1, -2.21, -23], scale: [2, 2, 2], rot: [3.5, 30, 0] },
  { pos: [75, 0, -90], scale: [8, 8, 8], rot: [3.2, -16.7, -2.6] },
  { pos: [250, 11.33, -133], scale: [10, 10, 10], rot: [13.2, 20, 5] },
  { pos: [-25.22, -1.59, -53.05], scale: [2.5, 2.5, 2.5], rot: [3.5, 25, 0] },
]

function place(mesh, { pos, scale, rot }) {
  mesh.position.set(...pos)
  if (Array.isArray(scale)) mesh.scale.set(...scale)
  else mesh.scale.setScalar(scale)
  mesh.rotation.set(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG)
  mesh.updateMatrixWorld(true)
  mesh.matrixAutoUpdate = false
  return mesh
}

const VARYINGS = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vPos;
  varying vec3 vWorld;
`

/**
 * Uniform intro lembah (blueprint 6.5, skill ref 02 4.3), dipakai bersama tanah, terrain, patch, gunung.
 * Default 1 = dunia sudah tampil penuh, jadi tidak ada yang berubah sampai timeline intro menggerakkannya.
 * uProgress  : lapis segitiga biru jarang (timeline: 0 -> 1, 7.5 s inOut1 di detik 0.7)
 * uProgress2 : isi biru + pita segitiga + alpha dunia (timeline: 0 -> 1, 7.5 s inOut3 di detik 0.7)
 */
export const VALLEY_INTRO = { uProgress: { value: 1 }, uProgress2: { value: 1 } }

// Shockwave intro: garis depan bergerigi (jitter mosaic nearest) dari pusat ke radius 32.
// introReveal = alpha dunia (0 di depan garis, jadi dunia muncul dari tengah), introGlow = biru di belakang garis.
const VALLEY_INTRO_GLSL = /* glsl */ `
  uniform float uProgress;
  uniform float uProgress2;
  uniform sampler2D tTriangles;
  uniform sampler2D tMosaic;
  const vec3 INTRO_BLUE = vec3(0.3, 0.45, 1.0);
  const float INTRO_REACH = 32.0 + 3.5; // radius 32 + jitter maksimum
  const float INTRO_TAIL = 6.0;          // lebar pita di belakang garis depan
  float introDist(vec3 world) {
    return length(world.xz) + texture2D(tMosaic, world.xz * 0.07).r * 3.5;
  }
  // jarak di belakang garis depan (positif = sudah dilewati gelombang)
  float introBehind(float d, float p) {
    return mix(-INTRO_TAIL, INTRO_REACH + INTRO_TAIL, p) - d;
  }
  float introReveal(float d) {
    if (uProgress2 >= 1.0) return 1.0;
    return smoothstep(0.0, 1.5, introBehind(d, uProgress2));
  }
  vec3 introGlow(vec3 world, float d) {
    if (uProgress2 >= 1.0 && uProgress >= 1.0) return vec3(0.0);
    vec3 add = vec3(0.0);
    // lapis 2: isi biru + segitiga (xz * 0.25) x 3 di pita belakang garis depan
    float b2 = introBehind(d, uProgress2);
    float band = smoothstep(0.0, 0.6, b2) * (1.0 - smoothstep(0.6, INTRO_TAIL, b2));
    float tri = texture2D(tTriangles, world.xz * 0.25).r;
    add += INTRO_BLUE * band * (0.45 + tri * 3.0);
    // lapis 1: segitiga biru jarang (dimasker mosaic) yang menyapu sedikit di belakang garisnya sendiri
    float b1 = introBehind(d, uProgress);
    float sweep = smoothstep(0.0, 0.5, b1) * (1.0 - smoothstep(0.5, 4.0, b1));
    float sparse = step(0.62, texture2D(tMosaic, world.xz * 0.21 + 0.5).r);
    add += INTRO_BLUE * texture2D(tTriangles, world.xz * 0.5 + 0.37).r * sparse * sweep * 2.0;
    return add;
  }
`

function introUniforms(tTriangles, tMosaic) {
  return { ...VALLEY_INTRO, tTriangles: { value: tTriangles }, tMosaic: { value: tMosaic } }
}

function loadIntroTextures() {
  // mode sama dengan Bricks.js supaya cache tekstur dipakai bersama
  return Promise.all([loadTexture('triangles_tiling.png', 'srgb-repeat'), loadTexture('mosaic.png', 'data-repeat-nearest')])
}

// Angin terrain: dua lookup memanjang yang bergerak, hanya di bagian rendah, ditambahkan ke salju terang.
const TERRAIN_WIND = /* glsl */ `
  float terrainWind(vec3 pos, vec3 world, float c) {
    float t = uTime;
    float w = texture2D(tWind, world.xz * 0.1 + world.xy * 0.1 - vec2(t * 0.25, t * 0.3)).r;
    w *= texture2D(tWind, world.xz * 0.15 + world.xy * 0.15 - vec2(t * 0.18, t * 0.225)).r;
    w *= 1.0 - clamp(pos.y * 0.5 + 0.75, 0.0, 1.0);
    return w * c * 2.0;
  }
`

/**
 * Tanah utama di bawah igloo: bake DENGAN igloo (bayangan kontak, tools/blender/build_igloo.py --only ground)
 * + glow berdenyut dari igloo + glow biru ikut mouse + angin + fade tepi. Terrain dan patch memakai
 * ground_color.webp (tanpa igloo), seperti ground_sansigloo di igloo.inc.
 */
export async function createGround(globals, mouse) {
  const [geo, tMap, tMapSans, tGlow, tWind, [tTri, tMosaic]] = await Promise.all([
    loadGeometry('ground'), loadTexture('ground_color_igloo.webp', 'srgb'), loadTexture('ground_color.webp', 'srgb'),
    loadTexture('ground_glow.webp', 'srgb'),
    loadTexture('wind_noise.png', 'srgb-repeat'), loadIntroTextures(),
  ])
  const mat = new ShaderMaterial({
    transparent: true,
    uniforms: {
      ...globals, ...introUniforms(tTri, tMosaic), tMap: { value: tMap }, tMapSans: { value: tMapSans },
      tGlow: { value: tGlow }, tWind: { value: tWind }, uGain: GROUND_GAIN,
      uMousePos: { value: mouse }, uUvScale: { value: GROUND_SIZE }, uAlpha: { value: 1 },
    },
    vertexShader: /* glsl */ `
      #include <igloo_planaruv>
      uniform vec3 uMousePos;
      ${VARYINGS}
      varying vec3 vMouseGlow;
      void main() {
        vPos = position;
        vUv = planarUv(position);
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        // cahaya biru di salju dekat titik mouse, makin kuat kalau titik mouse makin tinggi
        float near = 1.0 - clamp(distance(uMousePos, vWorld * vec3(1.0, 0.0, 1.0)), 0.0, 5.0) / 5.0;
        // rumus asli smoothstep(-0.5, 2.0, y); dilonggarkan karena bake kita lebih gelap dan mesh lebih jarang
        vMouseGlow = near * vec3(0.5, 0.7, 1.0) * smoothstep(-1.5, 1.5, uMousePos.y);
        vMouseGlow *= (1.0 - clamp(length(vWorld), 0.0, 9.0) / 9.0) * 2.0;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      #include <igloo_globals>
      uniform sampler2D tMap;
      uniform sampler2D tMapSans;
      uniform sampler2D tGlow;
      uniform float uGain;
      uniform sampler2D tWind;
      uniform float uAlpha;
      ${VARYINGS}
      ${VALLEY_INTRO_GLSL}
      varying vec3 vMouseGlow;
      void main() {
        // bake dengan igloo hanya dipakai dekat kaki igloo (bayangan kontak + AO). Bayangan panjang matahari
        // rendah (27 derajat) di bake itu terlalu gelap untuk ref 03, jadi di luar r 3.2..4.6 kembali ke bake tanpa igloo.
        vec3 c = mix(texture2D(tMap, vUv).rgb, texture2D(tMapSans, vUv).rgb, smoothstep(3.2, 4.6, length(vPos.xz))) * uGain;
        // glow igloo berdenyut (fase sama dengan sapuan emisi bata di M3), hanya menerangi salju terang
        c += texture2D(tGlow, vUv).rgb * (sin(vPos.x - uTime + 3.2) * 0.5 + 0.5) * c.r;
        c += vMouseGlow * c.r * 2.5; // asli x1, di grade kita x1 nyaris tak terlihat
        // angin: dua lookup memanjang dikalikan, hanya di cekungan
        float w = texture2D(tWind, vWorld.xz * 0.15 + vUv * 0.1 - uTime * 0.15).r;
        w *= texture2D(tWind, vWorld.xz * 0.17 + vUv * 0.1 - uTime * 0.15).r;
        w *= 1.0 - clamp(vPos.y * 0.3 + 1.1, 0.0, 1.0);
        c = mix(c, vec3(1.0), clamp(w * 4.0, 0.0, 1.0));
        float d = introDist(vWorld);
        c += introGlow(vWorld, d);
        float alpha = 1.0 - smoothstep(0.8, 1.0, length(vPos.xz) * 0.1085);
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), alpha * uAlpha * introReveal(d));
      }
    `,
  })
  const mesh = new Mesh(geo, mat)
  mesh.renderOrder = 2
  mesh.name = 'ground'
  return place(mesh, { pos: [0, 0, 0], scale: 1, rot: [0, 0, 0] })
}

/** Terrain sekeliling: mesh tanah yang sama dipakai ulang 5 kali. */
export async function createTerrain(globals) {
  const [geo, tMap, tWind, [tTri, tMosaic]] = await Promise.all([
    loadGeometry('ground'), loadTexture('ground_color.webp', 'srgb'), loadTexture('wind_noise.png', 'srgb-repeat'),
    loadIntroTextures(),
  ])
  const mat = new ShaderMaterial({
    transparent: true,
    uniforms: {
      ...globals, ...introUniforms(tTri, tMosaic), tMap: { value: tMap }, tWind: { value: tWind },
      uUvScale: { value: GROUND_SIZE }, uAlpha: { value: 1 }, uGain: GROUND_GAIN,
    },
    vertexShader: /* glsl */ `
      #include <igloo_planaruv>
      ${VARYINGS}
      void main() {
        vPos = position;
        vUv = planarUv(position);
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      #include <igloo_globals>
      uniform sampler2D tMap;
      uniform sampler2D tWind;
      uniform float uAlpha;
      uniform float uGain;
      ${VARYINGS}
      ${TERRAIN_WIND}
      ${VALLEY_INTRO_GLSL}
      void main() {
        vec3 c = texture2D(tMap, vUv).rgb * uGain;
        c += terrainWind(vPos, vWorld, c.r);
        float d = introDist(vWorld);
        c += introGlow(vWorld, d);
        float alpha = 1.0 - smoothstep(0.85, 1.0, length(vPos.xz) * 0.1085);
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), alpha * uAlpha * introReveal(d));
      }
    `,
  })
  const group = new Group()
  TERRAIN_LAYOUT.forEach((t, i) => {
    const m = place(new Mesh(geo, mat), t)
    m.renderOrder = t.order
    m.name = `terrain${i + 1}`
    group.add(m)
  })
  return group
}

/** Patch: quad datar yang UV-nya menunjuk salju bersih di bake tanah, menambal celah depan. */
export async function createPatches(globals) {
  const [tMap, tWind, [tTri, tMosaic]] = await Promise.all([
    loadTexture('ground_color.webp', 'srgb'), loadTexture('wind_noise.png', 'srgb-repeat'), loadIntroTextures(),
  ])
  const geo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
  const mat = new ShaderMaterial({
    transparent: true,
    uniforms: {
      ...globals, ...introUniforms(tTri, tMosaic), tMap: { value: tMap }, tWind: { value: tWind }, uAlpha: { value: 1 },
      uGain: GROUND_GAIN,
    },
    vertexShader: /* glsl */ `
      ${VARYINGS}
      void main() {
        vPos = position;
        // sub-area bake yang bergelombang halus tanpa fitur besar (di belakang kiri igloo, x -2.3 z -6.3),
        // supaya latar paling depan (patch terlihat di bawah layar) tetap punya relief, bukan plateau rata
        vUv = vec2(0.403 + position.x * 0.2, 0.762 - position.z * 0.2);
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      #include <igloo_globals>
      uniform sampler2D tMap;
      uniform sampler2D tWind;
      uniform float uAlpha;
      uniform float uGain;
      ${VARYINGS}
      ${TERRAIN_WIND}
      ${VALLEY_INTRO_GLSL}
      void main() {
        vec3 c = texture2D(tMap, vUv).rgb * uGain;
        c += terrainWind(vPos, vWorld, c.r);
        float d = introDist(vWorld);
        c += introGlow(vWorld, d);
        float alpha = 1.0 - smoothstep(0.3, 0.48, length(vPos.xz));
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), alpha * uAlpha * introReveal(d));
      }
    `,
  })
  const group = new Group()
  PATCH_LAYOUT.forEach((p, i) => {
    const m = place(new Mesh(geo, mat), p)
    m.renderOrder = 0
    m.name = `terrainpatch${i + 1}`
    group.add(m)
  })
  return group
}

/** Gunung jauh: satu mesh dipakai 5 kali, bake + kabut warna langit. */
export async function createMountains(globals) {
  const [geo, tMap, [tTri, tMosaic]] = await Promise.all([
    loadGeometry('mountain'), loadTexture('mountain_color.webp', 'srgb'), loadIntroTextures(),
  ])
  const mat = new ShaderMaterial({
    // transparent supaya uAlpha (intro: 0 -> 1, 3 s di detik 0.7) benar-benar memudarkan gunung
    transparent: true,
    uniforms: {
      ...globals, ...skyUniforms(), ...introUniforms(tTri, tMosaic), tMap: { value: tMap },
      uUvScale: { value: MOUNTAIN_SIZE }, uAlpha: { value: 1 },
    },
    vertexShader: /* glsl */ `
      #include <igloo_planaruv>
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vViewZ;
      void main() {
        vUv = planarUv(position);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vec4 mv = viewMatrix * w;
        vViewZ = mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      #include <igloo_globals>
      #include <igloo_skygradient>
      #include <igloo_mountainfog>
      uniform sampler2D tMap;
      uniform float uAlpha;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying float vViewZ;
      ${VALLEY_INTRO_GLSL}
      void main() {
        vec3 c = texture2D(tMap, vUv).rgb;
        // gelombang intro hanya mewarnai (gunung jauh di luar radius 32, alpha-nya lewat uAlpha)
        c += introGlow(vWorld, introDist(vWorld));
        c = applyMountainFog(c, vWorld.y, vViewZ, gl_FragCoord.xy / uResolution);
        gl_FragColor = vec4(c, uAlpha);
      }
    `,
  })
  const group = new Group()
  group.name = 'mountains'
  MOUNTAIN_LAYOUT.forEach((m, i) => {
    const mesh = place(new Mesh(geo, mat), m)
    mesh.renderOrder = 1
    mesh.name = `mountain${i + 1}`
    group.add(mesh)
  })
  return group
}

/**
 * Salju: 1200 quad kecil yang jatuh miring dan berputar 3D. Versi vertex shader saja (tanpa GPGPU):
 * kecepatan terminal hasil sim igloo (gravitasi 0.004, dorongan 0.0025, friksi 0.9) dihitung analitik,
 * posisi dibungkus (treadmill) dalam kotak setengah-ukuran 25 x 10 x 25.
 */
export function createSnow(globals, count = 1200) {
  const base = new PlaneGeometry(0.075, 0.15)
  const geo = new InstancedBufferGeometry()
  geo.index = base.index
  geo.setAttribute('position', base.getAttribute('position'))
  geo.setAttribute('uv', base.getAttribute('uv'))
  const start = new Float32Array(count * 3)
  const seed = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    start.set([(Math.random() * 2 - 1) * 25, (Math.random() * 2 - 1) * 10, (Math.random() * 2 - 1) * 25], i * 3)
    seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4)
  }
  geo.setAttribute('aStart', new InstancedBufferAttribute(start, 3))
  geo.setAttribute('aSeed', new InstancedBufferAttribute(seed, 4))
  geo.instanceCount = count
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { ...globals, uAlpha: { value: 1 } },
    vertexShader: /* glsl */ `
      #include <igloo_globals>
      attribute vec3 aStart;
      attribute vec4 aSeed;
      varying vec2 vUv;
      varying float vAlpha;
      varying float vShade;
      mat3 rotAxis(vec3 a, float ang) {
        float s = sin(ang), c = cos(ang), oc = 1.0 - c;
        return mat3(oc * a.x * a.x + c, oc * a.x * a.y + a.z * s, oc * a.z * a.x - a.y * s,
                    oc * a.x * a.y - a.z * s, oc * a.y * a.y + c, oc * a.y * a.z + a.x * s,
                    oc * a.z * a.x + a.y * s, oc * a.y * a.z - a.x * s, oc * a.z * a.z + c);
      }
      void main() {
        vUv = uv;
        float w = aSeed.x;
        // kecepatan terminal per detik (lihat docstring), plus goyang samping per butir
        vec3 vel = vec3(1.5 + sign(w - 0.5) * 0.9, -1.56 * mix(0.77, 1.23, aSeed.y), 1.5);
        vec3 p = aStart + vel * uTime;
        p.x += sin(uTime * 0.2 + w * 15.65) * 0.6;
        vec3 halfBox = vec3(25.0, 10.0, 25.0);
        p = mod(p + halfBox, halfBox * 2.0) - halfBox;
        // butir berputar di sumbu acak
        vec3 axis = normalize(aSeed.yzw * 2.0 - 1.0 + 0.001);
        vec3 local = rotAxis(axis, uTime * mix(1.0, 3.0, aSeed.z) + w * 6.28) * position;
        vec4 world = modelMatrix * vec4(p + local, 1.0);
        vec4 mv = viewMatrix * world;
        // pudar dekat batas kotak, dekat kamera, dekat tanah, dan dekat igloo
        vec3 edge = smoothstep(halfBox, halfBox * 0.8, abs(p));
        vAlpha = edge.x * edge.y * edge.z;
        // dekat kamera dipudarkan (di 4 unit satu butir sudah ~40 px), supaya salju tetap kecil dan jarang
        vAlpha *= smoothstep(4.0, 9.0, -mv.z);
        vAlpha *= smoothstep(-1.0, 0.5, world.y);
        vAlpha *= smoothstep(4.0, 6.0, length(world.xz));
        vShade = mix(0.75, 1.0, aSeed.w);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uAlpha;
      varying vec2 vUv;
      varying float vAlpha;
      varying float vShade;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.4, 1.0, d)) * vAlpha * uAlpha;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vec3(vShade), a);
      }
    `,
  })
  const mesh = new Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 5
  mesh.name = 'snow'
  return mesh
}

/** Asap angin: 2 bidang 20 x 5, alpha = tiga lookup wind noise dikalikan. */
export async function createSmoke(globals) {
  const tWind = await loadTexture('wind_noise.png', 'srgb-repeat')
  const geo = new PlaneGeometry(20, 5)
  const make = (timeOffset) => new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { ...globals, tWind: { value: tWind }, uOffset: { value: timeOffset }, uAlpha: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      #include <igloo_globals>
      uniform sampler2D tWind;
      uniform float uOffset;
      uniform float uAlpha;
      varying vec2 vUv;
      void main() {
        float t = uTime * 0.15 + uOffset;
        vec2 uv = vUv * vec2(4.0, 1.0);
        float a = texture2D(tWind, uv * 0.6 - vec2(t, 0.0)).r;
        a *= texture2D(tWind, uv * 0.9 + vec2(-t * 1.3, 0.21)).r;
        a *= texture2D(tWind, uv * 0.35 - vec2(t * 0.7, 0.53)).r;
        a *= 8.0;
        // pudar di tepi, lebih tebal di bawah
        a *= smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x) * smoothstep(1.0, 0.25, vUv.y) * smoothstep(0.0, 0.1, vUv.y);
        gl_FragColor = vec4(vec3(1.0), clamp(a, 0.0, 1.0) * 0.4 * uAlpha);
      }
    `,
  })
  const group = new Group()
  const a = new Mesh(geo, make(0))
  a.position.set(-5, 1.25, -10)
  const b = new Mesh(geo, make(0.914))
  b.position.set(13.45, 3, -4)
  b.rotation.y = -10 * DEG
  for (const m of [a, b]) {
    m.renderOrder = 2
    group.add(m)
  }
  return group
}

/** Titik mouse di dunia: perpotongan sinar pointer dengan bidang menghadap kamera sejauh 19.25 unit. */
export class MousePoint {
  constructor() {
    this.value = new Vector3()
    this._target = new Vector3()
    this._dir = new Vector3()
    this._ndc = new Vector3()
  }

  update(camera, pointer11, ratio) {
    this._ndc.set(pointer11.x, pointer11.y, 0.5).unproject(camera)
    this._dir.copy(this._ndc).sub(camera.position).normalize()
    const forward = new Vector3()
    camera.getWorldDirection(forward)
    const t = 19.25 / Math.max(0.0001, this._dir.dot(forward))
    this._target.copy(camera.position).addScaledVector(this._dir, t)
    this.value.lerp(this._target, 1 - Math.pow(1 - 0.03, ratio))
  }
}


/**
 * Helper untuk orkestrator timeline intro (blueprint 6.5): semua uniform intro lembah + langit.
 * Semua default 1 (sudah tampil penuh). Jadwal asli:
 *   progress      0 -> 1, 7.5 s inOut1 di detik 0.7 (tanah, terrain, patch, gunung: segitiga jarang)
 *   progress2     0 -> 1, 7.5 s inOut3 di detik 0.7 (isi biru + pita segitiga, alpha dunia muncul dari tengah)
 *   mountainAlpha 0 -> 1, 3 s di detik 0.7
 *   skyProgress   0 -> 1, 3 s di detik 1.5 (warna intro #b3bac9 ke gradient langit)
 */
export function getValleyIntroUniforms(scene) {
  const mountain = scene.getObjectByName('mountain1')
  const sky = scene.getObjectByName('sky')
  return {
    progress: VALLEY_INTRO.uProgress,
    progress2: VALLEY_INTRO.uProgress2,
    mountainAlpha: mountain ? mountain.material.uniforms.uAlpha : null,
    skyProgress: sky ? sky.material.uniforms.uProgress : null,
  }
}
