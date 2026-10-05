// Helper matematika bersama. Semua damping frame-rate independent lewat `ratio`
// (ratio = min(5, delta_ms / 16.667), jadi 1.0 di 60 fps).

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
export const lerp = (a, b, t) => a + (b - a) * t
export const mod = (n, m) => ((n % m) + m) % m

export function fit(v, inMin, inMax, outMin, outMax, clamped = true) {
  let t = (v - inMin) / (inMax - inMin)
  if (clamped) t = clamp(t, 0, 1)
  return outMin + (outMax - outMin) * t
}

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** lerp yang hasilnya sama di 30, 60, atau 144 fps. `t` = faktor per frame 60 fps. */
export const lerpFPS = (a, b, t, ratio) => lerp(a, b, 1 - Math.pow(1 - t, ratio))

/** friksi per frame 60 fps, dikoreksi ke ratio frame sekarang. */
export const frictionFPS = (f, ratio) => Math.pow(f, ratio)

/** lerpFPS dengan langkah maksimum per frame 60 fps (dikali ratio). */
export function lerpFPSLimited(a, b, t, maxStep, ratio) {
  const step = (b - a) * (1 - Math.pow(1 - t, ratio))
  const limit = maxStep * ratio
  return a + clamp(step, -limit, limit)
}

/** Jumlah 6 sinus, dipakai untuk shake kamera yang tidak terasa berulang. */
export function sineNoise(t) {
  return (
    Math.sin(t * 1.0) * 0.35 +
    Math.sin(t * 2.31 + 1.7) * 0.22 +
    Math.sin(t * 3.73 + 0.4) * 0.15 +
    Math.sin(t * 5.17 + 2.9) * 0.12 +
    Math.sin(t * 7.91 + 4.1) * 0.09 +
    Math.sin(t * 11.3 + 5.3) * 0.07
  )
}
