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

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`
