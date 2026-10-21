import {
  Mesh, Group, ShaderMaterial, PlaneGeometry, InstancedBufferGeometry, InstancedBufferAttribute,
  BufferGeometry, Float32BufferAttribute, Color, Vector2, Vector3,
} from 'three'
import '../../glsl/chunks.js'
import { loadGeometry, loadTexture } from '../../engine/Assets.js'
import { skyUniforms, fbmJS, ridged } from './look.js'

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
  // cincin pegunungan jauh (tambahan sendiri, bukan layout igloo): kamera yang mundur jauh dan layar lebar
  // selalu melihat punggung gunung berlapis di cakrawala. Rotasi kecil atau cermin z (scale z negatif)
  // supaya arah matahari bake (+x) tetap konsisten.
  { pos: [199, -2, -17], scale: [9, 7, 9], rot: [2, 8, 0] },
  { pos: [122, -2, -230], scale: [10, 8, -10], rot: [3, -12, 0] },
  { pos: [253, 0, -212], scale: [13, 9, 13], rot: [0, 18, 2] },
  { pos: [79, 0, -372], scale: [14, 10, -14], rot: [2, -6, 0] },
  { pos: [-20, -2, -229], scale: [9, 8, 9], rot: [3, 22, 0] },
  { pos: [-150, 0, -260], scale: [12, 9, -12], rot: [0, -15, 2] },
  { pos: [-138, -2, -116], scale: [8, 6, 8], rot: [2, 10, 0] },
  { pos: [309, 0, 83], scale: [11, 8, -11], rot: [0, 12, 0] },
  { pos: [205, -2, 143], scale: [9, 7, 9], rot: [2, -20, 0] },
  { pos: [381, 4, -178], scale: [16, 10, 16], rot: [0, 5, 0] },
  { pos: [-235, 0, 40], scale: [10, 8, 10], rot: [2, 15, 0] },
]
// Terrain cincin luar (tambahan sendiri): mesh + bake tanah yang sama, diperbesar 2 sampai 2.6 kali, di sisi
// kiri/kanan dan belakang lembah. Koridor depan kamera sengaja dibiarkan ke tanah jauh yang halus (tile bake
// yang diperbesar terlalu bersudut kalau dilihat dekat). Tepinya tetap memudar ke tanah jauh.
export const TERRAIN_FAR_LAYOUT = [
  { pos: [-38, -1.3, 8], scale: [2, 1.3, 2], rot: [0, 10, 0], order: 0 },
  { pos: [16, -1.1, 34], scale: [2.2, 1.5, 2.2], rot: [0, -8, 0], order: 0 },
  { pos: [32, -0.9, 12], scale: [2.2, 1.5, -2.2], rot: [0, 5, 0], order: 0 },
  { pos: [-36, -0.8, -20], scale: [2.4, 1.7, 2.4], rot: [0, -6, 0], order: 0 },
  { pos: [28, -0.9, -28], scale: [2.6, 1.7, -2.6], rot: [0, 9, 0], order: 0 },
  { pos: [-8, -1.3, -42], scale: [2.6, 1.5, 2.6], rot: [0, -3, 0], order: 0 },
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

// Angin bersama semua efek lembah (salju, goresan, kabut rendah, asap): satu arah, satu "waktu angin".
// Arah (1, 0, 1) = bergerak ke kanan layar di titik istirahat kamera, sama dengan arah salju lama.
const WIND_GLSL = /* glsl */ `
  const vec2 WIND_DIR = vec2(0.70710678, 0.70710678);
  // waktu angin = integral kecepatan 1 + 0.6 cos(0.45 t) + 0.25 cos(1.3 t + 1): semua yang ikut angin
  // ngebut lalu melambat bersamaan (hembusan) tanpa lompatan posisi. Kecepatan 0.15 sampai 1.85 kali dasar.
  float windTime(float t) {
    return t + 1.3333 * sin(0.45 * t) + 0.1923 * sin(1.3 * t + 1.0);
  }
  // kekuatan hembusan lokal 0..1: front yang menyapu searah angin
  float gust(vec2 xz, float t) {
    float x = dot(xz, WIND_DIR);
    return smoothstep(0.3, 0.95, 0.5 + 0.3 * sin(x * 0.09 - t * 1.1) + 0.2 * sin(x * 0.033 - t * 0.47 + 1.7)
      + 0.15 * cos(0.45 * t));
  }
  // koordinat sejajar angin: x searah angin, y melintang (goresan wind_noise memanjang di sumbu u)
  vec2 windSpace(vec2 xz) {
    return vec2(dot(xz, WIND_DIR), dot(xz, vec2(-WIND_DIR.y, WIND_DIR.x)));
  }
`

// Salju tertiup di permukaan (spindrift): goresan memanjang searah angin, ikut waktu angin, kuat saat hembusan.
// Butuh WIND_GLSL dan uniform tWind (wind_noise srgb, jadi sqrt mengembalikan kontras aslinya).
const DRIFT_GLSL = /* glsl */ `
  float spindrift(vec3 world, float t) {
    vec2 w = windSpace(world.xz);
    float wt = windTime(t);
    float a = sqrt(texture2D(tWind, w * vec2(0.03, 0.11) - vec2(wt * 0.075, 0.0)).r);
    a *= sqrt(texture2D(tWind, w * vec2(0.045, 0.17) + vec2(-wt * 0.11, 0.37)).r);
    return smoothstep(0.2, 0.55, a) * (0.3 + 0.7 * gust(world.xz, t));
  }
`

// Kabut jarak (aerial haze), warnanya gradient langit yang sama (aturan projek: tanpa scene.fog).
// Kabut mulai sedikit di depan igloo dari posisi kamera mana pun: saat kamera mundur jauh igloo tetap jelas,
// dunia di belakangnya tenggelam ke kabut, dan di kejauhan tanah menyatu tanpa jahitan dengan langit.
// Butuh igloo_skygradient (uSkyDark, uSkyLight).
const HAZE_GLSL = /* glsl */ `
  float hazeAmount(vec3 world) {
    float start = max(13.0, length(cameraPosition) - 7.0);
    float d = distance(world, cameraPosition);
    return 1.0 - exp(-max(d - start, 0.0) * 0.022);
  }
  vec3 applyHaze(vec3 c, vec3 world, vec2 screenUv) {
    return mix(c, skyGradient(screenUv), hazeAmount(world));
  }
`

// Kabut rendah (menggenang di cekungan, hanyut ikut angin): integral analitik kepadatan eksponensial
// rho(y) = exp(-(y - FOG_BASE) / FOG_H) sepanjang sinar kamera ke permukaan, mulai 6 unit dari kamera.
// Dihitung per permukaan (tanah, terrain, patch, tanah jauh), jadi tidak ada garis potong seperti bidang
// kabut bertumpuk. Kepadatan dimodulasi wind noise di titik permukaan: tambal kabut tebal yang bergerak.
// Butuh WIND_GLSL, igloo_skygradient, dan uniform tWind.
const LOW_FOG_GLSL = /* glsl */ `
  const float FOG_BASE = -1.2;
  const float FOG_H = 1.5;
  const float FOG_DENSITY = 0.075;
  float lowFog(vec3 world) {
    vec3 ray = world - cameraPosition;
    float d = max(length(ray), 0.001);
    float s = min(6.0, d);
    float y1 = cameraPosition.y + ray.y * (s / d);
    float dy = world.y - y1;
    float e1 = exp(-min(y1 - FOG_BASE, 40.0) / FOG_H);
    float e2 = exp(-min(world.y - FOG_BASE, 40.0) / FOG_H);
    float avg = abs(dy) > 0.01 ? (e1 - e2) * FOG_H / dy : e1;
    float amount = FOG_DENSITY * (d - s) * avg;
    vec2 w = windSpace(world.xz);
    float wt = windTime(uTime);
    float n = sqrt(texture2D(tWind, w * vec2(0.012, 0.03) - vec2(wt * 0.03, 0.0)).r);
    n *= sqrt(texture2D(tWind, w * vec2(0.025, 0.06) + vec2(-wt * 0.05, 0.43)).r);
    amount *= 0.35 + 2.4 * n;
    return 1.0 - exp(-amount);
  }
  vec3 applyLowFog(vec3 c, vec3 world, vec2 screenUv) {
    return mix(c, skyGradient(screenUv) * 1.06, lowFog(world));
  }
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
    // dunia luas (tanah jauh, terrain cincin luar) di luar radius 30 dimampatkan ke 30..39, jadi semuanya
    // sudah muncul sebelum progress 1 (tidak meletup di akhir), dan gelombang terasa melesat ke cakrawala
    float dc = d < 30.0 ? d : 30.0 + 9.0 * (1.0 - exp(-(d - 30.0) / 30.0));
    return smoothstep(0.0, 1.5, introBehind(dc, uProgress2));
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
      ...globals, ...skyUniforms(), ...introUniforms(tTri, tMosaic), tMap: { value: tMap }, tMapSans: { value: tMapSans },
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
      #include <igloo_skygradient>
      uniform sampler2D tMap;
      uniform sampler2D tMapSans;
      uniform sampler2D tGlow;
      uniform float uGain;
      uniform sampler2D tWind;
      uniform float uAlpha;
      ${VARYINGS}
      ${VALLEY_INTRO_GLSL}
      ${WIND_GLSL}
      ${DRIFT_GLSL}
      ${HAZE_GLSL}
      ${LOW_FOG_GLSL}
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
        // salju tertiup menyapu permukaan searah angin (lebih tipis dekat kaki igloo supaya bata tetap terbaca)
        c = mix(c, vec3(1.0), spindrift(vWorld, uTime) * mix(0.12, 0.3, smoothstep(3.0, 6.0, length(vPos.xz))));
        float d = introDist(vWorld);
        c += introGlow(vWorld, d);
        c = applyLowFog(c, vWorld, gl_FragCoord.xy / uResolution);
        c = applyHaze(c, vWorld, gl_FragCoord.xy / uResolution);
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
      ...globals, ...skyUniforms(), ...introUniforms(tTri, tMosaic), tMap: { value: tMap }, tWind: { value: tWind },
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
      #include <igloo_skygradient>
      uniform sampler2D tMap;
      uniform sampler2D tWind;
      uniform float uAlpha;
      uniform float uGain;
      ${VARYINGS}
      ${TERRAIN_WIND}
      ${VALLEY_INTRO_GLSL}
      ${WIND_GLSL}
      ${DRIFT_GLSL}
      ${HAZE_GLSL}
      ${LOW_FOG_GLSL}
      void main() {
        vec3 c = texture2D(tMap, vUv).rgb * uGain;
        c += terrainWind(vPos, vWorld, c.r);
        c = mix(c, vec3(1.0), spindrift(vWorld, uTime) * 0.3);
        float d = introDist(vWorld);
        c += introGlow(vWorld, d);
        c = applyLowFog(c, vWorld, gl_FragCoord.xy / uResolution);
        c = applyHaze(c, vWorld, gl_FragCoord.xy / uResolution);
        float alpha = 1.0 - smoothstep(0.85, 1.0, length(vPos.xz) * 0.1085);
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), alpha * uAlpha * introReveal(d));
      }
    `,
  })
  const group = new Group()
  TERRAIN_LAYOUT.concat(TERRAIN_FAR_LAYOUT).forEach((t, i) => {
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
      ...globals, ...skyUniforms(), ...introUniforms(tTri, tMosaic), tMap: { value: tMap }, tWind: { value: tWind },
      uAlpha: { value: 1 }, uGain: GROUND_GAIN,
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
      #include <igloo_skygradient>
      uniform sampler2D tMap;
      uniform sampler2D tWind;
      uniform float uAlpha;
      uniform float uGain;
      ${VARYINGS}
      ${TERRAIN_WIND}
      ${VALLEY_INTRO_GLSL}
      ${WIND_GLSL}
      ${DRIFT_GLSL}
      ${HAZE_GLSL}
      ${LOW_FOG_GLSL}
      void main() {
        vec3 c = texture2D(tMap, vUv).rgb * uGain;
        c += terrainWind(vPos, vWorld, c.r);
        c = mix(c, vec3(1.0), spindrift(vWorld, uTime) * 0.3);
        float d = introDist(vWorld);
        c += introGlow(vWorld, d);
        c = applyLowFog(c, vWorld, gl_FragCoord.xy / uResolution);
        c = applyHaze(c, vWorld, gl_FragCoord.xy / uResolution);
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

// ---------- tanah jauh: dunia yang lebih luas dari lembah bake ----------

const mix = (a, b, t) => a + (b - a) * t
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
// Arah dari igloo ke kamera (titik istirahat dan jalur mundur). Koridor ini dijaga rendah supaya
// bukit tanah jauh tidak pernah menutupi igloo saat kamera mundur jauh.
const CAM_DIR = new Vector2(-0.68, 0.73).normalize()

/** Tinggi tanah jauh (deterministik): dasar di bawah lembah bake, perbukitan di luar r 24, kaki gunung di cakrawala. */
export function farGroundHeight(x, z) {
  const r = Math.hypot(x, z)
  const along = x * CAM_DIR.x + z * CAM_DIR.y
  const across = Math.abs(-x * CAM_DIR.y + z * CAM_DIR.x)
  // lebar koridor tumbuh menjauhi igloo (kerucut pandang kamera)
  const corridor = along > 0 ? 1 - Math.exp(-((across / (12 + along * 0.32)) ** 2)) : 1
  const k = smooth(24, 75, r)
  const hills = fbmJS(x * 0.016 + 3.1, z * 0.016 - 1.7)
  const dunes = fbmJS(x * 0.06 - 5.3, z * 0.06 + 2.2, 4)
  const range = ridged(x * 0.0045 + 11.3, z * 0.0045 - 7.1)
  const kd = smooth(14, 34, r)
  const kFar = smooth(130, 480, r)
  return mix(-2.2, -1.9, smooth(12, 22, r)) + kd * dunes * 1.4 + k * Math.max(0, hills - 0.35) * 16 * corridor
    + kFar * range * 26
}

// r0 kecil: tanah jauh juga ada di bawah tanah utama, jadi tepi alpha tanah utama (r 7.4 sampai 9.2) tidak bolong
function farGroundGeometry(rings = 110, segs = 192, r0 = 1, r1 = 780) {
  const pos = []
  for (let i = 0; i <= rings; i++) {
    // jarak antar cincin logaritmik: rapat dekat lembah, jarang di cakrawala
    const r = r0 * Math.pow(r1 / r0, i / rings)
    for (let j = 0; j <= segs; j++) {
      const a = (j / segs) * Math.PI * 2
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      pos.push(x, farGroundHeight(x, z), z)
    }
  }
  const index = []
  const row = segs + 1
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * row + j
      const b = a + row
      index.push(a, a + 1, b, b, a + 1, b + 1)
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
  geo.setIndex(index)
  geo.computeVertexNormals()
  return geo
}

/**
 * Tanah jauh (tambahan sendiri, bukan bagian igloo asli): cakram relief r 1 sampai 780 di bawah lembah bake.
 * Mengisi semua celah dan tepi terrain, perbukitan di sisi lembah, kaki gunung di cakrawala, lalu tenggelam
 * ke kabut gradient langit sampai menyatu tanpa jahitan. Tanpa bake: lambert palsu dengan matahari yang sama
 * dengan bake Cycles (+x, elevasi 27 derajat), warna bayangan/terang diambil dari persentil ground_color.webp,
 * butiran salju dari bake tanah di dua skala.
 */
export async function createFarGround(globals) {
  const [tMap, tWind, [tTri, tMosaic]] = await Promise.all([
    loadTexture('ground_color.webp', 'srgb'), loadTexture('wind_noise.png', 'srgb-repeat'), loadIntroTextures(),
  ])
  const mat = new ShaderMaterial({
    transparent: true,
    uniforms: {
      ...globals, ...skyUniforms(), ...introUniforms(tTri, tMosaic), tMap: { value: tMap }, tWind: { value: tWind },
      uShadow: { value: new Color('#6b6f76') }, uLit: { value: new Color('#a8aab2') }, uGain: GROUND_GAIN,
      uAlpha: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormal = normal;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      #include <igloo_globals>
      #include <igloo_skygradient>
      uniform sampler2D tMap;
      uniform sampler2D tWind;
      uniform vec3 uShadow;
      uniform vec3 uLit;
      uniform float uGain;
      uniform float uAlpha;
      varying vec3 vWorld;
      varying vec3 vNormal;
      ${VALLEY_INTRO_GLSL}
      ${WIND_GLSL}
      ${DRIFT_GLSL}
      ${HAZE_GLSL}
      ${LOW_FOG_GLSL}
      const vec3 SUN = vec3(0.891, 0.454, 0.0);
      // tekstur bake di-clamp (dipakai bersama terrain), jadi ulang cermin dibuat manual: tanpa jahitan walau
      // bake tidak tileable, LOD mip dari turunan uv asli supaya tidak ada garis di batas ulang
      vec3 bakeAt(vec2 uv) {
        vec2 m = 1.0 - abs(1.0 - mod(uv, 2.0));
        return textureGrad(tMap, m, dFdx(uv), dFdy(uv)).rgb;
      }
      void main() {
        float ndl = clamp(dot(normalize(vNormal), SUN), 0.0, 1.0);
        vec3 c = mix(uShadow, uLit, ndl) * uGain;
        // butiran salju: luminansi bake tanah di dua skala dan rotasi berbeda (rata-rata linear ~0.26)
        float g1 = bakeAt(vWorld.xz / 37.0 + 0.13).g;
        float g2 = bakeAt(mat2(0.8, -0.6, 0.6, 0.8) * vWorld.xz / 91.0 + 0.41).g;
        c *= mix(1.0, clamp(g1 * g2 / 0.068, 0.5, 1.6), 0.55);
        // dekat lembah (celah antar terrain bake) pakai bake tanah itu sendiri, diulang tiap 24 m, supaya
        // celah punya bayangan dan AO yang sama dengan terrain di sekitarnya, plus sedikit gelap di cekungan
        vec3 bake = bakeAt(vec2(vWorld.x, -vWorld.z) / 24.0 + 0.5) * uGain * mix(1.0, ndl / 0.454, 0.35);
        c = mix(c, bake, 1.0 - smoothstep(30.0, 70.0, length(vWorld.xz)));
        c *= mix(1.0, 0.85, smoothstep(-1.2, -2.1, vWorld.y));
        c = mix(c, vec3(1.0), spindrift(vWorld, uTime) * 0.3);
        float d = introDist(vWorld);
        c += introGlow(vWorld, d);
        // dasar tanah jauh di celah antar terrain ada 1 sampai 2 unit di bawah permukaan bake: kabut rendahnya
        // dihitung seolah di tinggi -1 supaya celah tidak jadi "kolam" kabut terang bertepi tajam
        c = applyLowFog(c, vec3(vWorld.x, max(vWorld.y, -1.0), vWorld.z), gl_FragCoord.xy / uResolution);
        c = applyHaze(c, vWorld, gl_FragCoord.xy / uResolution);
        float alpha = 1.0 - smoothstep(600.0, 770.0, length(vWorld.xz));
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), alpha * uAlpha * introReveal(d));
      }
    `,
  })
  const mesh = new Mesh(farGroundGeometry(), mat)
  mesh.name = 'farGround'
  // digambar paling awal di antara objek transparan: terrain bake memudar di atasnya
  mesh.renderOrder = -1
  mesh.frustumCulled = false
  mesh.matrixAutoUpdate = false
  return mesh
}

/** Gunung jauh: satu mesh dipakai 5 kali (plus cincin pegunungan tambahan), bake + kabut warna langit. */
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
 * Salju: quad kecil yang jatuh miring dan berputar 3D. Versi vertex shader saja (tanpa GPGPU):
 * kecepatan jatuh hasil sim igloo (gravitasi 0.004, friksi 0.9) dihitung analitik. Tambahan sendiri:
 * dorongan horizontal ikut "waktu angin" (hembusan, butir ngebut lalu melambat bersamaan), butir memanjang
 * searah angin saat hembusan kuat (goresan), dan kotak treadmill 25 x 10 x 25 mengikuti kamera
 * (digeser ke depan arah pandang) supaya salju tetap ada saat kamera mundur jauh atau intro dari atas.
 */
export function createSnow(globals, count = 2000) {
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
      ${WIND_GLSL}
      mat3 rotAxis(vec3 a, float ang) {
        float s = sin(ang), c = cos(ang), oc = 1.0 - c;
        return mat3(oc * a.x * a.x + c, oc * a.x * a.y + a.z * s, oc * a.z * a.x - a.y * s,
                    oc * a.x * a.y - a.z * s, oc * a.y * a.y + c, oc * a.y * a.z + a.x * s,
                    oc * a.z * a.x + a.y * s, oc * a.y * a.z - a.x * s, oc * a.z * a.z + c);
      }
      void main() {
        vUv = uv;
        float w = aSeed.x;
        vec3 wind3 = vec3(WIND_DIR.x, 0.0, WIND_DIR.y);
        // fase hembusan ikut posisi searah angin, jadi front hembusan terasa menyapu lembah
        float phase = -dot(aStart.xz, WIND_DIR) * 0.04;
        vec3 p = aStart + wind3 * (windTime(uTime + phase) - windTime(phase)) * mix(1.7, 2.9, aSeed.z);
        p.y -= 1.56 * mix(0.77, 1.23, aSeed.y) * uTime;
        p.x += sin(uTime * 0.2 + w * 15.65) * 0.6 + sign(w - 0.5) * 0.9 * uTime * 0.35;
        // treadmill di sekitar kamera, pusat kotak 16 unit di depan arah pandang
        vec3 forward = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        vec3 center = cameraPosition + forward * 16.0;
        vec3 halfBox = vec3(25.0, 10.0, 25.0);
        p = mod(p - center + halfBox, halfBox * 2.0) - halfBox;
        vec3 edge = smoothstep(halfBox, halfBox * 0.8, abs(p));
        p += center;
        // butir berputar di sumbu acak, lalu memanjang searah angin saat hembusan (goresan salju tertiup)
        vec3 axis = normalize(aSeed.yzw * 2.0 - 1.0 + 0.001);
        vec3 local = rotAxis(axis, uTime * mix(1.0, 3.0, aSeed.z) + w * 6.28) * position;
        float g = gust(p.xz, uTime);
        local += wind3 * dot(local, wind3) * g * 3.0 + wind3 * length(local) * g * 1.5;
        vec4 world = modelMatrix * vec4(p + local, 1.0);
        vec4 mv = viewMatrix * world;
        // pudar dekat batas kotak, dekat kamera, dekat tanah, dan dekat igloo
        vAlpha = edge.x * edge.y * edge.z;
        // dekat kamera dipudarkan (di 4 unit satu butir sudah ~40 px), supaya salju tetap kecil
        vAlpha *= smoothstep(7.0, 15.0, -mv.z);
        vAlpha *= smoothstep(-2.5, 0.5, world.y);
        vAlpha *= smoothstep(4.0, 6.0, length(world.xz));
        vAlpha *= mix(0.8, 1.0, g);
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

/**
 * Goresan angin: garis tipis panjang yang melesat searah angin (salju halus tertiup), hanya terlihat di dalam
 * front hembusan. Quad dibangun di ruang pandang dari titik p ke p + angin * panjang, tebal konstan di layar.
 * alpha = uniform alpha salju (ikut fade-in intro salju).
 */
export function createWindStreaks(globals, alphaUniform, count = 550) {
  const base = new PlaneGeometry(1, 1)
  const geo = new InstancedBufferGeometry()
  geo.index = base.index
  geo.setAttribute('position', base.getAttribute('position'))
  const start = new Float32Array(count * 3)
  const seed = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    start.set([(Math.random() * 2 - 1) * 30, (Math.random() * 2 - 1) * 8, (Math.random() * 2 - 1) * 30], i * 3)
    seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4)
  }
  geo.setAttribute('aStart', new InstancedBufferAttribute(start, 3))
  geo.setAttribute('aSeed', new InstancedBufferAttribute(seed, 4))
  geo.instanceCount = count
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { ...globals, uAlpha: alphaUniform },
    vertexShader: /* glsl */ `
      #include <igloo_globals>
      attribute vec3 aStart;
      attribute vec4 aSeed;
      varying float vAlpha;
      varying float vAlong;
      ${WIND_GLSL}
      void main() {
        vec3 wind3 = vec3(WIND_DIR.x, 0.0, WIND_DIR.y);
        float speed = mix(7.0, 12.0, aSeed.x);
        vec3 p = aStart + wind3 * windTime(uTime + aSeed.y * 9.0) * speed;
        p.y += sin(uTime * 0.7 + aSeed.z * 6.28) * 0.4 - uTime * 0.3;
        vec3 forward = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
        vec3 center = cameraPosition + forward * 18.0;
        vec3 halfBox = vec3(30.0, 8.0, 30.0);
        p = mod(p - center + halfBox, halfBox * 2.0) - halfBox;
        vec3 edge = smoothstep(halfBox, halfBox * 0.75, abs(p));
        p += center;
        float len = mix(0.6, 1.6, aSeed.w);
        vec4 a = viewMatrix * vec4(p, 1.0);
        vec4 b = viewMatrix * vec4(p + wind3 * len, 1.0);
        float t = position.x + 0.5;
        vec4 mv = mix(a, b, t);
        vec2 dir = b.xy - a.xy;
        dir = length(dir) > 1e-5 ? normalize(dir) : vec2(1.0, 0.0);
        // tebal ~1.3 px di 768 px tinggi layar (fov 30) di jarak berapa pun
        mv.xy += vec2(-dir.y, dir.x) * position.y * -mv.z * 0.0011;
        vAlong = t;
        float g = gust(p.xz, uTime);
        vAlpha = edge.x * edge.y * edge.z * smoothstep(0.2, 0.9, g);
        vAlpha *= smoothstep(5.0, 12.0, -mv.z) * smoothstep(-2.0, 0.5, p.y);
        vAlpha *= smoothstep(4.0, 7.0, length(p.xz));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uAlpha;
      varying float vAlpha;
      varying float vAlong;
      void main() {
        // ujung goresan meruncing, kepala lebih terang dari ekor
        float a = sin(vAlong * 3.14159) * mix(0.4, 1.0, vAlong) * vAlpha * uAlpha * 0.35;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vec3(1.0), a);
      }
    `,
  })
  const mesh = new Mesh(geo, mat)
  mesh.frustumCulled = false
  mesh.renderOrder = 5
  mesh.name = 'windStreaks'
  return mesh
}

/**
 * Asap angin: 2 bidang (asli 20 x 5, di sini 30 x 7), alpha = tiga lookup wind noise dikalikan.
 * Tambahan sendiri: lookup di-sqrt (tekstur srgb, jadi kontras asli kembali), bergerak dengan waktu angin.
 * uAlpha kedua bidang ini juga dipakai kabut di createMist (satu fade-in intro untuk semua kabut).
 */
export async function createSmoke(globals) {
  const tWind = await loadTexture('wind_noise.png', 'srgb-repeat')
  const geo = new PlaneGeometry(30, 7)
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
      ${WIND_GLSL}
      void main() {
        float t = windTime(uTime) * 0.15 + uOffset;
        vec2 uv = vUv * vec2(4.0, 1.0);
        float a = sqrt(texture2D(tWind, uv * 0.6 - vec2(t, 0.0)).r);
        a *= sqrt(texture2D(tWind, uv * 0.9 + vec2(-t * 1.3, 0.21)).r);
        a *= sqrt(texture2D(tWind, uv * 0.35 - vec2(t * 0.7, 0.53)).r);
        a = smoothstep(0.03, 0.3, a);
        // pudar di tepi, lebih tebal di bawah
        a *= smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x) * smoothstep(1.0, 0.25, vUv.y) * smoothstep(0.0, 0.12, vUv.y);
        gl_FragColor = vec4(vec3(1.0), clamp(a, 0.0, 1.0) * 0.5 * uAlpha);
      }
    `,
  })
  const group = new Group()
  const a = new Mesh(geo, make(0))
  a.position.set(-5, 1.5, -10)
  const b = new Mesh(geo, make(0.914))
  b.position.set(13.45, 3, -4)
  b.rotation.y = -10 * DEG
  for (const m of [a, b]) {
    m.renderOrder = 2
    group.add(m)
  }
  return group
}

// Asap/kabut melayang (billboard tegak menghadap kamera): [x, z, lebar, tinggi]. Posisi awal, lalu hanyut
// searah angin dan dibungkus dalam kotak 300 x 300 di sekitar igloo.
const MIST_SPRITES = [
  [-18, -8, 36, 9], [8, -22, 44, 11], [30, 4, 40, 10], [-34, 26, 50, 12], [20, 30, 46, 10],
  [-10, 44, 40, 9], [52, -40, 70, 16], [-60, -30, 64, 15], [70, 40, 70, 15], [-80, 60, 80, 18],
  [10, -80, 90, 20], [-30, 90, 70, 14], [95, -5, 80, 17], [-100, -90, 100, 22], [40, 110, 90, 18],
  [120, -110, 110, 24],
]

/**
 * Cuaca lembah (tambahan sendiri, tidak ada di igloo asli): asap melayang di seluruh lembah dan selubung
 * kabut tipis di bawah layar (di depan kamera). Kabut rendah yang menggenang ada di shader permukaan (LOW_FOG_GLSL). Semua warna = gradient langit (kabut
 * tanpa scene.fog), alpha = 3 lookup wind noise dikalikan (resep asap igloo), bergerak dengan waktu angin.
 * alphaUniform = uAlpha asap (ikut fade-in intro asap di detik 2).
 */
export async function createMist(globals, alphaUniform) {
  const tWind = await loadTexture('wind_noise.png', 'srgb-repeat')
  const shared = { ...globals, ...skyUniforms(), tWind: { value: tWind }, uAlpha: alphaUniform }
  const group = new Group()
  group.name = 'mist'

  // 1. asap melayang: billboard tegak (berputar di sumbu y menghadap kamera), dasar di dasar lembah
  {
    const base = new PlaneGeometry(1, 1)
    const geo = new InstancedBufferGeometry()
    geo.index = base.index
    geo.setAttribute('position', base.getAttribute('position'))
    geo.setAttribute('uv', base.getAttribute('uv'))
    const data = new Float32Array(MIST_SPRITES.length * 4)
    const seed = new Float32Array(MIST_SPRITES.length)
    MIST_SPRITES.forEach((s, i) => {
      data.set(s, i * 4)
      seed[i] = ((i * 0.618034) % 1)
    })
    geo.setAttribute('aSprite', new InstancedBufferAttribute(data, 4))
    geo.setAttribute('aSeed', new InstancedBufferAttribute(seed, 1))
    geo.instanceCount = MIST_SPRITES.length
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { ...shared, uStrength: { value: 0.55 } },
      vertexShader: /* glsl */ `
        #include <igloo_globals>
        attribute vec4 aSprite;
        attribute float aSeed;
        varying vec2 vUv;
        varying float vFade;
        varying float vSeed;
        ${WIND_GLSL}
        void main() {
          vUv = uv;
          vSeed = aSeed;
          vec2 c = aSprite.xy + WIND_DIR * windTime(uTime + aSeed * 20.0) * mix(1.4, 2.4, aSeed);
          c = mod(c + 150.0, 300.0) - 150.0;
          vFade = smoothstep(150.0, 115.0, abs(c.x)) * smoothstep(150.0, 115.0, abs(c.y));
          vec3 center = vec3(c.x, -2.4, c.y);
          vec3 right = normalize(vec3(viewMatrix[0][0], 0.0, viewMatrix[2][0]));
          vec3 world = center + right * position.x * aSprite.z + vec3(0.0, (position.y + 0.5) * aSprite.w, 0.0);
          float dc = distance(center, cameraPosition);
          // tidak menutupi lensa dan tidak menembus igloo
          vFade *= smoothstep(5.0, 16.0, dc) * smoothstep(6.0, 14.0, length(c));
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        #include <igloo_globals>
        #include <igloo_skygradient>
        uniform sampler2D tWind;
        uniform float uAlpha;
        uniform float uStrength;
        varying vec2 vUv;
        varying float vFade;
        varying float vSeed;
        ${WIND_GLSL}
        void main() {
          float wt = windTime(uTime);
          vec2 uv = vUv * vec2(3.0, 1.0);
          float a = sqrt(texture2D(tWind, uv * 0.5 + vec2(-wt * 0.05 + vSeed, vSeed)).r);
          a *= sqrt(texture2D(tWind, uv * 0.8 + vec2(-wt * 0.08, 0.31 + vSeed)).r);
          a *= sqrt(texture2D(tWind, uv * 0.27 + vec2(-wt * 0.03, 0.63 - vSeed)).r);
          a = smoothstep(0.03, 0.3, a);
          a *= smoothstep(0.0, 0.2, vUv.x) * smoothstep(1.0, 0.8, vUv.x);
          a *= smoothstep(0.0, 0.22, vUv.y) * smoothstep(1.0, 0.3, vUv.y);
          a *= vFade * uStrength * uAlpha;
          if (a < 0.003) discard;
          gl_FragColor = vec4(skyGradient(gl_FragCoord.xy / uResolution) * 1.1, a);
        }
      `,
    })
    const mesh = new Mesh(geo, mat)
    mesh.name = 'mistSprites'
    mesh.frustumCulled = false
    mesh.renderOrder = 4
    group.add(mesh)
  }

  // 2. selubung depan kamera: quad layar penuh, kabut tertiup di bawah layar dan pojok bawah, tengah bersih
  //    supaya igloo tetap terbaca. Makin tebal saat kamera mundur jauh. Pola bergeser ikut gerak kamera.
  {
    const mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      uniforms: { ...shared, uStrength: { value: 0.5 } },
      vertexShader: /* glsl */ `
        varying vec2 vScreen;
        void main() {
          vScreen = position.xy + 0.5;
          gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        #include <igloo_globals>
        #include <igloo_skygradient>
        uniform sampler2D tWind;
        uniform float uAlpha;
        uniform float uStrength;
        varying vec2 vScreen;
        ${WIND_GLSL}
        void main() {
          vec2 s = vScreen;
          float wt = windTime(uTime);
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec2 cam = vec2(dot(cameraPosition, right), cameraPosition.y) * 0.015;
          vec2 uv = vec2(s.x * uAspect, s.y) * vec2(0.5, 1.5) + cam;
          float a = sqrt(texture2D(tWind, uv * 0.7 - vec2(wt * 0.06, 0.0)).r);
          a *= sqrt(texture2D(tWind, uv * 1.1 + vec2(-wt * 0.09, 0.37)).r);
          a *= sqrt(texture2D(tWind, uv * 0.4 + vec2(-wt * 0.035, 0.71)).r);
          a = smoothstep(0.03, 0.3, a);
          float mask = smoothstep(0.4, 0.0, s.y);
          mask += smoothstep(0.55, 1.0, abs(s.x - 0.5) * 2.0) * smoothstep(0.7, 0.15, s.y) * 0.6;
          float far = smoothstep(20.0, 55.0, length(cameraPosition));
          a *= clamp(mask, 0.0, 1.0) * mix(1.0, 1.5, far) * uStrength * uAlpha;
          gl_FragColor = vec4(skyGradient(s) * 1.08, clamp(a, 0.0, 1.0));
        }
      `,
    })
    const mesh = new Mesh(new PlaneGeometry(1, 1), mat)
    mesh.name = 'mistVeil'
    mesh.frustumCulled = false
    mesh.renderOrder = 6
    group.add(mesh)
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
