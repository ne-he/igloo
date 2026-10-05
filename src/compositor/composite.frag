// Compositor transisi antar scene (blueprint 5.2).
// M0 = versi fallback: wipe diagonal miring + parallax vertikal, tanpa mask es dan tanpa CA.
// M1 menambah: mask 3 kanal (ice cut R, blok G, gerigi B), CA spektral 5 sampel, blue noise.
#include <igloo_common>
#include <igloo_globals>

uniform sampler2D tScene1;
uniform sampler2D tScene2;
uniform float uProgress;
varying vec2 vUv;

void main() {
  if (uProgress <= 0.0) {
    gl_FragColor = texture2D(tScene1, vUv);
    return;
  }
  float slope = 0.2 * uAspect;
  // Garis depan miring: bagian bawah kiri ditutup scene berikutnya lebih dulu.
  float X = vUv.y + slope * vUv.x;
  float cut = falloff(X, 0.0, 1.0 + slope, 0.2, uProgress);

  // Parallax: scene sekarang naik keluar, scene berikutnya naik masuk.
  vec2 uv1 = vUv - vec2(0.0, 0.4 * cubicIn(uProgress));
  vec2 uv2 = vUv + vec2(0.0, 0.4 * cubicIn(1.0 - uProgress));

  vec4 a = cut < 1.0 ? texture2D(tScene1, uv1) : vec4(0.0);
  vec4 b = cut > 0.0 ? texture2D(tScene2, uv2) : vec4(0.0);
  gl_FragColor = mix(a, b, cut);
}
