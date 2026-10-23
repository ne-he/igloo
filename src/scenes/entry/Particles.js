import {
  WebGLRenderTarget, FloatType, HalfFloatType, RGBAFormat, NearestFilter, ClampToEdgeWrapping, DataTexture,
  RawShaderMaterial, ShaderMaterial, GLSL3, BufferGeometry, Float32BufferAttribute, Points, Color, Vector3,
  Matrix4, CustomBlending, AddEquation, SrcAlphaFactor, SrcColorFactor,
} from 'three'
import { floatSupport } from '../../engine/rtType.js'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import '../../glsl/chunks.js'

// Partikel volume GPGPU (blueprint 5.5 baris "Partikel volume 150k", skill ref 02 bagian 7.7, ref 01 bagian 6.6).
// Sim ping-pong MRT: out0 = posisi + bayangan (w), out1 = kecepatan + laju halus (w). Per langkah partikel ditarik ke
// permukaan SDF 3D yang berputar, didorong fluida di posisi layarnya, diaduk curl noise, ditarik pegas ke posisi awal.
// Render: Points bola palsu, blending custom src*srcAlpha + dst*srcColor (tiap partikel mewarnai yang di belakangnya,
// terasa seperti bayangan volumetrik yang padat). Semua shader ditulis sendiri dari deskripsi teknik.

// ---- Tangga fallback M7b (blueprint 9). QUALITY_STEP = satu-satunya tombol; jumlah partikel ikut dari sini. ----
//   0: 150k, curl 4D, fluid      (target)
//   1: 60k, curl 3D, fluid
//   2: 60k, curl 3D, tanpa fluid
//   3: InstancedMesh 30k tanpa sim (belum dibuat, hanya kalau langkah 2 masih gagal)
export const QUALITY_STEP = 0
const LADDER = [
  { count: 150000, curl4D: true, fluid: true },
  { count: 60000, curl4D: false, fluid: true },
  { count: 60000, curl4D: false, fluid: false },
]

/** Kualitas aktif. Di dev, `?pq=0..2` menimpa QUALITY_STEP supaya tangga bisa diukur tanpa edit file. */
export function particleQuality() {
  let step = QUALITY_STEP
  if (import.meta.env?.DEV && typeof location !== 'undefined') {
    const q = new URLSearchParams(location.search).get('pq')
    if (q !== null && LADDER[+q]) step = +q
  }
  return { step, ...LADDER[step] }
}

export const PARTICLE_COUNT = LADDER[QUALITY_STEP].count

// Angka asli (skill ref 02 bagian 7.7).
export const PARTICLES = {
  cube: 0.65, // posisi awal acak di kubus ini
  radius: 0.275, // clamp silinder
  yMin: -0.34,
  yMax: 0.35,
  size: 10,
  // [?] Di ref 14 bola partikel kira-kira 2x lebih besar relatif ke tinggi bentuk daripada hasil rumus
  // size / jarak * resY / 1300 di kamera kita, jadi dikali faktor ini (diukur dari crop ref vs screenshot kita).
  sizeTune: 1.8,
  light: new Vector3(-0.75, 1, -0.1),
  rotationSpeed: 0.75, // rad/s, uRotation turun terus
  // Pre-sim sebelum pertama tampil. igloo: 1 detik. Bentuk kita (tabung tipis, rongga) baru rapi sesudah sekitar
  // 2 detik (screenshot m7b_n9.500 dengan 1 detik masih berkabut di tengah), jadi 2 detik disimulasikan dengan
  // langkah besar: 40 langkah x ratio 3 (= 120 frame 60 Hz). Biaya GPU sama dengan 40 langkah biasa.
  presimFrames: 120,
  presimRatio: 3,
  minStepMs: 15, // throttle sim
  // titik tujuan saat ganti link (tambahan kita, 19 Okt 2026). Data asli: partikel cuma ditarik ke permukaan
  // TERDEKAT dari posisinya sekarang, jadi bentuk baru mewarisi sebaran bentuk lama. Bagian bentuk baru di luar
  // jejak bentuk lama nyaris tidak kebagian partikel (batang "i" LinkedIn sesudah emblem GitHub yang sempit,
  // pinggir cakram GitHub sesudah avatar, sisi cincin WhatsApp) dan pegas asli 0.001 butuh belasan detik untuk
  // meratakannya. Sesudah ganti link, tiap partikel ditarik (kekuatan assign per frame 60 Hz, turun ke 0 dalam
  // assignDuration detik) ke titik permukaan yang terdekat dengan posisi awalnya. Hasilnya morf langsung dari
  // bentuk lama ke bentuk baru dengan sebaran yang sama seperti bentuk itu dibentuk dari awan awal.
  assign: 0.008, // dipilih lewat cakupan muka saat berputar: 0.004 masih 35% bolong di detik 1 (GitHub)
  assignDuration: 1.5,
  // posisi awal ikut berputar (tambahan kita, 19 Okt 2026). Data asli: posisi awal diam di dunia sementara SDF
  // berputar 0.75 rad/s. Dilihat dari bentuk, target pegas itu berputar terus, rata-ratanya jatuh di sumbu
  // putar, jadi partikel kulit pelan-pelan terseret ke tengah dan bagian bentuk yang jauh dari sumbu (sisi
  // cincin WhatsApp, pinggir lempeng LinkedIn) kosong. Dengan target ikut berputar, sebaran tetap rata.
  spinTargets: true,
}

