import { Color } from 'three'
import '../../glsl/chunks.js'

// Potongan GLSL bersama scene entry. Semua rumus ditulis sendiri dari deskripsi teknik (skill ref 02 bagian 7).

// Warna ruang link (palet blueprint 4.4): gradient diagonal layar gelap -> terang.
export const ROOM_DARK = new Color('#6a6f7d')
export const ROOM_LIGHT = new Color('#e1e6f1')
export const roomUniforms = () => ({ uRoomDark: { value: ROOM_DARK }, uRoomLight: { value: ROOM_LIGHT } })

// Gradient ruang: ((sx + sy) / 2)^2 seperti scene lain, dimodulasi dua lapis sine noise pelan, x1.1.
// Butuh #include <igloo_globals> sebelumnya (uTime).
export const ROOM_GRADIENT = /* glsl */ `
  uniform vec3 uRoomDark;
  uniform vec3 uRoomLight;
  float roomNoise(vec2 s) {
    float a = sin(s.x * 3.1 + uTime * 0.21 + sin(s.y * 2.3 - uTime * 0.17) * 1.5) * 0.5 + 0.5;
    float b = sin(s.y * 4.3 - uTime * 0.15 + sin(s.x * 3.7 + uTime * 0.11) * 1.3) * 0.5 + 0.5;
    return a * b;
  }
  vec3 roomGradient(vec2 s) {
    float g = (s.x + s.y) * 0.5;
    g *= g;
    g = clamp(g * (0.8 + 0.45 * roomNoise(s)), 0.0, 1.0);
    return mix(uRoomDark, uRoomLight, g) * 1.1;
  }
`

// Resep asap tunggal (blueprint 4.3): tiga lookup wind noise di skala/kecepatan berbeda lalu dikalikan.
// uv = koordinat dasar, speed = arah aliran per detik. Hasil dinormalisasi kasar ke 0..~1 (rata-rata ~0.5).
export const WIND_SMOKE = /* glsl */ `
  uniform sampler2D tWind;
  float windSmoke(vec2 uv, vec2 speed, float t) {
    float a = texture2D(tWind, uv + speed * t).r;
    float b = texture2D(tWind, uv * 1.73 + vec2(0.37, 0.11) + speed * t * 1.31).r;
    float c = texture2D(tWind, uv * 0.61 + vec2(0.71, 0.53) - speed.yx * t * 0.67).r;
    return a * b * c * 4.0;
  }
  // varian untuk koordinat yang membungkus (u 0..1 keliling silinder): pengali u bilangan bulat, jadi tanpa jahitan
  float windSmokeWrap(float u, float v, float t) {
    float a = texture2D(tWind, vec2(u * 3.0, v * 1.1 + t * 0.11)).r;
    float b = texture2D(tWind, vec2(u * 5.0 + 0.37, v * 1.9 + t * 0.17)).r;
    float c = texture2D(tWind, vec2(u * 2.0 + 0.71, v * 0.6 + t * 0.07)).r;
    return a * b * c * 4.0;
  }
`

// Rotasi Rodrigues + sine noise 3D murah (jumlah sinus bersarang).
export const ENTRY_MATH = /* glsl */ `
  mat3 rotAxis(vec3 a, float ang) {
    float s = sin(ang), c = cos(ang), oc = 1.0 - c;
    return mat3(oc * a.x * a.x + c, oc * a.x * a.y + a.z * s, oc * a.z * a.x - a.y * s,
                oc * a.x * a.y - a.z * s, oc * a.y * a.y + c, oc * a.y * a.z + a.x * s,
                oc * a.z * a.x + a.y * s, oc * a.y * a.z - a.x * s, oc * a.z * a.z + c);
  }
  float sineNoise(vec3 p) {
    return (sin(p.x * 1.7 + sin(p.y * 1.3 + p.z * 0.7)) +
            sin(p.y * 2.3 + sin(p.z * 1.1 - p.x * 0.9)) +
            sin(p.z * 1.9 + sin(p.x * 0.9 + p.y * 1.4))) / 3.0;
  }
`
