import { PerspectiveCamera, Vector3, Vector2, Spherical } from 'three'
import { lerp, sineNoise } from './math.js'

const _offset = new Vector3()
const _sph = new Spherical()
const _right = new Vector3()
const _up = new Vector3()
const _dir = new Vector3()

/**
 * Kamera dasar semua scene (blueprint 6.4). Scene mengisi basePosition/baseTarget/baseUp tiap frame
 * (biasanya dari timeline GSAP yang di-scrub progress), kamera menambah parallax mouse, shake, dan damping.
 */
export class BaseCamera extends PerspectiveCamera {
  constructor(fov = 45) {
    super(fov, 1, 0.1, 1000)
    this.basePosition = new Vector3(0, 0, 5)
    this.baseTarget = new Vector3()
    this.baseUp = new Vector3(0, 1, 0)
    this.target = new Vector3()
    this.displacement = new Vector2(0, 0) // parallax maks (x, y) dalam satuan PI/2
    this.lerpPosition = 0.035
    this.lerpTarget = 0.035
    // damping parallax mouse (orbit). null = ikut lerpPosition (perilaku semua scene). Entry memisahkannya karena
    // posisinya dihaluskan di ruang timeline (lerpPosition 1) tapi parallax tetap harus halus.
    this.lerpOrbit = null
    this.shake = 0 // radian
    this.shakeSpeed = 0
    this.touchAmount = 1
    this.zoomFactor = 1.25 // zoom = min(1, aspect * zoomFactor) supaya layar portrait mundur
    this._theta = 0
    this._phi = 0
    this._desired = new Vector3()
    this._desiredTarget = new Vector3()
    this._needsSnap = true
  }

  /** Lompat langsung ke posisi tujuan (dipakai saat scene baru terlihat). */
  snap() {
    this._needsSnap = true
  }

  /** true kalau frame ini akan lompat (scene baru terlihat / setScroll debug). Dibaca scene sebelum update kamera. */
  get snapping() {
    return this._needsSnap
  }

  resize(aspect) {
    this.aspect = aspect
    this.zoom = Math.min(1, aspect * this.zoomFactor)
    this.updateProjectionMatrix()
  }

  update(pointer11, time, ratio) {
    const k = 1 - Math.pow(1 - this.lerpPosition, ratio)
    const kOrbit = this.lerpOrbit == null ? k : 1 - Math.pow(1 - this.lerpOrbit, ratio)
    const theta = pointer11.x * (Math.PI / 2) * this.displacement.x * this.touchAmount
    const phi = pointer11.y * (Math.PI / 2) * this.displacement.y * this.touchAmount
    this._theta = this._needsSnap ? theta : lerp(this._theta, theta, kOrbit)
    this._phi = this._needsSnap ? phi : lerp(this._phi, phi, kOrbit)

    // Orbit basePosition di sekitar baseTarget.
    _offset.subVectors(this.basePosition, this.baseTarget)
    _sph.setFromVector3(_offset)
    _sph.theta -= this._theta
    _sph.phi = Math.min(Math.PI - 0.001, Math.max(0.001, _sph.phi + this._phi))
    this._desired.setFromSpherical(_sph).add(this.baseTarget)

    // Shake: target digeser sedikit tegak lurus arah pandang, amplitudo dalam radian.
    this._desiredTarget.copy(this.baseTarget)
    if (this.shake > 0) {
      const dist = _offset.length()
      _dir.subVectors(this.baseTarget, this._desired).normalize()
      _right.crossVectors(_dir, this.baseUp).normalize()
      _up.crossVectors(_right, _dir).normalize()
      const t = time * this.shakeSpeed
      this._desiredTarget.addScaledVector(_right, sineNoise(t) * this.shake * dist)
      this._desiredTarget.addScaledVector(_up, sineNoise(t + 17.3) * this.shake * dist)
    }

    if (this._needsSnap) {
      this.position.copy(this._desired)
      this.target.copy(this._desiredTarget)
      this._needsSnap = false
    } else {
      this.position.lerp(this._desired, k)
      this.target.lerp(this._desiredTarget, 1 - Math.pow(1 - this.lerpTarget, ratio))
    }
    this.up.copy(this.baseUp)
    this.lookAt(this.target)
  }
}
