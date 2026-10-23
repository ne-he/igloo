import { Color, Group, Vector3, Scene, Mesh, BufferGeometry, Float32BufferAttribute, OrthographicCamera } from 'three'
import gsap from 'gsap'
import { BaseScene } from '../../engine/BaseScene.js'
import { loadGeometry, loadTexture } from '../../engine/Assets.js'
import { smoothstep } from '../../engine/math.js'
import { bus } from '../../engine/Bus.js'
import { MsdfFont } from '../../text/MsdfFont.js'
import links from '../../content/links.js'
import {
  TIMELINE_DURATION, RING_Y, RING_HIDE, FORCEFIELD_Y, FORCEFIELD_WINDOWS, TUNNEL_HIDE,
  buildCameraTimeline, initialCameraState, ringProximity, windowShow, CameraFollow, CAMERA_SMOOTH,
} from './timeline.js'
import { createRings, createForcefields, createPlasma, createSmokeTrails, flipForGltf } from './Rings.js'
import { createTunnel, createCeilingSmoke, createGroundSmoke } from './Smoke.js'
import {
  createFloor, createHaloRing, createLightRoom, createTextCylinders, createRoomForcefield,
  createAmbientParticles, createSnowStreaks, PARTICLES_Y,
} from './Room.js'
import { EntryPostMaterial } from './EntryPost.js'
import { loadVolume } from './volumes.js'
import { VolumeParticles, PARTICLES, particleQuality, simTargetType } from './Particles.js'
import { FluidSim } from './Fluid.js'
import { LinksUI } from './LinksUI.js'

const FONT_URL = '/assets/fonts/plexmono-msdf'

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
 * M7b: 150k partikel volume GPGPU (Particles.js) membentuk volume SDF link aktif, didorong fluid 128 (Fluid.js),
 * carousel link + kotak Visit MSDF (LinksUI.js, data src/content/links.js). Ganti link: noise tambahan 1 -> 0
 * (0.5 s), tukar tVolume + skala, rotasi reset 1.5 PI, lantai berputar (floorTime.additional).
 */
export class EntryScene extends BaseScene {
  constructor(section) {
    super(section, { fov: 22 })
    this.background = new Color('#a9b0be')
    this.camera.displacement.set(0.01, 0.005)
    // posisi dan target dihaluskan di ruang timeline (CameraFollow), bukan di 3D: BaseCamera tidak me-lerp lagi,
    // hanya parallax mouse yang tetap di-damp 0.02 seperti sebelumnya
    this.camera.lerpPosition = 1
    this.camera.lerpTarget = 1
    this.camera.lerpOrbit = CAMERA_SMOOTH.position
    this.camera.shake = 0.02
    this.camera.shakeSpeed = 0.25
    this.camera.zoomFactor = 1.5
    // additionalTime lantai: lompat +-4 (power4.out 3 s) saat ganti link di M7b
    this.floorTime = { additional: 0 }
    this.debug = { proximity: null } // paksa nilai glitch untuk screenshot
    this.linkIndex = 0
    this._floorTarget = 0
    this._simLast = null
    // bunyi partikel (M8 mendengar 'audio_param' { name: 'particles', value }): kick saat ganti link + gerak mouse
    this._soundKick = 0
    this._soundSent = -1
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
    const [volumes, font] = await Promise.all([
      Promise.all(links.map((l) => loadVolume(l.volume))),
      MsdfFont.load(FONT_URL),
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

    // ---- partikel volume GPGPU + fluid sim (M7b) ----
    // Grup di posisi data asli (0, -9.785, 0), dikelilingi forcefield silinder ruang. Jangan geser grup ini.
    this.particlesSlot = new Group()
    this.particlesSlot.name = 'particlesSlot'
    this.particlesSlot.position.set(0, PARTICLES_Y, 0)
    this.add(this.particlesSlot)
    const quality = (this.quality = particleQuality())
    // tanpa RT float/half yang bisa dirender, sim tidak mungkin jalan: partikel dan fluid dimatikan (log sekali)
    this.simOk = simTargetType(engine.renderer) !== null
    if (!this.simOk) console.warn('[entry] RT float/half tidak bisa dirender, partikel volume dimatikan')
    this.volumes = volumes
    this.particles = new VolumeParticles(engine.renderer, g, quality)
    this.particles.setVolume(volumes[0], links[0].scale)
    this.particlesSlot.add(this.particles.points)
    this.fluid = quality.fluid && this.simOk ? new FluidSim(engine.renderer, g.uAspect.value) : null
    if (this.fluid) {
      this.particles.uniforms.tFluid.value = this.fluid.velocity.value
      this.particles.uniforms.uFluidOn.value = 1
      bus.on('resize', ({ aspect }) => this.fluid.setAspect(aspect))
    }

    // ---- carousel link ----
    this.engine = engine
    this.linksUI = new LinksUI(font, { engine, links, onChange: (dir) => this.changeLink(dir) })
    this.add(this.linksUI)

    // Kehilangan konteks WebGL pernah muncul sesekali di scene ini: catat sekali supaya kelihatan di log.
    engine.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      if (this._contextLostLogged) return
      this._contextLostLogged = true
      console.warn('[entry] webglcontextlost', e.statusMessage || '', { progress: this.progress, link: this.linkIndex })
    })

    // ---- kamera + grade ----
    this.cam = initialCameraState()
    this.timeline = buildCameraTimeline(this.cam)
    this.follow = new CameraFollow()
    this.post = this.composer.addPass(new EntryPostMaterial(g, { blueNoise: blue, mask }))
  }

