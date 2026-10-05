import { Data3DTexture, RGBAFormat, HalfFloatType, LinearFilter, ClampToEdgeWrapping, DataUtils, ShaderMaterial } from 'three'
import '../glsl/chunks.js'
import { FULLSCREEN_VERT } from '../glsl/chunks.js'

/**
 * LUT 3D buatan sendiri (bukan LUT igloo). Dibangkitkan dari parameter grade di ruang sRGB:
 * desaturasi, kontras S di sekitar pivot, lift/gain, tint. Nanti bisa diganti file .cube dari DaVinci.
 * Layout Data3DTexture: x = r (paling cepat), y = g, z = b.
 */
export function makeLutTexture({
  size = 32,
  saturation = 0.85,
  contrast = 1,
  pivot = 0.5,
  blackPoint = 0, // nilai input yang jadi hitam (menghancurkan bayangan/mid, ala grade igloo)
  gamma = 1, // > 1 menggelapkan mid tanpa memotong highlight
  shoulder = 1, // mulai titik ini kurva dibaurkan kembali ke identitas (langit tetap terang)
  lift = 0,
  gain = 1,
  tint = [0, 0, 0],
} = {}) {
  const data = new Uint16Array(size * size * size * 4)
  const clamp01 = (v) => Math.min(1, Math.max(0, v))
  let i = 0
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        let c = [r / (size - 1), g / (size - 1), b / (size - 1)]
        const L = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
        c = c.map((v, k) => {
          let x = L + (v - L) * saturation
          x = pivot + (x - pivot) * contrast
          const xin = clamp01(x)
          x = Math.pow(clamp01((x - blackPoint) / (1 - blackPoint)), gamma)
          if (shoulder < 1) {
            const s = clamp01((xin - shoulder) / (1 - shoulder))
            x += (xin - x) * s * s * (3 - 2 * s)
          }
          x = lift + x * (gain - lift) + tint[k]
          return clamp01(x)
        })
        data[i++] = DataUtils.toHalfFloat(c[0])
        data[i++] = DataUtils.toHalfFloat(c[1])
        data[i++] = DataUtils.toHalfFloat(c[2])
        data[i++] = DataUtils.toHalfFloat(1)
      }
    }
  }
  const tex = new Data3DTexture(data, size, size, size)
  tex.format = RGBAFormat
  tex.type = HalfFloatType
  tex.minFilter = LinearFilter
  tex.magFilter = LinearFilter
  tex.wrapS = tex.wrapT = tex.wrapR = ClampToEdgeWrapping
  tex.unpackAlignment = 1
  tex.needsUpdate = true
  return tex
}

/** Pass grade per scene: LUT 3D (trilinear dulu, tetrahedral di M2) + gelap diagonal pojok kiri bawah. */
export class LutMaterial extends ShaderMaterial {
  constructor(lut, { intensity = 1, gradientAlpha = 1 } = {}) {
    super({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */ `
        #include <igloo_colorspace>
        uniform sampler2D tDiffuse;
        uniform highp sampler3D tLUT;
        uniform float uLutSize;
        uniform float uIntensity;
        uniform float uGradientAlpha;
        varying vec2 vUv;
        void main() {
          vec3 lin = texture2D(tDiffuse, vUv).rgb;
          vec3 s = linearToSrgb(clamp(lin, 0.0, 1.0));
          vec3 uvw = (s * (uLutSize - 1.0) + 0.5) / uLutSize;
          vec3 graded = mix(s, texture(tLUT, uvw).rgb, uIntensity);
          vec3 outc = srgbToLinear(graded);
          // satu-satunya "vignette" igloo: pojok kiri bawah sedikit lebih gelap
          outc *= mix(1.0, mix(0.8, 1.0, (vUv.x + vUv.y) * 0.5), uGradientAlpha);
          gl_FragColor = vec4(outc, 1.0);
        }
      `,
      uniforms: {
        tDiffuse: { value: null },
        tLUT: { value: lut },
        uLutSize: { value: lut.image.width },
        uIntensity: { value: intensity },
        uGradientAlpha: { value: gradientAlpha },
      },
      depthTest: false,
      depthWrite: false,
    })
  }
}
