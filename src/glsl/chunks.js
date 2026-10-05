import { ShaderChunk } from 'three'

// Helper GLSL bersama, didaftarkan ke ShaderChunk supaya bisa dipakai lewat #include <igloo_xxx>
// di ShaderMaterial mana pun. Import file ini sekali (side effect) sebelum material dibuat.

// falloff: 1 di belakang garis depan yang bergerak, 0 di depannya, ramp selebar margin.
// Garis depan = mix(start - margin, end, progress). Tulang punggung semua wipe dan reveal.
ShaderChunk.igloo_common = /* glsl */ `
float fit(float v, float a, float b, float c, float d) {
  return c + (d - c) * clamp((v - a) / (b - a), 0.0, 1.0);
}
float falloff(float x, float start, float end, float margin, float progress) {
  float front = mix(start - margin, end, progress);
  return 1.0 - clamp((x - front) / margin, 0.0, 1.0);
}
float falloffSmooth(float x, float start, float end, float margin, float progress) {
  float front = mix(start - margin, end, progress);
  return 1.0 - smoothstep(front, front + margin, x);
}
float cubicIn(float t) { return t * t * t; }
float cubicOut(float t) { float f = t - 1.0; return f * f * f + 1.0; }
float sineIn(float t) { return 1.0 - cos(t * 1.5707963); }
`

// Uniform global bersama (pengganti ringan UBO igloo): nilainya objek yang sama di semua material.
ShaderChunk.igloo_globals = /* glsl */ `
uniform float uTime;
uniform vec2 uResolution;
uniform float uAspect;
uniform float uDtRatio;
`

// Konversi ruang warna (buffer tengah linear HalfFloat, LUT dikerjakan di sRGB).
ShaderChunk.igloo_colorspace = /* glsl */ `
vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
`

// Noise nilai 2D + fbm (prosedural, pengganti tekstur noise sampai M2).
ShaderChunk.igloo_noise = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 9.7);
    a *= 0.5;
  }
  return v;
}
`

// Gradient diagonal layar yang dipakai langit DAN kabut (blueprint 4.3): kabut tidak punya jahitan.
ShaderChunk.igloo_skygradient = /* glsl */ `
uniform vec3 uSkyDark;
uniform vec3 uSkyLight;
vec3 skyGradient(vec2 screenUv) {
  float g = (screenUv.x + screenUv.y) * 0.5;
  return mix(uSkyDark, uSkyLight, g * g);
}
`

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`
