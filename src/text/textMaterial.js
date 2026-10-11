import { ShaderMaterial, DataTexture, RGBAFormat, FloatType, NearestFilter, Color } from 'three'
import '../glsl/chunks.js'

// Material teks MSDF dengan reveal + scramble per huruf (blueprint 5.6, forensik shader 9.1).
//   tampil   = falloff(indeksGlyph01, margin 0.1, uShow1)  -> wipe alpha tajam kiri ke kanan
//   mendarat = falloff(indeksGlyph01, margin 1.0, uShow2)  -> wipe sangat lembut
//   scramble: selama belum mendarat, k = floor((1 - mendarat) * 5.753) > 0, glyph diganti glyph lain.
// igloo menggeser uv atlas 1/8 karena atlasnya grid 8 kolom. Atlas kita di-pack rapat (maxrects),
// jadi geser uv akan memotong glyph. Gantinya: tabel semua glyph (plane bounds + rect uv) di DataTexture,
// vertex shader memilih glyph pengganti dari tabel lalu membentuk ulang quad-nya.

const tables = new WeakMap()

/** DataTexture 2 x N: texel 0 = plane bounds em (kiri, bawah, kanan, atas), texel 1 = rect uv atlas. */
export function glyphTableTexture(font) {
  let tex = tables.get(font)
  if (tex) return tex
  const n = font.table.length
  const data = new Float32Array(2 * n * 4)
  font.table.forEach((g, i) => {
    data.set([g.left, g.bottom, g.right, g.top, g.u0, g.v0, g.u1, g.v1], i * 8)
  })
  tex = new DataTexture(data, 2, n, RGBAFormat, FloatType)
  tex.minFilter = tex.magFilter = NearestFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  tables.set(font, tex)
  return tex
}

const vertexShader = /* glsl */ `
#include <igloo_common>
attribute vec4 aUvRect; // rect uv glyph yang benar
attribute vec4 aText;   // x indeks glyph 0..1, y indeks kata 0..1, z indeks baris, w seed
attribute vec4 aPen;    // xy pen (baseline), z indeks tabel glyph, w size
uniform sampler2D tGlyphs;
uniform float uGlyphCount;
uniform float uShow1;
uniform float uShow2;
uniform float uScramble;
varying vec2 vUv;
varying float vShow;

void main() {
  float show = falloff(aText.x, 0.0, 1.0, 0.1, uShow1);
  float settle = falloff(aText.x, 0.0, 1.0, 1.0, uShow2);
  vec3 pos = position;
  vec2 uvGlyph = mix(aUvRect.xy, aUvRect.zw, uv);

  // k turun 5 -> 0 seiring glyph mendarat. k = 0 berarti glyph asli.
  float k = floor((1.0 - settle) * 5.753) * uScramble;
  if (k > 0.5) {
    float idx = mod(aPen.z + floor(aText.w * uGlyphCount) + k, uGlyphCount);
    vec4 plane = texelFetch(tGlyphs, ivec2(0, int(idx)), 0);
    vec4 rect = texelFetch(tGlyphs, ivec2(1, int(idx)), 0);
    pos.xy = aPen.xy + mix(plane.xy, plane.zw, uv) * aPen.w;
    uvGlyph = mix(rect.xy, rect.zw, uv);
  }

  vUv = uvGlyph;
  vShow = show;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  // glyph yang belum tampil dilipat keluar layar, hemat fill
  if (show <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`

const fragmentShader = /* glsl */ `
uniform sampler2D tMap;
uniform float uPxRange;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uBlink;
uniform float uBold;
varying vec2 vUv;
varying float vShow;

float median(float r, float g, float b) {
  return max(min(r, g), min(max(r, g), b));
}
// gelombang kotak 0/1, dipakai kedip
float square(float x) {
  return step(0.5, fract(x));
}

void main() {
  vec3 msd = texture2D(tMap, vUv).rgb;
  // uBold menebalkan huruf dengan menggeser ambang jarak (0.5 = 2 px atlas pada range 4)
  float sd = median(msd.r, msd.g, msd.b) - 0.5 + uBold;
  // Lebar AA dari fwidth uv: tajam di DPR berapa pun (resep msdfgen, screenPxRange)
  vec2 unitRange = vec2(uPxRange) / vec2(textureSize(tMap, 0));
  vec2 screenTexSize = vec2(1.0) / fwidth(vUv);
  float screenPxRange = max(0.5 * dot(unitRange, screenTexSize), 1.0);
  float alpha = clamp(sd * screenPxRange + 0.5, 0.0, 1.0);

  alpha *= vShow * uOpacity;
  if (uBlink < 1.0) alpha *= 0.6 + 0.4 * square(uBlink * 5.0);
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(uColor, alpha);
}
`

/**
 * @param {import('./MsdfFont.js').MsdfFont} font
 * @param {object} [o]
 * @param {number|string} [o.color=0xffffff] hex sRGB, dikonversi ke linear oleh ColorManagement
 * @param {number} [o.opacity=1]
 * @param {number} [o.bold=0] penebalan, 0.15 kira-kira Medium ke Bold
 * @param {boolean} [o.scramble=true]
 */
export function createTextMaterial(font, { color = 0xffffff, opacity = 1, bold = 0, scramble = true } = {}) {
  return new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      tMap: { value: font.texture },
      tGlyphs: { value: glyphTableTexture(font) },
      uGlyphCount: { value: font.table.length },
      uPxRange: { value: font.distanceRange },
      uShow1: { value: 1 },
      uShow2: { value: 1 },
      uBlink: { value: 1 },
      uScramble: { value: scramble ? 1 : 0 },
      uColor: { value: new Color(color) },
      uOpacity: { value: opacity },
      uBold: { value: bold },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
}
