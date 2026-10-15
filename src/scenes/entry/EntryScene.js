import { Color, Group, Vector3 } from 'three'
import { BaseScene } from '../../engine/BaseScene.js'
import { loadGeometry, loadTexture } from '../../engine/Assets.js'
import { smoothstep } from '../../engine/math.js'
import {
  TIMELINE_DURATION, RING_Y, RING_HIDE, FORCEFIELD_Y, FORCEFIELD_WINDOWS, TUNNEL_HIDE,
  buildCameraTimeline, initialCameraState, ringProximity, windowShow,
} from './timeline.js'
import { createRings, createForcefields, createPlasma, createSmokeTrails, flipForGltf } from './Rings.js'
import { createTunnel, createCeilingSmoke, createGroundSmoke } from './Smoke.js'
import {
  createFloor, createHaloRing, createLightRoom, createTextCylinders, createRoomForcefield,
  createAmbientParticles, createSnowStreaks, PARTICLES_Y,
} from './Room.js'
import { EntryPostMaterial } from './EntryPost.js'

const PI = Math.PI
const _up = new Vector3()
const _plusY = new Vector3(0, 1, 0)
const _ringPos = new Vector3()

/**
 * Scene 3: cincin portal + ruang link (M7a, statis tanpa partikel volume).
 * Kamera: timeline 9.2 s di-scrub progress (timeline.js), up (0,0,-1) diputar upRotation lalu dibaurkan ke +Y.
 * Portal: 3 cincin pecah (rotation.z = upRotation x 0.4) yang meledak keluar saat kamera dekat, forcefield,
 * plasma, asap trail, terowongan asap. Ruang: lantai bergalur, cincin halo, bola ruang, silinder teks,
 * forcefield silinder, partikel ambien, coretan salju. Grade: EntryPost (glitch lewat cincin + glare).
 * Yang belum: 150k partikel volume + fluid (M7b, slot kosong di bawah), carousel link + UI (M7b/M8).
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
    // additionalTime lantai: lompat +-4 (power4.out 3 s) saat ganti link di M7b
    this.floorTime = { additional: 0 }
    this.debug = { proximity: null } // paksa nilai glitch untuk screenshot
  }

  async build(engine) {
    const g = engine.globals
    const srgb = (f) => loadTexture(f, 'srgb').then(flipForGltf)
    const linear = (f) => loadTexture(f, 'linear').then(flipForGltf)
    const [ringA, ringB, floorGeo, mapA, mapB, glowA, glowB, floorMap, clouds, triangles, wind, blue, mask, atlas, info] =
      await Promise.all([
        loadGeometry('ring_a'), loadGeometry('ring_b'), loadGeometry('floor'),
        srgb('ring_a_color.webp'), srgb('ring_b_color.webp'),
        linear('ring_a_glow.png'), linear('ring_b_glow.png'),
        srgb('floor_color.webp'),
        loadTexture('clouds_noise.png', 'repeat'),
        loadTexture('triangles_tiling.png', 'repeat'),
        loadTexture('wind_noise.png', 'repeat'),
        loadTexture('blue_noise_128.png', 'data-repeat-nearest'),
        loadTexture('transition_mask.png', 'data-repeat'),
        loadTexture('blurrytext_atlas.png', 'mask'),
        fetch('/assets/textures/blurrytext_atlas.json').then((r) => r.json()),
      ])

    // ---- portal ----
    const { group: ringGroup, rings } = createRings(g, {
      geos: { ring_a: ringA, ring_b: ringB },
      maps: { ring_a: mapA, ring_b: mapB },
      glows: { ring_a: glowA, ring_b: glowB },
    })
    this.rings = rings
    this.forcefields = createForcefields(g, { clouds, triangles })
    this.plasma = createPlasma(g, { wind })
    this.trails = createSmokeTrails(g, { wind })
    this.tunnel = createTunnel(g, { wind })
    this.snow = createSnowStreaks(g)
    this.add(ringGroup, ...this.forcefields, ...this.plasma, ...this.trails, this.tunnel, this.snow)

    // ---- ruang ----
    this.lightRoom = createLightRoom(g)
    this.floor = createFloor(g, { geo: floorGeo, map: floorMap })
    this.halo = createHaloRing(g)
    this.textCylinders = createTextCylinders(g, { atlas, info })
    this.roomForcefield = createRoomForcefield(g, { triangles })
    this.ambient = createAmbientParticles(g)
    this.ceilingSmoke = createCeilingSmoke(g, { wind })
    this.groundSmoke = createGroundSmoke(g, { wind })
    this.add(this.lightRoom, this.floor, this.halo, ...this.textCylinders, this.roomForcefield, this.ambient,
      this.ceilingSmoke, this.groundSmoke)

    // ---- SLOT M7b: volume 150k partikel GPGPU + fluid sim ----
    // Sengaja kosong. M7b memasang mesh Points partikel (dan forcefield silinder di atas sudah mengelilinginya)
    // ke grup ini. Posisi data asli (0, -9.785, 0). Jangan geser grup ini, geser isinya.
    this.particlesSlot = new Group()
    this.particlesSlot.name = 'particlesSlot'
    this.particlesSlot.position.set(0, PARTICLES_Y, 0)
    this.add(this.particlesSlot)

    // ---- kamera + grade ----
    this.cam = initialCameraState()
    this.timeline = buildCameraTimeline(this.cam)
    this.post = this.composer.addPass(new EntryPostMaterial(g, { blueNoise: blue, mask }))
  }

  update({ time }) {
    const p = this.progress
    const t = p * TIMELINE_DURATION
    this.timeline.progress(p)
    const c = this.cam
    const cam = this.camera
    cam.basePosition.set(c.px, c.py, c.pz)
    cam.baseTarget.set(c.tx, c.ty, c.tz)
    // up awal (0,0,-1) diputar di sumbu Y, lalu dibaurkan ke +Y (pandangan horizontal di ruang)
    _up.set(-Math.sin(c.upRotation), 0, -Math.cos(c.upRotation))
    cam.baseUp.copy(_up).lerp(_plusY, c.upOriginal).normalize()
    cam.displacement.set(c.dx, c.dy)
    if (Math.abs(cam.fov - c.fov) > 1e-4) {
      cam.fov = c.fov
      cam.updateProjectionMatrix()
    }
    const eye = cam.basePosition

    // ---- portal ----
    this.rings.forEach((ring, i) => {
      const vis = p < RING_HIDE[i]
      ring.visible = vis
      this.plasma[i].visible = vis
      this.trails[i].visible = vis
      if (!vis) return
      ring.rotation.z = c.upRotation * 0.4
      _ringPos.set(0, RING_Y[i], 0)
      const near = 1 - smoothstep(0.3, 2.6, eye.distanceTo(_ringPos))
      ring.material.uniforms.uNear.value = near
      this.plasma[i].rotation.y = i * PI * 0.5 + c.upRotation * 0.5
      this.plasma[i].material.uniforms.uShow.value = near * near
      this.trails[i].rotation.y = i * PI * 0.5 + c.upRotation * 0.5 + 0.7
    })
    // forcefield: jendela tampil asli, pudar saat kamera masih jauh dari poros (z), lubang membesar saat dekat
    const zFade = 1 - smoothstep(0.6, 1.4, Math.abs(c.pz))
    this.forcefields.forEach((ff, i) => {
      const [a, b] = FORCEFIELD_WINDOWS[i]
      const show = windowShow(p, a, b) * zFade
      ff.visible = show > 0.001
      ff.material.uniforms.uShow.value = show
      const d = Math.abs(c.py - FORCEFIELD_Y[i])
      ff.material.uniforms.uHole.value = 0.12 + (1 - smoothstep(0.2, 2.6, d)) * 0.95
    })
    this.tunnel.visible = p < TUNNEL_HIDE
    this.tunnel.material.uniforms.uShow.value = 1 - smoothstep(TUNNEL_HIDE - 0.05, TUNNEL_HIDE, p)
    this.snow.visible = p < 0.62

    // ---- ruang: muncul saat kamera turun ke ruang ----
    const room = smoothstep(0.45, 0.62, p)
    this.floor.material.uniforms.uAlpha.value = smoothstep(0.42, 0.7, p)
    this.floor.material.uniforms.uRotationTime.value = time * 0.5 + this.floorTime.additional
    this.halo.material.uniforms.uShow.value = room
    this.halo.material.uniforms.uRotation.value = time * 0.2
    for (const m of this.textCylinders) m.material.uniforms.uShow.value = room
    this.roomForcefield.material.uniforms.uShow.value = room
    this.ambient.material.uniforms.uShow.value = room
    for (const o of [this.halo, this.roomForcefield, this.ambient, this.ceilingSmoke, this.groundSmoke, ...this.textCylinders]) {
      o.visible = room > 0.001
    }
    this.floor.visible = p > 0.4

    // ---- grade ----
    const prox = this.debug.proximity ?? ringProximity(t)
    const u = this.post.uniforms
    u.uRingProximity.value = prox
    u.uBlueOffset.value.set(Math.random(), Math.random())
    if (prox > 0) u.uSquare.value.set(Math.random(), Math.random(), 1)
  }
}
