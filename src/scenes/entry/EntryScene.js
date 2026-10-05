import { Color, Mesh, TorusGeometry, SphereGeometry, CircleGeometry, MeshBasicMaterial, Vector3 } from 'three'
import gsap from 'gsap'
import { BaseScene } from '../../engine/BaseScene.js'

const RING_Y = [-1.65, -4.15, -6.65]
const PARTICLES_Y = -9.785

/**
 * Scene 3: cincin portal + ruang link. M0 = placeholder. Timeline kamera 9.2 s mengikuti blueprint 5.5:
 * mulai menatap ke bawah dengan up (0,0,-1) yang diputar, menukik ke y -9.83, up dibaurkan ke +Y,
 * fov 22 ke 30. Ease asli (entry_ease, entry_ease_3) belum diketahui, sementara power2/power3. [?]
 */
export class EntryScene extends BaseScene {
  constructor(section) {
    super(section, { fov: 22 })
    this.background = new Color('#a9b0be')
    this.camera.displacement.set(0.01, 0.005)
    this.camera.lerpPosition = 0.02
    this.camera.lerpTarget = 0.015
    this.camera.shake = 0.02
    this.camera.shakeSpeed = 0.25
    this.camera.zoomFactor = 1.5
  }

  async build() {
    const ringMat = new MeshBasicMaterial({ color: '#8c95a8' })
    RING_Y.forEach((y, i) => {
      const ring = new Mesh(new TorusGeometry(0.4, 0.06, 12, 48), ringMat)
      ring.rotation.x = -Math.PI / 2
      ring.position.y = y
      ring.userData.i = i
      this.add(ring)
    })
    const core = new Mesh(new SphereGeometry(0.3, 32, 16), new MeshBasicMaterial({ color: '#dfe5ee' }))
    core.position.y = PARTICLES_Y
    const floor = new Mesh(new CircleGeometry(1.3, 64), new MeshBasicMaterial({ color: '#7d8597' }))
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -10.19
    this.add(core, floor)

    this.cam = { px: 0, py: 1.5, pz: -2, tx: 0, ty: -2.5, tz: -1, fov: 22, upRotation: 0, upOriginal: 0 }
    this.timeline = gsap.timeline({ paused: true })
      .to(this.cam, { px: 0, pz: 0, duration: 2.5, ease: 'power2.inOut' }, 0)
      .to(this.cam, { py: -9.83, duration: 7, ease: 'power2.inOut' }, 0.2)
      .to(this.cam, { pz: -1.5, duration: 3.7, ease: 'power2.inOut' }, 3.5)
      .to(this.cam, { pz: -3, duration: 2, ease: 'power2.inOut' }, 7.2)
      .to(this.cam, { ty: -10, duration: 7, ease: 'power2.inOut' }, 0.2)
      .to(this.cam, { tz: 0, duration: 3.7, ease: 'power2.inOut' }, 3.5)
      .to(this.cam, { ty: -9.81, duration: 1, ease: 'power2.inOut' }, 7.2)
      .to(this.cam, { ty: -10.35, duration: 1, ease: 'power2.inOut' }, 8.2)
      .to(this.cam, { fov: 30, duration: 7.2, ease: 'power2.inOut' }, 0)
      .to(this.cam, { upRotation: Math.PI, duration: 5.25, ease: 'power3.inOut' }, 1)
      .to(this.cam, { upOriginal: 1, duration: 3.7, ease: 'power2.inOut' }, 3.5)
    this._upA = new Vector3()
  }

  update() {
    this.timeline.progress(this.progress)
    const c = this.cam
    this.camera.basePosition.set(c.px, c.py, c.pz)
    this.camera.baseTarget.set(c.tx, c.ty, c.tz)
    // up awal (0,0,-1) diputar di sumbu Y, lalu dibaurkan ke +Y (pandangan horizontal di ruang)
    this._upA.set(-Math.sin(c.upRotation), 0, -Math.cos(c.upRotation))
    this.camera.baseUp.copy(this._upA).lerp(new Vector3(0, 1, 0), c.upOriginal).normalize()
    if (Math.abs(this.camera.fov - c.fov) > 1e-4) {
      this.camera.fov = c.fov
      this.camera.updateProjectionMatrix()
    }
  }
}