  /**
   * Precompile (BaseScene) + shader sim lewat compileAsync (paralel), lalu pre-sim partikel 1 detik (60 langkah).
   * Hasil ukur di this.particles.stats (presimMs, presimCompileMs, presimStepsMs, compileAsyncMs).
   */
  async upload(renderer) {
    await super.upload(renderer)
    if (!this.simOk) return
    const tri = new BufferGeometry()
    tri.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3))
    const scene = new Scene()
    for (const m of this.particles.compileTargets()) {
      const mesh = new Mesh(tri, m)
      mesh.frustumCulled = false
      scene.add(mesh)
    }
    const t0 = performance.now()
    // target render ikut kunci cache program (ruang warna output), jadi compile dengan RT sim yang sama
    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(this.particles.write)
    await renderer.compileAsync(scene, new OrthographicCamera(-1, 1, 1, -1, 0, 1))
    renderer.setRenderTarget(prev)
    this.particles.stats.compileAsyncMs = performance.now() - t0
    tri.dispose()
    this.particles.presim()
  }

  /** Ganti link aktif (dir -1 kiri / +1 kanan): data asli changeLink igloo, skill ref 01 bagian 6.5. */
  changeLink(dir) {
    const n = links.length
    this.linkIndex = (this.linkIndex + dir + n) % n
    const link = links[this.linkIndex]
    const pu = this.particles.uniforms
    this.particles.setVolume(this.volumes[this.linkIndex], link.scale)
    pu.uRotation.value = 1.5 * PI
    gsap.fromTo(pu.uAdditionalNoise, { value: 1 }, { value: 0, duration: 0.5, ease: 'power2.inOut', overwrite: true })
    // titik tujuan (tambahan kita, Particles.js PARTICLES.assign): partikel ditarik ke titik bentuk baru yang
    // terdekat dengan posisi awalnya, supaya tidak cuma mewarisi jejak bentuk lama (bagian di luar jejak bolong)
    const asg = this.particles.assign
    gsap.fromTo(pu.uAssign, { value: asg.amount }, { value: 0, duration: asg.duration, ease: 'sine.inOut', overwrite: true })
    // lantai: additionalTime += 4 x -dir dalam 3 s power4.out (target dikumpulkan supaya ganti beruntun tidak hilang)
    this._floorTarget += 4 * -dir
    gsap.to(this.floorTime, { additional: this._floorTarget, duration: 3, ease: 'power4.out', overwrite: true })
    this.linksUI.setIndex(this.linkIndex, dir)
    this._soundKick = 1
    bus.emit('audio_play', { name: 'ui-long' })
  }

  onHide() {
    // scene tidak dirender lagi: bunyi partikel ke nol (igloo: onHide entry menolkan suara portal dan partikel)
    this._sendParticleSound(0)
  }

  _sendParticleSound(v) {
    if (Math.abs(v - this._soundSent) < 0.01 && !(v === 0 && this._soundSent !== 0)) return
    this._soundSent = v
    bus.emit('audio_param', { name: 'particles', value: v })
  }

  dispose() {
    this.particles?.dispose()
    this.fluid?.dispose()
    this.linksUI?.dispose()
  }

  update({ time, ratio, input }) {
    const p = this.progress
    const t = p * TIMELINE_DURATION
    this.timeline.progress(p)
    const c = this.cam
    const cam = this.camera
    // kamera = jalur timeline di progress yang dihaluskan (lihat CameraFollow), selalu lewat poros cincin
    const f = this.follow.update(p, ratio, cam.snapping)
    cam.basePosition.set(f.position.x, f.position.y, f.position.z)
    cam.baseTarget.set(f.target.x, f.target.y, f.target.z)
    // elemen portal (cincin, forcefield, terowongan, glitch) ikut progress kamera, bukan progress scroll:
    // saat scroll cepat kamera tertinggal, jadi cincin tidak boleh hilang sebelum kamera benar-benar lewat
    const pc = f.pPosition
    const tc = pc * TIMELINE_DURATION
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
      const vis = pc < RING_HIDE[i]
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
    const zFade = 1 - smoothstep(0.6, 1.4, Math.abs(eye.z))
    this.forcefields.forEach((ff, i) => {
      const [a, b] = FORCEFIELD_WINDOWS[i]
      const show = windowShow(pc, a, b) * zFade
      ff.visible = show > 0.001
      ff.material.uniforms.uShow.value = show
      const d = Math.abs(eye.y - FORCEFIELD_Y[i])
      ff.material.uniforms.uHole.value = 0.12 + (1 - smoothstep(0.2, 2.6, d)) * 0.95
    })
    this.tunnel.visible = pc < TUNNEL_HIDE
    this.tunnel.material.uniforms.uShow.value = 1 - smoothstep(TUNNEL_HIDE - 0.05, TUNNEL_HIDE, pc)
    this.snow.visible = pc < 0.62

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

    // ---- partikel volume + fluid ----
    const pu = this.particles.uniforms
    // interaksi mouse hanya di ruang: smoothstep(.45,.65,p) x (1 - smoothstep(.8,.93,p)) (data asli)
    pu.uInteract.value = smoothstep(0.45, 0.65, p) * (1 - smoothstep(0.8, 0.93, p))
    // noise intro ruang 1 -> 0 di detik timeline 3.5 sampai 5.0
    pu.uShowNoise.value = 1 - smoothstep(3.5, 5.0, t)
    this.particles.material.uniforms.uShow.value = room
    this.particles.points.visible = this.simOk && room > 0.001
    if (this._simLast === null) this._simLast = time
    const dt = time - this._simLast
    // throttle: minimal 15 ms per langkah sim (waktu beku saat screenshot = sim ikut beku)
    if (this.particles.points.visible && dt * 1000 >= PARTICLES.minStepMs) {
      this._simLast = time
      const sdt = Math.min(dt, 0.05)
      if (this.fluid) {
        this.fluid.step(sdt, input.position01)
        pu.tFluid.value = this.fluid.velocity.value
      }
      this.particles.update({ dt: sdt, camera: this.camera, object: this.particlesSlot })
    } else if (!this.particles.points.visible) {
      this._simLast = time
    }

    // bunyi partikel: dasar pelan saat ruang tampil, naik saat link diganti atau mouse mengaduk partikel
    this._soundKick *= Math.pow(0.97, ratio)
    const stir = Math.min(1, input.velocity.length() * 4) * pu.uInteract.value
    this._sendParticleSound(room * Math.min(1, 0.25 + 0.75 * Math.max(this._soundKick, stir)))

    // ---- carousel link ----
    const detailOpen = (this.engine.composite?.uniforms.uDetailProgress?.value ?? 0) > 0
    this.linksUI.update({ progress: p, allowed: this.active && !detailOpen, ratio })

    // ---- grade ----
    const prox = this.debug.proximity ?? ringProximity(tc)
    const u = this.post.uniforms
    u.uRingProximity.value = prox
    u.uBlueOffset.value.set(Math.random(), Math.random())
    if (prox > 0) u.uSquare.value.set(Math.random(), Math.random(), 1)
  }
}
