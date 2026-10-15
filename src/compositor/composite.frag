// Compositor transisi antar scene (blueprint 5.2), versi M1 lengkap.
// Garis depan diagonal bergerigi, ice cut dari mask R, blok geser dari mask G, gerigi dari mask B,
// chromatic aberration spektral 5 sampel x blue noise, parallax vertikal 0.4.
// Digerakkan posisi scroll saja (uProgress). Mask dan blue noise = tekstur buatan sendiri.
// M6: cabang detail (forensik shader 6.8 d). Saat uDetailProgress > 0 scene scroll dicampur ke tDetail
// dengan displacement es (mask R, UV x5 yang mengecil seiring progress, kekuatan 0.1) + displacement blok
// (mask G, 0.005) + CA modulator 8. Pengganti frost-datatexture igloo = kanal R mask transisi kita sendiri.
#include <igloo_common>
#include <igloo_globals>

uniform sampler2D tScene1;
uniform sampler2D tScene2;
uniform sampler2D tMask; // R ice, G blok, B halus (repeat, linear, tanpa mip, data)
uniform sampler2D tBlue; // blue noise 128, repeat, nearest
uniform vec2 uBlueOffset; // acak tiap frame (dither temporal)
uniform float uProgress;
uniform sampler2D tDetail;
uniform float uDetailProgress; // 0..1, 1.25 s power3.in saat buka, power2.out saat tutup
uniform float uDetailProgress2; // 0..1, 1.25 s sine.out mulai 0.75 s sesudahnya, mengendalikan CA sisi detail
varying vec2 vUv;

#define CA_SAMPLES 5

vec3 blueNoise() {
  return texture2D(tBlue, gl_FragCoord.xy / 128.0 + uBlueOffset).rgb;
}

// Bobot spektral: sampel awal merah, tengah hijau, akhir biru.
vec3 spectral(float t) {
  return clamp(vec3(1.0 - 2.0 * t, 1.0 - abs(2.0 * t - 1.0), 2.0 * t - 1.0), 0.0, 1.0);
}

// CA radial: tiap sampel memakai uv yang didistorsi barrel makin besar.
vec3 chromaticAberration(sampler2D tex, vec2 uv, float amount) {
  vec2 cc = uv - 0.5;
  float d2 = dot(cc, cc);
  vec3 sum = vec3(0.0);
  vec3 wsum = vec3(0.0);
  for (int i = 0; i < CA_SAMPLES; i++) {
    float t = float(i) / float(CA_SAMPLES - 1);
    vec3 w = pow(spectral(t) + 0.0001, vec3(1.0 / 2.2));
    vec2 suv = uv + cc * d2 * amount * (float(i) / float(CA_SAMPLES));
    sum += texture2D(tex, suv).rgb * w;
    wsum += w;
  }
  return sum / wsum;
}

// Cabang detail. Selama transisi detail scroll sudah dipusatkan ke kristal (uProgress 0), jadi sisi
// "kristal" cukup satu scene: tScene1, atau tScene2 kalau scroll ternyata sudah lewat separuh transisi.
vec3 detailComposite() {
  float p = uDetailProgress;
  float p2 = uDetailProgress2;
  float transition = fit(p, 0.4, 1.0, 0.0, 1.0);
  vec3 bn = blueNoise();
  vec2 uvTex = vec2(vUv.x * uAspect, vUv.y);
  // displacement es: pola mask R di-zoom keluar seiring progress (skala UV 5 -> 0)
  vec2 frostUv = uvTex * 5.0 * (1.0 - p);
  vec2 frost = vec2(texture2D(tMask, frostUv).r, texture2D(tMask, frostUv + vec2(0.37, 0.71)).r) * 2.0 - 1.0;
  // displacement blok kecil dari mask G, hanya sumbu x
  float tech = texture2D(tMask, uvTex * 0.1).g * 2.0 - 1.0;
  vec2 disp = frost * 0.1 + vec2(tech * 0.005, 0.0);
  float edge = smoothstep(1.0, 0.5, abs(2.0 * vUv.x - 1.0)) * smoothstep(1.0, 0.5, abs(2.0 * vUv.y - 1.0));
  float modulator = 8.0 * edge;

  vec3 a = vec3(0.0);
  vec3 d = vec3(0.0);
  if (transition < 1.0) {
    float ip = 1.0 - (1.0 - p) * (1.0 - p); // power2.out(p)
    vec2 uv = vUv + disp * p;
    float amount = modulator * ip * bn.r;
    a = uProgress < 0.5 ? chromaticAberration(tScene1, uv, amount) : chromaticAberration(tScene2, uv, amount);
  }
  if (transition > 0.0) {
    float q = 1.0 - p2;
    float iq = 1.0 - (1.0 - q) * (1.0 - q); // power2.out(1 - p2)
    d = chromaticAberration(tDetail, vUv + disp * q, modulator * iq * bn.g);
  }
  return clamp(mix(a, d, transition), 0.0, 1.0);
}

void main() {
  if (uDetailProgress > 0.0) {
    gl_FragColor = vec4(detailComposite(), 1.0);
    return;
  }
  if (uProgress <= 0.0) {
    gl_FragColor = texture2D(tScene1, vUv);
    return;
  }
  if (uProgress >= 1.0) {
    gl_FragColor = texture2D(tScene2, vUv);
    return;
  }

  vec3 bn = blueNoise();
  vec2 uvTex = vec2(vUv.x * uAspect, vUv.y);
  vec3 mask = texture2D(tMask, uvTex).rgb;

  // 1. garis depan miring, dibuat bergerigi oleh kanal B
  float slope = 0.2 * uAspect;
  float X = vUv.y + slope * (vUv.x + (mask.b * 2.0 - 1.0) * 0.4);
  float p = uProgress * (1.0 + slope);

  // 2. tiga ramp dengan kelembutan berbeda
  float rampCA = falloff(X, 0.0, 1.0, 2.0, p);
  float rampDisp = falloff(X, 0.0, 1.0, 0.9, p);
  float rampCut = falloff(X, 0.0, 1.0, 0.2, p);

  // 3. blok geser (kanal G) menyala bertahap saat garis depan mendekat
  float dispMask = falloff(mask.g, 0.0, 1.0, 1.0, rampDisp);
  // 4. ice cut (kanal R): ambang per piksel terhadap garis depan
  float cut = falloff(mask.r, 0.0, 1.0, 2.0, rampCut);

  // 5. parallax + geser blok
  vec2 uv1 = vUv - vec2(0.0, 0.4 * cubicIn(uProgress) + 0.025 * dispMask);
  vec2 uv2 = vUv + vec2(0.0, 0.4 * cubicIn(1.0 - uProgress) + 0.025 * (1.0 - dispMask));

  // 6. CA spektral, nol di tepi layar supaya tidak membaca di luar frame
  float edge = smoothstep(1.0, 0.7, abs(2.0 * vUv.x - 1.0)) * smoothstep(1.0, 0.7, abs(2.0 * vUv.y - 1.0));
  float modulator = 12.0 * edge;

  vec3 s1 = vec3(0.0);
  vec3 s2 = vec3(0.0);
  if (cut < 1.0) s1 = chromaticAberration(tScene1, uv1, modulator * rampCA * bn.r);
  if (cut > 0.0) s2 = chromaticAberration(tScene2, uv2, modulator * (1.0 - rampCA) * bn.g);
  gl_FragColor = vec4(clamp(mix(s1, s2, cut), 0.0, 1.0), 1.0);
}