/**
 * Tipe RT sim yang bisa DIRENDER: Float kalau EXT_color_buffer_float, HalfFloat kalau cuma half, null kalau tidak ada
 * (GPU HP lama). null = sim GPGPU dan fluid mati, partikel tidak tampil (posisi tidak bisa disimpan di 8 bit).
 */
export function simTargetType(renderer) {
  // cek framebuffer sungguhan (rtType.js), ekstensi saja tidak selalu jujur
  const s = floatSupport(renderer)
  if (s.float) return FloatType
  if (s.half) return HalfFloatType
  return null
}

/** Ukuran tekstur sim: ceil(sqrt(n) / 4) * 4 (150k -> 388). */
export const simSize = (n) => Math.ceil(Math.sqrt(n) / 4) * 4

// ---- noise: gradient noise 4D/3D dengan turunan analitik, lalu "bitangent": cross(grad n1, grad n2) ----
// cross dua gradient selalu bebas divergensi (teknik bitangent noise, Atyuwen), jadi partikel berpusar tanpa
// menggumpal. Hash integer = pcg4d (Jarzynski & Olano, JCGT 2020). Kode ditulis sendiri.
const NOISE = /* glsl */ `
// batas loop dari uniform (16 / 8): mencegah compiler HLSL (ANGLE D3D11) membuka loop, kompilasi jauh lebih cepat
uniform int uCorners4;
uniform int uCorners3;
uvec4 pcg4(uvec4 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  v ^= v >> 16u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  return v;
}
// dua gradient acak per sudut dari satu hash 128 bit (16 bit per komponen)
void cornerGrads(uvec4 h, out vec4 g1, out vec4 g2) {
  g1 = vec4(h & 0xffffu) * (2.0 / 65535.0) - 1.0;
  g2 = vec4(h >> 16u) * (2.0 / 65535.0) - 1.0;
}
// turunan ruang (xyz) dua noise gradient 4D sekaligus
void gradNoise4(vec4 p, out vec3 d1, out vec3 d2) {
  vec4 i = floor(p);
  vec4 f = p - i;
  vec4 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec4 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  uvec4 base = uvec4(ivec4(i) + 65536);
  d1 = vec3(0.0);
  d2 = vec3(0.0);
  for (int c = 0; c < uCorners4; c++) {
    vec4 o = vec4(float(c & 1), float((c >> 1) & 1), float((c >> 2) & 1), float((c >> 3) & 1));
    vec4 g1, g2;
    cornerGrads(pcg4(base + uvec4(o)), g1, g2);
    vec4 r = f - o;
    vec4 wv = mix(1.0 - u, u, o);
    vec4 dw = mix(-du, du, o);
    float w = wv.x * wv.y * wv.z * wv.w;
    vec3 dW = vec3(dw.x * wv.y * wv.z, wv.x * dw.y * wv.z, wv.x * wv.y * dw.z) * wv.w;
    d1 += dW * dot(g1, r) + w * g1.xyz;
    d2 += dW * dot(g2, r) + w * g2.xyz;
  }
}
void gradNoise3(vec3 p, out vec3 d1, out vec3 d2) {
  vec3 i = floor(p);
  vec3 f = p - i;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec3 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  uvec4 base = uvec4(uvec3(ivec3(i) + 65536), 7u);
  d1 = vec3(0.0);
  d2 = vec3(0.0);
  for (int c = 0; c < uCorners3; c++) {
    vec3 o = vec3(float(c & 1), float((c >> 1) & 1), float((c >> 2) & 1));
    vec4 g1, g2;
    cornerGrads(pcg4(base + uvec4(uvec3(o), 0u)), g1, g2);
    vec3 r = f - o;
    vec3 wv = mix(1.0 - u, u, o);
    vec3 dw = mix(-du, du, o);
    float w = wv.x * wv.y * wv.z;
    vec3 dW = vec3(dw.x * wv.y * wv.z, wv.x * dw.y * wv.z, wv.x * wv.y * dw.z);
    d1 += dW * dot(g1.xyz, r) + w * g1.xyz;
    d2 += dW * dot(g2.xyz, r) + w * g2.xyz;
  }
}
vec3 bitangentNoise(vec3 p, float t) {
  vec3 a, b;
#ifdef CURL_4D
  gradNoise4(vec4(p, t), a, b);
#else
  gradNoise3(p + vec3(t * 0.31, t * 0.67, -t * 0.23), a, b);
#endif
  return cross(a, b);
}
`

