import { Color, Mesh, IcosahedronGeometry, MeshBasicMaterial, EdgesGeometry, LineSegments, LineBasicMaterial } from 'three'
import { BaseScene } from '../../engine/BaseScene.js'
import { CRYSTAL_COUNT, crystalCenter } from '../sections.js'

const VERTICAL_OFFSET = -5.75 // jarak antar kristal (blueprint 5.3)

/**
 * Scene 2: kristal portofolio. M0 = placeholder. Layout dan kamera sudah data asli:
 * kristal t di y = (1 + t) * -5.75, kamera y = -23 * progress, fov = 45 - 5 * velocity scroll,
 * rotasi kristal = (centeredProgress - progress) * (11, 14, 6) * tanda acak + goyang 0.1 rad.
 */
export class CrystalsScene extends BaseScene {
  constructor(section) {
    super(section, { fov: 45 })
    this.background = new Color('#b9c0cd')
    this.camera.displacement.set(0.1, 0.05)
    this.camera.shake = 0.02
    this.camera.shakeSpeed = 0.1
    this.cameraZoom = 0
    this.crystals = []
  }

  async build() {
    for (let t = 0; t < CRYSTAL_COUNT; t++) {
      const geo = new IcosahedronGeometry(1, 0)
      const mesh = new Mesh(geo, new MeshBasicMaterial({ color: '#d6dde6' }))
      mesh.add(new LineSegments(new EdgesGeometry(geo), new LineBasicMaterial({ color: '#7f7f7f' })))
      mesh.position.y = (1 + t) * VERTICAL_OFFSET
      mesh.scale.set(0.9, 1.2, 0.8)
      const sign = () => (Math.random() < 0.5 ? -1 : 1)
      mesh.userData = {
        center: crystalCenter(t),
        spin: [11 * sign(), 14 * sign(), 6 * sign()],
        rand: Math.random() * 10,
      }
      this.crystals.push(mesh)
      this.add(mesh)
    }
  }

  onShow() {
    // igloo mengacak ulang arah putar tiap kali scene terlihat lagi
    for (const m of this.crystals) {
      m.userData.spin = m.userData.spin.map((v) => Math.abs(v) * (Math.random() < 0.5 ? -1 : 1) * (1 - Math.random() * 0.15))
    }
  }

  update({ time, scroll }) {
    const camY = 4 * VERTICAL_OFFSET * this.progress
    this.camera.basePosition.set(0, camY, 5 + this.cameraZoom)
    this.camera.baseTarget.set(0, camY, 0)
    const fov = 45 - 5 * Math.abs(scroll.velocity)
    if (Math.abs(this.camera.fov - fov) > 1e-4) {
      this.camera.fov = fov
      this.camera.updateProjectionMatrix()
    }
    for (const m of this.crystals) {
      const d = m.userData.center - this.progress
      const [sx, sy, sz] = m.userData.spin
      const wob = Math.sin(time * 0.3 + m.userData.rand) * 0.1
      m.rotation.set(d * sx + wob, d * sy + wob, d * sz)
    }
  }
}
