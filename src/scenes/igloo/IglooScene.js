import { Color, Mesh, BoxGeometry, PlaneGeometry, MeshBasicMaterial, EdgesGeometry, LineSegments, LineBasicMaterial } from 'three'
import gsap from 'gsap'
import { BaseScene } from '../../engine/BaseScene.js'

/**
 * Scene 1: igloo. M0 = placeholder geometri, tapi jalur kamera sudah data asli (blueprint 6.4):
 * timeline 21 s di-scrub progress. Titik istirahat p = 0.495 -> kamera (-13.49, 2.65, 14.43) menatap (0, 1.24, 0).
 */
export class IglooScene extends BaseScene {
  constructor(section) {
    super(section, { fov: 30 })
    this.background = new Color('#c4cad7')
    this.camera.displacement.set(0.07, 0.025)
    this.camera.shake = 0.01
    this.camera.shakeSpeed = 0.5
    this.camera.zoomFactor = 1.25
  }

  async build() {
    const box = new Mesh(new BoxGeometry(5, 3.7, 6), new MeshBasicMaterial({ color: '#9aa2b4' }))
    box.position.y = 1.3
    const edges = new LineSegments(new EdgesGeometry(box.geometry), new LineBasicMaterial({ color: '#ffffff' }))
    box.add(edges)
    const ground = new Mesh(new PlaneGeometry(60, 60), new MeshBasicMaterial({ color: '#b3b9c7' }))
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.55
    this.add(ground, box)

    this.cam = { px: -13.25, py: 11.5, pz: 13.25, ty: 15 }
    this.timeline = gsap.timeline({ paused: true })
      .to(this.cam, { py: 2.5, ty: 1, duration: 14, ease: 'power2.out' }, 0)
      .to(this.cam, { px: -15.25, pz: 23.25, duration: 14, ease: 'power1.inOut' }, 7)
  }

  update() {
    this.timeline.progress(this.progress)
    this.camera.basePosition.set(this.cam.px, this.cam.py, this.cam.pz)
    this.camera.baseTarget.set(0, this.cam.ty, 0)
  }
}
