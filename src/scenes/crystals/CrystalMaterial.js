import { MeshPhysicalMaterial, Color, Vector2, DataTexture, RGBAFormat, UnsignedByteType, LinearFilter, ClampToEdgeWrapping, NoColorSpace } from 'three'

// Material es (blueprint 5.3, skill ref 02 bagian 6.1). MeshPhysicalMaterial dengan transmission = 0
// (jadi three TIDAK menjalankan transmission pass bawaannya), lalu chunk transmisi diganti lewat
// onBeforeCompile dengan refraksi sendiri: 3 sampel x 3 IOR per kanal (pelangi), tebal dan arah normal
// di-jitter blue noise, roughness memilih level mip RT (buram frosty). Sumber RT diatur CrystalsScene:
// pass A = tekstur datar 4x4, pass B = _transmissionRT hasil pass A.
// M5b: mouse frost (skill ref 02 bagian 6.3) dibaca dari tMouseFrost di ruang uv1:
//   frost (r) menurunkan roughness dan kekuatan normal map (jendela jernih),
//   rim (g, tepi yang sedang tumbuh) menyala uColorFrost + pola segitiga.

/** Tekstur 4x4 warna datar untuk pass A. Ukuran sampler 4 -> lod maksimal kecil, nyaris tanpa blur. */
export function makeFlatTexture(hex = '#A6ABB7') {
  const tex = new DataTexture(new Uint8Array(4 * 4 * 4), 4, 4, RGBAFormat, UnsignedByteType)
  tex.colorSpace = NoColorSpace // byte sudah linear
  tex.minFilter = tex.magFilter = LinearFilter
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping
  setFlatColor(tex, hex)
  return tex
}

/** Ganti warna tekstur datar (dipakai tuning live). */
export function setFlatColor(tex, hex) {
  const c = new Color(hex) // ColorManagement: hex sRGB -> linear
  const data = tex.image.data
  for (let i = 0; i < 16; i++) {
    data[i * 4] = Math.round(c.r * 255)
    data[i * 4 + 1] = Math.round(c.g * 255)
    data[i * 4 + 2] = Math.round(c.b * 255)
    data[i * 4 + 3] = 255
  }
  tex.needsUpdate = true
}

/** Tekstur frost kosong 1x1 (dipakai sebelum sim pertama jalan). */
let emptyFrost = null
export function emptyFrostTexture() {
  if (!emptyFrost) {
    emptyFrost = new DataTexture(new Uint8Array(4), 1, 1, RGBAFormat, UnsignedByteType)
    emptyFrost.needsUpdate = true
  }
  return emptyFrost
}

/**
 * Uniform refraksi bersama untuk semua kristal (satu objek {value}, ditukar per pass oleh scene).
 * uIceTint, uIceMilk, uIceJitter, uIceLodBias = tuning tampilan M5b (pucat seperti susu, grain lebih halus).
 */
export function makeIceUniforms({ flat, blueNoise, triangles, resolution }) {
  return {
    tTransmission: { value: flat },
    uTransmissionSize: { value: new Vector2(4, 4) },
    uThickness: { value: 2 },
    uChromaticAberration: { value: 0.1 },
    tBlue: { value: blueNoise },
    uBlueOffset: { value: new Vector2() },
    uIceTint: { value: new Color(1, 1, 1) },
    uIceMilkColor: { value: new Color('#e0e8ef') },
    uIceMilk: { value: 0 },
    uIceJitter: { value: 1 },
    uIceLodBias: { value: 0 },
    tTriangles: { value: triangles },
    uColorFrost: { value: new Color('#83a1c5') },
    uFrostTri: { value: 0.5 },
    uFrostRim: { value: new Vector2(0.05, 0.2) }, // ambang rim (lo, hi): rim lemah di dalam blob tidak ikut menyala
    uFrostTriScale: { value: 9 },
    uResolution: resolution,
  }
}

const ICE_PARS = /* glsl */ `
uniform sampler2D tTransmission;
uniform vec2 uTransmissionSize;
uniform float uThickness;
uniform float uChromaticAberration;
uniform sampler2D tBlue;
uniform vec2 uBlueOffset;
uniform vec3 uIceTint;
uniform vec3 uIceMilkColor;
uniform float uIceMilk;
uniform float uIceJitter;
uniform float uIceLodBias;
uniform sampler2D tMouseFrost;
uniform sampler2D tTriangles;
uniform vec3 uColorFrost;
uniform float uFrostTri;
uniform vec2 uFrostRim;
uniform float uFrostTriScale;
uniform vec2 uResolution;
uniform mat4 modelMatrix;
uniform mat4 projectionMatrix;
varying vec3 vIceWorld;
varying vec2 vFrostUv;

// sinar dibiaskan masuk es, dijalankan sejauh tebal (ruang lokal x skala model), titik keluar
// diproyeksikan ke layar = koordinat sampel RT
vec2 iceProject(vec3 n, vec3 v, float thickness, float ior) {
  vec3 ray = normalize(refract(-v, n, 1.0 / ior));
  vec3 modelScale = vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));
  vec3 exitPos = vIceWorld + ray * thickness * modelScale;
  vec4 ndc = projectionMatrix * viewMatrix * vec4(exitPos, 1.0);
  return ndc.xy / ndc.w * 0.5 + 0.5;
}
`

// frost dibaca sekali di awal main, sebelum roughness dan normal map
const FROST_READ = /* glsl */ `
  vec2 iceFrostRG = texture2D(tMouseFrost, vFrostUv).rg;
  float iceFrost = clamp(iceFrostRG.r, 0.0, 1.0);
  float iceRim = clamp(iceFrostRG.g, 0.0, 1.0);
  iceRim *= smoothstep(uFrostRim.x, uFrostRim.y + 1e-4, iceRim);
#include <roughnessmap_fragment>
  roughnessFactor *= 1.0 - iceFrost;
`

