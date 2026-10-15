import { ShaderMaterial, Vector2, Vector3 } from 'three'
import '../../glsl/chunks.js'
import { FULLSCREEN_VERT } from '../../glsl/chunks.js'

/**
 * Pass grade scene entry (skill ref 02 bagian 7.8), dipasang lewat composer.addPass seperti LUT scene lain.
 * - Saat uRingProximity > 0 (kilat di detik timeline 2.0 / 2.95 / 3.8): sudut polar di sekitar tengah layar
 *   di-jitter blue noise (blur rotasi berisik), blok bergeser dari kanal G mask transisi, lalu saturasi +0.05
 *   dan value +0.075 di HSV (piksel putih murni dilewati).
 * - Eksposur linear scene (tambahan kita, bukan data asli): menyamakan luminans median ke ref 12 sampai 14.
 * - Selalu: glare pojok kanan atas (uv.x * uv.y)^2 x sine noise x blue noise (dither, tidak pernah banding).
 */
export class EntryPostMaterial extends ShaderMaterial {
  constructor(globals, { blueNoise, mask }) {
    super({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tBlue;
        uniform sampler2D tMask;
        uniform float uRingProximity;
        uniform vec2 uBlueOffset;
        uniform vec3 uSquare; // xy = offset acak blok, z = kekuatan blok
        uniform float uGlare;
        uniform float uExposure;
        uniform float uTime;
        uniform float uAspect;
        varying vec2 vUv;

        vec3 rgb2hsv(vec3 c) {
          vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
          vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
          vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
          float d = q.x - min(q.w, q.y);
          float e = 1.0e-10;
          return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
        }
        vec3 hsv2rgb(vec3 c) {
          vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
          return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
        }

        void main() {
          vec3 blue = texture2D(tBlue, gl_FragCoord.xy / 128.0 + uBlueOffset).rgb;
          vec2 uv = vUv;
          float prox = uRingProximity;
          if (prox > 0.0) {
            // koordinat polar di sekitar tengah (dikoreksi aspek), sudut diacak blue noise
            vec2 c = (uv - 0.5) * vec2(uAspect, 1.0);
            float r = length(c);
            float a = atan(c.y, c.x) + 0.3 * (blue.r - 0.5) * prox;
            uv = vec2(cos(a), sin(a)) * r / vec2(uAspect, 1.0) + 0.5;
            // blok: kanal G mask (persegi di berbagai tingkat abu) jadi offset per blok
            float g = texture2D(tMask, vUv * 1.5 + uSquare.xy).g;
            uv += (vec2(g, fract(g * 7.13)) - 0.5) * 0.01 * uSquare.z * prox * step(0.35, g);
          }
          // eksposur scene (linear): dunia entry sangat terang, bloom global ambang 0.2 menaikkan semuanya lagi
          vec3 col = texture2D(tDiffuse, uv).rgb * uExposure;
          if (prox > 0.0 && min(col.r, min(col.g, col.b)) < 0.999) {
            vec3 hsv = rgb2hsv(max(col, 0.0));
            hsv.y = clamp(hsv.y + 0.05 * prox, 0.0, 1.0);
            hsv.z += 0.075 * prox;
            col = hsv2rgb(hsv);
          }
          // glare pojok kanan atas
          float sn = sin(uTime * 0.7) * 0.5 + sin(uTime * 1.13 + 1.7) * 0.3 + sin(uTime * 2.31 + 0.4) * 0.2;
          float glare = pow(vUv.x * vUv.y, 2.0) * (sn * 0.4 + 0.4);
          col += glare * vec3(0.8, 0.9, 1.0) * blue.b * 2.0 * uGlare;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      uniforms: {
        tDiffuse: { value: null },
        tBlue: { value: blueNoise },
        tMask: { value: mask },
        uRingProximity: { value: 0 },
        uBlueOffset: { value: new Vector2() },
        uSquare: { value: new Vector3(0, 0, 1) },
        uGlare: { value: 0.6 },
        uExposure: { value: 0.6 },
        uTime: globals.uTime,
        uAspect: globals.uAspect,
      },
      depthTest: false,
      depthWrite: false,
    })
  }
}