const SIM_VERT = /* glsl */ `
precision highp float;
in vec3 position;
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`

const SIM_HEAD = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;
uniform sampler2D tOrig;
`

// tulis posisi awal (w = 1, terang penuh) dan kecepatan nol
const INIT_FRAG = /* glsl */ `${SIM_HEAD}
void main() {
  vec4 o = texelFetch(tOrig, ivec2(gl_FragCoord.xy), 0);
  oPos = vec4(o.xyz, 1.0);
  oVel = vec4(0.0);
}
`

const SIM_FRAG = /* glsl */ `${SIM_HEAD}
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform sampler2D tFluid;
uniform sampler3D tVolume;
uniform float uVolumeScale;
uniform float uRotation;
uniform float uRatio;
uniform float uTime;
uniform float uInteract;
uniform float uAdditionalNoise;
uniform float uShowNoise;
uniform float uFluidOn;
uniform float uFluidGain;
uniform float uAssign;
uniform float uSpinTargets;
uniform mat4 uMVP;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uLightPos;
uniform float uCube;
uniform float uRadius;
uniform vec2 uYRange;
${NOISE}
void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  vec4 P = texelFetch(tPos, ij, 0);
  vec4 V = texelFetch(tVel, ij, 0);
  vec4 O = texelFetch(tOrig, ij, 0);
  vec3 p = P.xyz;
  vec3 v = V.xyz;
  float rnd = O.w;
  // penjaga NaN / meledak: perbandingan dengan NaN selalu false, jadi NaN ikut ter-reset
  if (!(abs(p.x) + abs(p.y) + abs(p.z) < 4.0)) { p = O.xyz; v = vec3(0.0); }
  if (!(abs(v.x) + abs(v.y) + abs(v.z) < 0.5)) v = vec3(0.0);

  // ---- SDF di ruang volume yang diputar uRotation di sumbu Y ----
  float cs = cos(uRotation);
  float sn = sin(uRotation);
  vec3 lp = vec3(cs * p.x + sn * p.z, p.y, -sn * p.x + cs * p.z);
  vec3 q = lp / uCube * uVolumeScale + 0.5;
  vec4 s = texture(tVolume, q);
  vec3 gv = s.rgb * 2.0 - 1.0;
  float d = (s.a * 2.0 - 1.0) * 2.0;
  // di luar kotak volume nilai tepi di-clamp: tambah jarak ke kotak dan arahkan gradient ke pusat
  vec3 outBox = max(abs(q - 0.5) - 0.5, 0.0);
  float ob = length(outBox);
  if (ob > 0.0) { d += ob; gv = q - 0.5; }
  float gl = length(gv);
  vec3 g = gl > 1e-5 ? gv / gl : vec3(0.0); // normalize(0) = NaN, dijaga
  g = vec3(cs * g.x - sn * g.z, g.y, sn * g.x + cs * g.z); // balik ke ruang partikel

  // ---- dorongan fluida di posisi layar partikel ----
  float invFluid = 1.0;
  if (uFluidOn > 0.5) {
    vec4 clip = uMVP * vec4(p, 1.0);
    if (clip.w > 1e-3) {
      vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
      vec2 fv = texture(tFluid, suv).xy * uFluidGain;
      v += (uCamRight * fv.x + uCamUp * fv.y) * 0.0005 * uInteract * uRatio;
      // fluida aktif melemahkan gaya penjaga bentuk, jadi mouse benar-benar bisa merobek bentuk
      invFluid = 1.0 - clamp(length(fv) * 0.65 * uInteract, 0.0, 1.0);
    }
  }

  // ---- curl noise (bebas divergensi), lebih kuat saat ganti link dan saat intro ruang ----
  vec3 cn = bitangentNoise(p * 7.0, uTime * (1.0 + 0.7 * rnd));
  v += cn * (0.0002 * (0.7 + 0.3 * rnd) + 0.0004 * max(uAdditionalNoise, uShowNoise)) * uRatio;

  // ---- pegas ke posisi awal (kabut kubus tipis) ----
  // uSpinTargets (tambahan kita, lihat PARTICLES.spinTargets): posisi awal ikut berputar bersama bentuk
  vec3 home = uSpinTargets > 0.5 ? vec3(cs * O.x - sn * O.z, O.y, sn * O.x + cs * O.z) : O.xyz;
  v += (home - p) * 0.001 * invFluid * uRatio;
  // ---- titik tujuan sesudah ganti link (tambahan kita, lihat PARTICLES.assign) ----
  // tiap partikel ditarik ke titik permukaan bentuk baru yang terdekat dengan POSISI AWAL-nya (bukan posisi
  // sekarang), jadi sebaran di bentuk baru tidak mewarisi jejak bentuk lama. Posisi awal di dalam bentuk = diam.
  if (uAssign > 0.0) {
    vec3 lh = vec3(cs * home.x + sn * home.z, home.y, -sn * home.x + cs * home.z);
    vec3 qh = lh / uCube * uVolumeScale + 0.5;
    vec4 sh = texture(tVolume, qh);
    float dh = (sh.a * 2.0 - 1.0) * 2.0;
    vec3 gh = sh.rgb * 2.0 - 1.0;
    vec3 obh = max(abs(qh - 0.5) - 0.5, 0.0);
    if (length(obh) > 0.0) { dh += length(obh); gh = qh - 0.5; }
    gh = length(gh) > 1e-5 ? normalize(gh) : vec3(0.0);
    gh = vec3(cs * gh.x - sn * gh.z, gh.y, sn * gh.x + cs * gh.z);
    vec3 target = dh > 0.0 ? home - gh * dh * uCube / uVolumeScale : home;
    v += (target - p) * uAssign * uRatio;
  }

  // ---- tarik ke permukaan kalau di luar SDF, di dalam bebas (bentuk terisi) ----
  if (d > 0.0) v -= g * 0.0015 * (0.7 + 0.3 * rnd) * 0.6 * invFluid * uRatio;

  // ---- friksi 0.9 per frame 60 Hz, integrasi, clamp silinder ----
  v *= pow(0.9, uRatio);
  p += v * uRatio;
  float r = length(p.xz);
  if (r > uRadius) p.xz *= uRadius / r;
  p.y = clamp(p.y, uYRange.x, uYRange.y);

  // ---- bayangan: wrap diffuse + pantulan balik, makin dalam di dalam permukaan makin gelap ----
  vec3 toL = uLightPos - p;
  vec3 L = toL / max(length(toL), 1e-4);
  float shade = max(0.0, (dot(L, g) + 0.25) / 1.25) + 0.1;
  shade *= mix(1.0, 0.2, smoothstep(-0.004, -0.03, d));
  // dibekukan selama ganti link supaya warna tidak berkedip saat bentuk pecah
  shade = mix(shade, P.w, clamp(uAdditionalNoise, 0.0, 1.0));

  float speed = mix(V.w, length(v), 1.0 - pow(1.0 - 0.035, uRatio));
  oPos = vec4(p, shade);
  oVel = vec4(v, speed);
}
`

const RENDER_VERT = /* glsl */ `
#include <igloo_globals>
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform float uSize;
uniform float uVisible;
varying float vShade;
varying float vSpeed;
void main() {
  ivec2 ij = ivec2(position.xy);
  vec4 P = texelFetch(tPos, ij, 0);
  vec4 V = texelFetch(tVel, ij, 0);
  vShade = P.w;
  vSpeed = V.w;
  vec4 mv = modelViewMatrix * vec4(P.xyz, 1.0);
  gl_Position = projectionMatrix * mv;
  // ukuran asli: size / jarak pandang * resY / 1300
  gl_PointSize = uSize / max(-mv.z, 0.05) * uResolution.y / 1300.0;
  if (uVisible < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`

const RENDER_FRAG = /* glsl */ `
#include <igloo_common>
uniform vec3 uLightView;
uniform vec3 uColorDark;
uniform vec3 uColorLight;
uniform vec3 uColorFast;
uniform float uShow;
varying float vShade;
varying float vSpeed;
void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  // bola palsu: normal dari koordinat titik (y gl_PointCoord ke bawah)
  vec3 n = vec3(c.x, -c.y, sqrt(1.0 - r2));
  // lambert dibungkus sedikit: sisi bola yang membelakangi cahaya tidak hitam pekat
  float lambert = max(dot(n, uLightView), 0.0) * 0.65 + 0.35;
  // [?] lantai 0.4 pada bayangan sim: tanpa ini bentuk jauh lebih gelap dari ref 14 (median luminans 0.30 vs 0.43)
  vec3 col = mix(uColorDark, uColorLight, clamp(lambert * (0.4 + 0.75 * vShade), 0.0, 1.0));
  float fast = fit(vSpeed, 0.003, 0.005, 0.0, 1.0);
  fast *= fast;
  col = mix(col, uColorFast, fast);
  // partikel cepat sedikit transparan (motion blur murah)
  float a = 1.0 - fast * 0.5;
  // uShow 0 = netral untuk blending ini (warna 1, alpha 0 -> dst tidak berubah)
  col = mix(vec3(1.0), col, uShow);
  gl_FragColor = vec4(col, a * uShow);
}
`

const _right = new Vector3()
const _up = new Vector3()

export class VolumeParticles {
  /**
   * @param {import('three').WebGLRenderer} renderer
   * @param {object} globals uniform global engine
   * @param {{ count:number, curl4D:boolean, fluid:boolean }} quality
   */
  constructor(renderer, globals, quality) {
    this.renderer = renderer
    this.quality = quality
    this.count = quality.count
    const size = (this.size = simSize(this.count))
    // Float penuh kalau bisa dirender, kalau tidak HalfFloat (presisi posisi tetap cukup di rentang +-0.35)
    this.type = simTargetType(renderer) ?? HalfFloatType

    // posisi awal acak di kubus 0.65 (deterministik), w = acak per partikel
    const orig = new Float32Array(size * size * 4)
    let seed = 1234567
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let i = 0; i < size * size; i++) {
      orig[i * 4] = (rnd() - 0.5) * PARTICLES.cube
      orig[i * 4 + 1] = (rnd() - 0.5) * PARTICLES.cube
      orig[i * 4 + 2] = (rnd() - 0.5) * PARTICLES.cube
      orig[i * 4 + 3] = rnd()
    }
    this.orig = new DataTexture(orig, size, size, RGBAFormat, FloatType)
    this.orig.minFilter = this.orig.magFilter = NearestFilter
    this.orig.generateMipmaps = false
    this.orig.needsUpdate = true

    const rtOpts = {
      count: 2, // MRT (r163+): textures[0] = posisi + bayangan, textures[1] = kecepatan + laju
      type: this.type,
      format: RGBAFormat,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      wrapS: ClampToEdgeWrapping,
      wrapT: ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
    }
    this.read = new WebGLRenderTarget(size, size, rtOpts)
    this.write = new WebGLRenderTarget(size, size, rtOpts)

    const defines = quality.curl4D ? { CURL_4D: '' } : {}
    this.initMat = new RawShaderMaterial({
      glslVersion: GLSL3, vertexShader: SIM_VERT, fragmentShader: INIT_FRAG,
      uniforms: { tOrig: { value: this.orig } }, depthTest: false, depthWrite: false,
    })
    this.simMat = new RawShaderMaterial({
      glslVersion: GLSL3,
      defines,
      vertexShader: SIM_VERT,
      fragmentShader: SIM_FRAG,
      uniforms: {
        tOrig: { value: this.orig },
        tPos: { value: null },
        tVel: { value: null },
        tFluid: { value: null },
        tVolume: { value: null },
        uVolumeScale: { value: 1.2 },
        uRotation: { value: 1.5 * Math.PI },
        uRatio: { value: 1 },
        uTime: { value: 0 },
        uInteract: { value: 0 },
        uAdditionalNoise: { value: 0 },
        uShowNoise: { value: 0 },
        uFluidOn: { value: 0 },
        // [?] Satuan kecepatan fluid igloo tidak tercatat. Fluid kita fisik (tinggi layar per detik, sapuan cepat
        // sekitar 1), dengan angka asli 0.0005 dorongannya nyaris tak terlihat. Gain 8 dikalibrasi ke ref 16.
        uFluidGain: { value: 8 },
        uAssign: { value: 0 },
        uSpinTargets: { value: PARTICLES.spinTargets ? 1 : 0 },
        uMVP: { value: new Matrix4() },
        uCamRight: { value: new Vector3(1, 0, 0) },
        uCamUp: { value: new Vector3(0, 1, 0) },
        uLightPos: { value: PARTICLES.light.clone() },
        uCube: { value: PARTICLES.cube },
        uRadius: { value: PARTICLES.radius },
        uYRange: { value: [PARTICLES.yMin, PARTICLES.yMax] },
        uCorners4: { value: 16 },
        uCorners3: { value: 8 },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.quad = new FullScreenQuad(this.initMat)
    this.uniforms = this.simMat.uniforms
    // titik tujuan saat ganti link (bisa ditimpa script verifikasi lewat entry.particles.assign)
    this.assign = { amount: PARTICLES.assign, duration: PARTICLES.assignDuration }
    this.simTime = 0
    this.stats = { presimMs: 0, presimCompileMs: 0, steps: 0 }

    // ---- mesh render: satu titik per partikel, position.xy = koordinat texel ----
    const ref = new Float32Array(this.count * 3)
    for (let i = 0; i < this.count; i++) {
      ref[i * 3] = i % size
      ref[i * 3 + 1] = Math.floor(i / size)
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(ref, 3))
    // cahaya render = cahaya sim diputar 180 derajat di Y (data asli)
    this.lightRender = new Vector3(-PARTICLES.light.x, PARTICLES.light.y, -PARTICLES.light.z).normalize()
    this.material = new ShaderMaterial({
      uniforms: {
        ...globals,
        tPos: { value: this.read.textures[0] },
        tVel: { value: this.read.textures[1] },
        uSize: { value: PARTICLES.size * PARTICLES.sizeTune },
        uVisible: { value: 0 },
        uShow: { value: 0 },
        uLightView: { value: new Vector3(0, 1, 0) },
        uColorDark: { value: new Color('#222b42') },
        uColorLight: { value: new Color('#bdc6d4') },
        uColorFast: { value: new Color('#d7ebfa') },
      },
      vertexShader: RENDER_VERT,
      fragmentShader: RENDER_FRAG,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: SrcAlphaFactor,
      blendDst: SrcColorFactor,
      depthTest: true,
      depthWrite: true,
      // daftar transparan supaya digambar SESUDAH lantai (renderOrder 2): blending ini membaca warna di belakang
      transparent: true,
    })
    this.points = new Points(geo, this.material)
    this.points.name = 'volumeparticles'
    this.points.frustumCulled = false
    this.points.renderOrder = 3
    const lightView = this.material.uniforms.uLightView.value
    const lightRender = this.lightRender
    // arah cahaya ke ruang view kamera yang sedang merender (bola palsu dinormalkan di ruang view)
    this.points.onBeforeRender = (_r, _s, camera) => {
      lightView.copy(lightRender).transformDirection(camera.matrixWorldInverse)
    }
  }

  setVolume(texture, scale) {
    this.uniforms.tVolume.value = texture
    this.uniforms.uVolumeScale.value = scale
  }

  _run(material) {
    const r = this.renderer
    this.quad.material = material
    r.setRenderTarget(this.write)
    this.quad.render(r)
    const t = this.read
    this.read = this.write
    this.write = t
  }

  _publish() {
    this.uniforms.tPos.value = this.read.textures[0]
    this.uniforms.tVel.value = this.read.textures[1]
    this.material.uniforms.tPos.value = this.read.textures[0]
    this.material.uniforms.tVel.value = this.read.textures[1]
  }

  /** Satu langkah sim. ratio = waktu langkah / 16.67 ms. */
  step(ratio) {
    const u = this.uniforms
    u.tPos.value = this.read.textures[0]
    u.tVel.value = this.read.textures[1]
    u.uRatio.value = ratio
    this.simTime += ratio / 60
    u.uTime.value = this.simTime
    this._run(this.simMat)
    this._publish()
    this.stats.steps++
  }

  /** Paksa GPU selesai (baca 1 piksel), dipakai mengukur waktu pre-sim. */
  _sync() {
    const buf = this.type === FloatType ? new Float32Array(4) : new Uint16Array(4)
    this.renderer.readRenderTargetPixels(this.read, 0, 0, 1, 1, buf)
  }

  /**
   * Isi posisi awal lalu simulasikan PARTICLES.presimFrames frame sekaligus (langkah besar presimRatio), supaya saat
   * ruang pertama terlihat bentuknya sudah jadi (igloo: compute jalan 1000 ms sebelum uVisible = 1).
   */
  presim(frames = PARTICLES.presimFrames, ratio = PARTICLES.presimRatio) {
    const steps = Math.ceil(frames / ratio)
    const r = this.renderer
    const prev = r.getRenderTarget()
    const t0 = performance.now()
    this._run(this.initMat)
    this._publish()
    this.step(ratio) // langkah pertama memicu kompilasi shader sim (draw pertama ANGLE)
    this._sync()
    const t1 = performance.now()
    for (let i = 1; i < steps; i++) this.step(ratio)
    this._sync()
    const t2 = performance.now()
    r.setRenderTarget(prev)
    this.stats.presimCompileMs = t1 - t0
    this.stats.presimMs = t2 - t0
    this.stats.presimStepsMs = (t2 - t1) / Math.max(1, steps - 1)
    this.material.uniforms.uVisible.value = 1
  }

  /**
   * Satu langkah sim dari scene (scene yang mengatur throttle minimal PARTICLES.minStepMs per langkah).
   * @param {object} o
   * @param {number} o.dt detik sejak langkah sebelumnya
   * @param {import('three').Camera} o.camera
   * @param {import('three').Object3D} o.object grup induk partikel (matrixWorld)
   */
  update({ dt, camera, object }) {
    const u = this.uniforms
    u.uRotation.value -= dt * PARTICLES.rotationSpeed
    // matriks proyeksi partikel -> layar dan sumbu kamera (dorongan fluida searah layar)
    camera.updateMatrixWorld()
    u.uMVP.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(object.matrixWorld)
    _right.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
    _up.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
    u.uCamRight.value.copy(_right)
    u.uCamUp.value.copy(_up)
    const r = this.renderer
    const prev = r.getRenderTarget()
    this.step(Math.min(dt * 60, 3))
    r.setRenderTarget(prev)
  }

  /** Mesh untuk precompile shader sim lewat renderer.compileAsync (paralel, tidak memblok presim). */
  compileTargets() {
    return [this.initMat, this.simMat]
  }

  dispose() {
    this.read.dispose()
    this.write.dispose()
    this.orig.dispose()
    this.initMat.dispose()
    this.simMat.dispose()
    this.material.dispose()
    this.points.geometry.dispose()
    this.quad.dispose()
  }
}