// salinan normal_fragment_maps (tangent space) dengan normalScale dikali (1 - frost)
const FROST_NORMAL = /* glsl */ `
#if defined( USE_NORMALMAP_TANGENTSPACE )
  vec3 mapN = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
  mapN.xy *= normalScale * (1.0 - iceFrost);
  normal = normalize(tbn * mapN);
#else
#include <normal_fragment_maps>
#endif
`

// rim menyala + kisi segitiga di tepi yang tumbuh, segitiga samar di dalam jendela frost
const FROST_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
  {
    float triScale = uFrostTriScale * min(1.0, uResolution.y / 1300.0);
    float iceTri = texture2D(tTriangles, vNormalMapUv * triScale).r;
    totalEmissiveRadiance += iceRim * uColorFrost + iceTri * iceRim * 10.0 * uFrostTri
      + iceTri * iceFrost * iceFrost * uFrostTri * uColorFrost;
  }
`

const ICE_FRAGMENT = /* glsl */ `
{
  vec3 iceV = normalize(cameraPosition - vIceWorld);
  vec3 iceN = inverseTransformDirection(normal, viewMatrix);
  vec2 iceUv = gl_FragCoord.xy / 128.0 + uBlueOffset;
  vec3 iceBn = texture2D(tBlue, iceUv).rgb;
  vec3 iceBn2 = texture2D(tBlue, iceUv + vec2(0.371, 0.613)).rgb;
  float iceRough = material.roughness;
  // normal di-jitter roughness^2 * 2 * blue noise (frosty) + frost * 0.025
  iceN = normalize(iceN + uIceJitter * iceRough * iceRough * 2.0 * normalize(iceBn2 * 2.0 - 1.0) + iceFrost * 0.025);
  float iceLod = log2(uTransmissionSize.x) * iceRough * clamp(2.0 * material.ior - 2.0, 0.0, 1.0) + uIceLodBias * iceRough;
  vec3 iceAcc = vec3(0.0);
  for (int i = 0; i < ICE_SAMPLES; i++) {
    float fi = float(i);
    float kt = (fi + iceBn.g) / float(ICE_SAMPLES);
    float kg = (fi + iceBn.r) / float(ICE_SAMPLES);
    float kb = (fi + iceBn.b) / float(ICE_SAMPLES);
    float th = uThickness + 2.0 * pow(iceRough, 0.33) * kt;
    iceAcc.r += textureLod(tTransmission, iceProject(iceN, iceV, th, material.ior), iceLod).r;
    iceAcc.g += textureLod(tTransmission, iceProject(iceN, iceV, th, material.ior * (1.0 + uChromaticAberration * kg)), iceLod).g;
    iceAcc.b += textureLod(tTransmission, iceProject(iceN, iceV, th, material.ior * (1.0 + 2.0 * uChromaticAberration * kb)), iceLod).b;
  }
  vec3 iceTransmitted = clamp(iceAcc / float(ICE_SAMPLES), 0.0, 1.0);
  // es buram menghamburkan cahaya: makin kasar makin condong ke warna susu (frost = jendela jernih)
  iceTransmitted = mix(iceTransmitted, uIceMilkColor, uIceMilk * smoothstep(0.05, 0.45, iceRough));
  // atenuasi dimatikan (= 1). Diffuse diganti penuh oleh cahaya terbias, spekular env tetap di atasnya.
  vec3 iceF = EnvironmentBRDF(iceN, iceV, material.specularColor, material.specularF90, material.roughness);
  totalDiffuse = (1.0 - iceF) * uIceTint * iceTransmitted;
}
`

export class CrystalMaterial extends MeshPhysicalMaterial {
  constructor({ normalMap, roughnessMap, envMap, ice, frost, samples = 3 }) {
    super({
      color: new Color('#e0e8ef'),
      metalness: 0,
      roughness: 0.65, // dikali roughnessMap.g oleh three
      roughnessMap,
      normalMap,
      // UV glTF (flipY false) + tangent turunan layar: kanal hijau dibalik, sama seperti GLTFLoader
      normalScale: new Vector2(1, -1),
      envMap,
      envMapIntensity: 0.91,
      transmission: 0,
    })
    // setter reflectivity mengubah ior, jadi ior 1.18 di-set sesudahnya (ior yang dipakai refraksi)
    this.reflectivity = 0.3
    this.ior = 1.18
    this.envMapRotation.set(0, Math.PI, 0)
    this.ice = ice
    // uniform per kristal: tekstur hasil sim frost kristal ini
    this.frost = { tMouseFrost: { value: frost || emptyFrostTexture() } }
    this.samples = samples
    this.defines = { ...this.defines, ICE_SAMPLES: samples }
  }

  onBeforeCompile(shader) {
    Object.assign(shader.uniforms, this.ice, this.frost)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vIceWorld;\nvarying vec2 vFrostUv;\n#ifndef USE_UV1\nattribute vec2 uv1;\n#endif')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n  vIceWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n  vFrostUv = uv1;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <transmission_pars_fragment>', ICE_PARS)
      .replace('#include <roughnessmap_fragment>', FROST_READ)
      .replace('#include <normal_fragment_maps>', FROST_NORMAL)
      .replace('#include <emissivemap_fragment>', FROST_EMISSIVE)
      .replace('#include <transmission_fragment>', ICE_FRAGMENT)
  }

  customProgramCacheKey() {
    return `ice-refraction-frost-${this.samples}`
  }
}
