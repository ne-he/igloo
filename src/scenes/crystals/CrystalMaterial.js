import { MeshPhysicalMaterial, Color, Vector2, DataTexture, RGBAFormat, UnsignedByteType, LinearFilter, ClampToEdgeWrapping, NoColorSpace } from 'three'

// Material es (blueprint 5.3, skill ref 02 bagian 6.1). MeshPhysicalMaterial dengan transmission = 0
// (jadi three TIDAK menjalankan transmission pass bawaannya), lalu chunk transmisi diganti lewat
// onBeforeCompile dengan refraksi sendiri: 3 sampel x 3 IOR per kanal (pelangi), tebal dan arah normal
// di-jitter blue noise, roughness memilih level mip RT (buram frosty). Sumber RT diatur CrystalsScene:
// pass A = tekstur datar 4x4, pass B = _transmissionRT hasil pass A.

/** Tekstur 4x4 warna datar untuk pass A. Ukuran sampler 4 -> lod maksimal kecil, nyaris tanpa blur. */
export function makeFlatTexture(hex = '#A6ABB7') {
  const c = new Color(hex) // ColorManagement: hex sRGB -> linear
  const data = new Uint8Array(4 * 4 * 4)
  for (let i = 0; i < 16; i++) {
    data[i * 4] = Math.round(c.r * 255)
    data[i * 4 + 1] = Math.round(c.g * 255)
    data[i * 4 + 2] = Math.round(c.b * 255)
    data[i * 4 + 3] = 255
  }
  const tex = new DataTexture(data, 4, 4, RGBAFormat, UnsignedByteType)
  tex.colorSpace = NoColorSpace // byte sudah linear
  tex.minFilter = tex.magFilter = LinearFilter
  tex.wrapS = tex.wrapT = ClampToEdgeWrapping
  tex.needsUpdate = true
  return tex
}

/** Uniform refraksi bersama untuk semua kristal (satu objek {value}, ditukar per pass oleh scene). */
export function makeIceUniforms({ flat, blueNoise }) {
  return {
    tTransmission: { value: flat },
    uTransmissionSize: { value: new Vector2(4, 4) },
    uThickness: { value: 2 },
    uChromaticAberration: { value: 0.1 },
    tBlue: { value: blueNoise },
    uBlueOffset: { value: new Vector2() },
  }
}

const ICE_PARS = /* glsl */ `
uniform sampler2D tTransmission;
uniform vec2 uTransmissionSize;
uniform float uThickness;
uniform float uChromaticAberration;
uniform sampler2D tBlue;
uniform vec2 uBlueOffset;
uniform mat4 modelMatrix;
uniform mat4 projectionMatrix;
varying vec3 vIceWorld;

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

const ICE_FRAGMENT = /* glsl */ `
{
  vec3 iceV = normalize(cameraPosition - vIceWorld);
  vec3 iceN = inverseTransformDirection(normal, viewMatrix);
  vec2 iceUv = gl_FragCoord.xy / 128.0 + uBlueOffset;
  vec3 iceBn = texture2D(tBlue, iceUv).rgb;
  vec3 iceBn2 = texture2D(tBlue, iceUv + vec2(0.371, 0.613)).rgb;
  float iceRough = material.roughness;
  // normal di-jitter roughness^2 * 2 * blue noise (frosty), mouse frost M5b menambah suku di sini
  iceN = normalize(iceN + iceRough * iceRough * 2.0 * normalize(iceBn2 * 2.0 - 1.0));
  float iceLod = log2(uTransmissionSize.x) * iceRough * clamp(2.0 * material.ior - 2.0, 0.0, 1.0);
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
  // atenuasi dimatikan (= 1). Diffuse diganti penuh oleh cahaya terbias, spekular env tetap di atasnya.
  vec3 iceF = EnvironmentBRDF(iceN, iceV, material.specularColor, material.specularF90, material.roughness);
  totalDiffuse = (1.0 - iceF) * material.diffuseColor * iceTransmitted;
}
`

export class CrystalMaterial extends MeshPhysicalMaterial {
  constructor({ normalMap, roughnessMap, envMap, ice, samples = 3 }) {
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
    this.samples = samples
    this.defines = { ...this.defines, ICE_SAMPLES: samples }
  }

  onBeforeCompile(shader) {
    Object.assign(shader.uniforms, this.ice)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vIceWorld;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n  vIceWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <transmission_pars_fragment>', ICE_PARS)
      .replace('#include <transmission_fragment>', ICE_FRAGMENT)
  }

  customProgramCacheKey() {
    return `ice-refraction-${this.samples}`
  }
}
