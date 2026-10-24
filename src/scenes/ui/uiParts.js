import { Group, Mesh, PlaneGeometry, ShaderMaterial, Color, Vector2, LineSegments, BufferGeometry, BufferAttribute, LineBasicMaterial } from 'three'
import { MsdfText } from '../../text/MsdfText.js'

// Bagian kecil UI yang dipakai cue scroll dan indeks section. Gaya keterbacaan sama dengan label fakta igloo
// (FactLabel.js): latar igloo pucat, jadi teks dan garis putih diberi bayangan 1 px warna tinta UI (0x1e1e2c),
// dan teks cue diberi pelat lembut tinta di belakangnya.

export const INK = 0x1e1e2c
export const WHITE = 0xffffff

const plateVertex = /* glsl */ `
uniform vec2 uFull;
varying vec2 vPx;
void main() {
  vPx = position.xy * uFull;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const plateFragment = /* glsl */ `
uniform vec2 uHalf;
uniform float uSoft;
uniform float uRadius;
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vPx;
void main() {
  // jarak bertanda ke kotak bersudut bulat (px), tepi lembut ke luar
  vec2 q = abs(vPx) - uHalf + uRadius;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
  float a = uAlpha * (1.0 - smoothstep(-0.35 * uSoft, uSoft, d));
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor, a);
}
`

/** Pelat bayangan lembut (kotak bersudut bulat, tepi pudar), piksel CSS. */
export class SoftPlate extends Mesh {
  constructor(color = INK) {
    super(new PlaneGeometry(1, 1), new ShaderMaterial({
      uniforms: {
        uFull: { value: new Vector2(1, 1) },
        uHalf: { value: new Vector2() },
        uSoft: { value: 10 },
        uRadius: { value: 4 },
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

  get uniforms() {
    return this.material.uniforms
  }

  /** Kotak dalam piksel CSS y ke bawah (x0, y0) - (x1, y1), tepi lembut `soft` px di luar kotak. */
  setBox(x0, y0, x1, y1, soft, radius) {
    const w = Math.max(0, x1 - x0)
    const h = Math.max(0, y1 - y0)
    const u = this.material.uniforms
    u.uHalf.value.set(w / 2, h / 2)
    u.uFull.value.set(w + 2 * soft, h + 2 * soft)
    u.uSoft.value = soft
    u.uRadius.value = Math.min(radius, w / 2, h / 2)
    this.position.set(x0 + w / 2, -(y0 + h / 2), 0)
    this.scale.set(w + 2 * soft, h + 2 * soft, 1)
    this.visible = w > 0.5 && h > 0.5
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}

/**
 * Teks MSDF putih dengan bayangan 1 px tinta di kanan bawah. Bayangan memakai objek uniform reveal yang SAMA
 * (uShow1, uShow2, uBlink, uOpacity) dan seed yang sama, jadi scramble dan wipe-nya selalu kembar.
 */
export class InkText extends Group {
  constructor(font, { text = '', color = WHITE, shadowAlpha = 0.6, seed = 1, ...layout } = {}) {
    super()
    this.main = new MsdfText(font, { text, color, seed, ...layout })
    this.shadow = new MsdfText(font, { text, color: INK, seed, ...layout })
    const su = this.shadow.material.uniforms
    const mu = this.main.material.uniforms
    for (const k of ['uShow1', 'uShow2', 'uBlink']) su[k] = mu[k]
    this.shadowAlpha = shadowAlpha
    this.shadow.position.set(1, -1, 0)
    for (const m of [this.shadow, this.main]) {
      m.frustumCulled = false
      this.add(m)
    }
    this.setOpacity(1)
  }

  get uniforms() {
    return this.main.material.uniforms
  }

  get layout() {
    return this.main.layout
  }

  get text() {
    return this.main.text
  }

  get box() {
    return this.main.box
  }

  setRenderOrder(r) {
    this.shadow.renderOrder = r
    this.main.renderOrder = r + 1
  }

  setOpacity(a) {
    this.main.material.uniforms.uOpacity.value = a
    this.shadow.material.uniforms.uOpacity.value = a * this.shadowAlpha
  }

  setText(text, layoutOptions) {
    this.main.setText(text, layoutOptions)
    this.shadow.setText(text, layoutOptions)
    return this
  }

  relayout(layoutOptions) {
    this.main.relayout(layoutOptions)
    this.shadow.relayout(layoutOptions)
    return this
  }

  dispose() {
    this.main.dispose()
    this.shadow.dispose()
  }
}

/**
 * Garis putih + bayangan 1 px tinta dari satu geometri (seperti garis label fakta). Kapasitas tetap,
 * isi lewat begin() / seg() / end() tiap kali bentuknya berubah. Koordinat piksel CSS y ke bawah.
 */
export class InkLines extends Group {
  constructor(maxSegments, { alpha = 1, shadowAlpha = 0.55 } = {}) {
    super()
    const geo = new BufferGeometry()
    geo.setAttribute('position', new BufferAttribute(new Float32Array(maxSegments * 2 * 3), 3))
    geo.setDrawRange(0, 0)
    const mat = (color, opacity) =>
      new LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, toneMapped: false })
    this.shadow = new LineSegments(geo, mat(INK, shadowAlpha))
    this.shadow.position.set(1, -1, 0)
    this.lines = new LineSegments(geo, mat(WHITE, alpha))
    this.shadowAlpha = shadowAlpha
    for (const o of [this.shadow, this.lines]) {
      o.frustumCulled = false
      this.add(o)
    }
    this._n = 0
  }

  setRenderOrder(r) {
    this.shadow.renderOrder = r
    this.lines.renderOrder = r + 1
  }

  /** Opacity keseluruhan (garis dan bayangan ikut). */
  setOpacity(a) {
    this.lines.material.opacity = a
    this.shadow.material.opacity = a * this.shadowAlpha
    this.visible = a > 0.002 && this._n > 0
  }

  begin() {
    this._n = 0
  }

  seg(x0, y0, x1, y1) {
    const pos = this.lines.geometry.attributes.position
    if (this._n + 2 > pos.count) return
    pos.setXYZ(this._n++, x0, -y0, 0)
    pos.setXYZ(this._n++, x1, -y1, 0)
  }

  end() {
    const g = this.lines.geometry
    g.attributes.position.needsUpdate = true
    g.setDrawRange(0, this._n)
  }

  dispose() {
    this.lines.geometry.dispose()
    this.lines.material.dispose()
    this.shadow.material.dispose()
  }
}
