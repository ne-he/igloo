import { Mesh, PlaneGeometry, ShaderMaterial, Color, Vector2 } from 'three'

// Bagian pendukung label kristal (keterbacaan + ajakan klik, Okt 2026). Semua menghadap kamera dan
// hidup di scene kristal, jadi ikut grade, bloom, dan transisi seperti label MSDF-nya.
//   LabelPlate : pelat lembut bersudut bulat di belakang blok teks (cara yang sama dengan FactLabel UI,
//                tapi dalam satuan dunia). Warna tinta UI 0x1e1e2c, latar kristal pucat jadi teks putih terbaca.
//   RippleRing : cincin cahaya tipis yang menjalar keluar dari kristal sekali (ajakan saat pengunjung diam).
//                depthTest aktif: bagian cincin di balik kristal tertutup kristal, jadi terlihat keluar dari es.

export const INK = 0x1e1e2c

const plateGeo = new PlaneGeometry(1, 1)

const plateVertex = /* glsl */ `
uniform vec2 uFull;
varying vec2 vP;
void main() {
  vP = position.xy * uFull;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const plateFragment = /* glsl */ `
uniform vec2 uHalf;
uniform float uSoft;
uniform float uRadius;
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vP;
void main() {
  // jarak bertanda ke kotak bersudut bulat (satuan dunia), lalu tepi lembut ke luar
  vec2 q = abs(vP) - uHalf + uRadius;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
  float a = uAlpha * (1.0 - smoothstep(-0.35 * uSoft, uSoft, d));
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor, a);
}
`

export class LabelPlate extends Mesh {
  constructor(color = INK) {
    super(plateGeo, new ShaderMaterial({
      uniforms: {
        uFull: { value: new Vector2(1, 1) },
        uHalf: { value: new Vector2() },
        uSoft: { value: 0.01 },
        uRadius: { value: 0.01 },
        uAlpha: { value: 0 },
        uColor: { value: new Color(color) },
      },
      vertexShader: plateVertex,
      fragmentShader: plateFragment,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }))
    this.frustumCulled = false
  }

  /**
   * Pasang pelat. center = titik tengah dunia, w/h/soft/radius satuan dunia, quaternion = menghadap kamera.
   * alpha 0 = pelat disembunyikan.
   */
  set(center, quaternion, w, h, soft, radius, alpha) {
    const u = this.material.uniforms
    this.visible = alpha > 0.002 && w > 1e-5
    if (!this.visible) return
    u.uHalf.value.set(w / 2, h / 2)
    u.uFull.value.set(w + 2 * soft, h + 2 * soft)
    u.uSoft.value = soft
    u.uRadius.value = Math.min(radius, w / 2, h / 2)
    u.uAlpha.value = alpha
    this.position.copy(center)
    this.quaternion.copy(quaternion)
    this.scale.set(w + 2 * soft, h + 2 * soft, 1)
  }

  dispose() {
    this.material.dispose()
  }
}

const ringFragment = /* glsl */ `
uniform float uProgress;
uniform float uStart;
uniform vec3 uColor;
uniform vec3 uInk;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  // r = 1 di tepi quad (radius akhir). Cincin melambat (cubic out), menebal, dan memudar saat menjauh.
  float r = length(vUv * 2.0 - 1.0);
  float e = 1.0 - pow(1.0 - uProgress, 3.0);
  float rad = mix(uStart, 0.94, e);
  float w = mix(0.014, 0.04, e);
  float light = exp(-pow((r - rad) / w, 2.0));
  // jejak lembut di dalam cincin, plus bayangan tinta tipis di luar supaya terbaca di latar pucat
  float trail = exp(-pow((r - rad + 2.5 * w) / (3.0 * w), 2.0)) * 0.3;
  float ink = exp(-pow((r - rad - 1.6 * w) / w, 2.0)) * 0.25;
  float env = smoothstep(0.0, 0.06, uProgress) * (1.0 - smoothstep(0.45, 1.0, uProgress)) * uAlpha;
  float aL = clamp(light + trail, 0.0, 1.0) * env;
  float aD = ink * env;
  float a = aL + aD * (1.0 - aL);
  if (a < 0.002) discard;
  gl_FragColor = vec4((uColor * aL + uInk * aD * (1.0 - aL)) / a, a);
}
`

export class RippleRing extends Mesh {
  constructor() {
    super(plateGeo, new ShaderMaterial({
      uniforms: {
        uProgress: { value: 0 },
        uStart: { value: 0.5 },
        uColor: { value: new Color(0xf4f8ff) },
        uInk: { value: new Color(INK) },
        uAlpha: { value: 0.45 },
      },
      vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
      fragmentShader: ringFragment,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    }))
    this.name = 'crystal_ripple'
    this.renderOrder = 20
    this.frustumCulled = false
    this.visible = false
  }

  /**
   * @param {import('three').Vector3} center pusat kristal (dunia)
   * @param {import('three').Quaternion} quaternion menghadap kamera
   * @param {number} r0 radius awal (dunia), kira-kira tepi siluet kristal
   * @param {number} r1 radius akhir (dunia)
   * @param {number} progress 0..1, -1 = sembunyi
   */
  set(center, quaternion, r0, r1, progress) {
    this.visible = progress >= 0 && progress < 1
    if (!this.visible) return
    const u = this.material.uniforms
    u.uProgress.value = progress
    u.uStart.value = r0 / r1
    this.position.copy(center)
    this.quaternion.copy(quaternion)
    this.scale.set(2 * r1, 2 * r1, 1)
  }

  dispose() {
    this.material.dispose()
  }
}
