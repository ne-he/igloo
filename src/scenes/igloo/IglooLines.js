import { BufferGeometry, Float32BufferAttribute, LineSegments, ShaderMaterial, AdditiveBlending, Color } from 'three'
import '../../glsl/chunks.js'

// Garis igloo (blueprint 5.1, skill ref 02 4.2): outline siluet bata + cage lattice intro.
// Keduanya LineSegments additive #a7b2d6 tanpa depth test, digambar di atas segalanya (renderOrder 999).
export const LINE_COLOR = new Color('#a7b2d6')

/**
 * Outline: tepi kotak tiap bata. Pulau UV bata = muka kubus, jadi jahitan UV (tepi yang hanya dipakai
 * satu segitiga di mesh yang sudah terpisah per UV) persis garis tengah bevel tiap rusuk bata.
 * Segmen yang hampir segaris lalu digabung supaya jumlahnya mendekati aset asli (sekitar 1650 segmen).
 */
export function outlineSegments(geo, maxAngleDeg = 25) {
  const pos = geo.attributes.position
  const index = geo.index.array
  const n = pos.count
  const count = new Map()
  for (let i = 0; i < index.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = index[i + k]
      const b = index[i + ((k + 1) % 3)]
      const key = a < b ? a * n + b : b * n + a
      count.set(key, (count.get(key) || 0) + 1)
    }
  }
  // titik dengan posisi sama (vertex terpisah karena UV) disatukan lewat kunci posisi terkuantisasi
  const q = (v) => Math.round(v * 2000)
  const nodeOf = new Map()
  const nodes = []
  const node = (v) => {
    const key = `${q(pos.getX(v))},${q(pos.getY(v))},${q(pos.getZ(v))}`
    let id = nodeOf.get(key)
    if (id === undefined) {
      id = nodes.length
      nodeOf.set(key, id)
      nodes.push({ p: [pos.getX(v), pos.getY(v), pos.getZ(v)], adj: new Set() })
    }
    return id
  }
  for (const [key, c] of count) {
    if (c !== 1) continue
    const a = Math.floor(key / n)
    const b = key - a * n
    const na = node(a)
    const nb = node(b)
    if (na === nb) continue
    nodes[na].adj.add(nb)
    nodes[nb].adj.add(na)
  }
  // gabung titik berderajat 2 yang segmennya hampir segaris
  const cosMax = Math.cos((maxAngleDeg * Math.PI) / 180)
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i]
      if (nd.adj.size !== 2) continue
      const [a, b] = [...nd.adj]
      const pa = nodes[a].p
      const pb = nodes[b].p
      const p = nd.p
      const ux = p[0] - pa[0], uy = p[1] - pa[1], uz = p[2] - pa[2]
      const vx = pb[0] - p[0], vy = pb[1] - p[1], vz = pb[2] - p[2]
      const cos = (ux * vx + uy * vy + uz * vz) / (Math.hypot(ux, uy, uz) * Math.hypot(vx, vy, vz) + 1e-9)
      if (cos < cosMax || nodes[a].adj.has(b)) continue
      nodes[a].adj.delete(i)
      nodes[b].adj.delete(i)
      nodes[a].adj.add(b)
      nodes[b].adj.add(a)
      nd.adj.clear()
      changed = true
    }
  }
  const out = []
  nodes.forEach((nd, i) => {
    for (const j of nd.adj) if (j > i) out.push(...nd.p, ...nodes[j].p)
  })
  return new Float32Array(out)
}

/** Geometri garis + seed acak per segmen (fase kedip). */
function lineGeometry(positions) {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute(positions, 3))
  const segs = positions.length / 6
  const seed = new Float32Array(segs * 2)
  for (let i = 0; i < segs; i++) seed[i * 2] = seed[i * 2 + 1] = Math.random()
  g.setAttribute('aSeed', new Float32BufferAttribute(seed, 1))
  return g
}

const lineMaterial = (globals, uniforms, vertexShader) => new ShaderMaterial({
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: AdditiveBlending,
  uniforms: { ...globals, uColor: { value: LINE_COLOR }, ...uniforms },
  vertexShader,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    varying float vAlpha;
    void main() {
      if (vAlpha < 0.002) discard;
      gl_FragColor = vec4(uColor, vAlpha);
    }
  `,
})

/** Outline siluet bata. uScrollAlpha diisi IglooHero dari progress, uAlpha + uIntroMaterialize untuk intro. */
export function createOutline(globals, geo) {
  const mat = lineMaterial(globals, {
    uAlpha: { value: 0 },
    uScrollAlpha: { value: 0 },
    uIntroMaterialize: { value: 1 },
    uOpacity: { value: 0.55 },
  }, /* glsl */ `
    #include <igloo_globals>
    uniform float uAlpha;
    uniform float uScrollAlpha;
    uniform float uIntroMaterialize;
    uniform float uOpacity;
    attribute float aSeed;
    varying float vAlpha;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      float t = uTime * 5.0;
      // kilau: perkalian tiga gelombang ruang, dipetakan ke 0.2..1
      float s = (sin(w.x * 6.0 + t) * 0.5 + 0.5) * (cos(w.y * 6.0 + t + aSeed * 6.2832) * 0.5 + 0.5) * (sin(w.z * 6.0 + t) * 0.5 + 0.5);
      s = mix(0.2, 1.0, s);
      // intro: muncul dari atas ke bawah
      float front = mix(3.5 + 2.0, 0.1 - 2.0, uIntroMaterialize);
      float built = smoothstep(front - 1.0, front + 1.0, w.y);
      vAlpha = s * built * (uAlpha + uScrollAlpha) * uOpacity;
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `)
  const lines = new LineSegments(lineGeometry(outlineSegments(geo)), mat)
  lines.name = 'iglooOutline'
  lines.renderOrder = 999
  lines.frustumCulled = false
  lines.matrixAutoUpdate = false
  return lines
}

/**
 * Cage: lattice 2 unit (x, z -15..15, y -3..5) dengan jalan acak Manhattan + sedikit diagonal.
 * Hanya tampil saat intro: shockwave radial dari pusat (uProgress) + kedip per segmen.
 * userData.nodes = titik lattice yang dilewati (dipakai angka intro).
 */
export function createCage(globals, { walks = 64, seed = 7 } = {}) {
  let s = seed
  const rnd = () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
  const X = [-15, 15]
  const Y = [-3, 5]
  const segs = new Set()
  const nodes = new Map()
  const addNode = (p) => nodes.set(p.join(','), p)
  const randX = () => -15 + 2 * Math.floor(rnd() * 16)
  const randY = () => -3 + 2 * Math.floor(rnd() * 5)
  const inside = (p) => p[0] >= X[0] && p[0] <= X[1] && p[2] >= X[0] && p[2] <= X[1] && p[1] >= Y[0] && p[1] <= Y[1]
  for (let w = 0; w < walks; w++) {
    let p = [randX(), randY(), randX()]
    addNode(p)
    const steps = 6 + Math.floor(rnd() * 9)
    for (let k = 0; k < steps; k++) {
      let q = null
      for (let tries = 0; tries < 8 && !q; tries++) {
        const c = p.slice()
        const r = rnd()
        const dir = rnd() < 0.5 ? -2 : 2
        if (r < 0.08) {
          c[0] += dir
          c[2] += rnd() < 0.5 ? -2 : 2
        } else if (r < 0.48) c[0] += dir
        else if (r < 0.88) c[2] += dir
        else c[1] += dir
        if (inside(c)) q = c
      }
      if (!q) break
      const key = [p.join(','), q.join(',')].sort().join('|')
      segs.add(key)
      addNode(q)
      p = q
    }
  }
  const pos = []
  for (const key of segs) {
    const [a, b] = key.split('|').map((t) => t.split(',').map(Number))
    pos.push(...a, ...b)
  }
  const mat = lineMaterial(globals, {
    uProgress: { value: 1 },
    uAlpha: { value: 0 },
  }, /* glsl */ `
    #include <igloo_globals>
    #include <igloo_common>
    uniform float uProgress;
    uniform float uAlpha;
    attribute float aSeed;
    varying float vAlpha;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      float wave = falloff(length(w.xyz), 0.0, 20.0, 5.0, uProgress);
      vAlpha = wave * (sin(aSeed * 13.0 + uTime * 6.0) * 0.35 + 0.65) * uAlpha;
      gl_Position = projectionMatrix * viewMatrix * w;
    }
  `)
  const cage = new LineSegments(lineGeometry(new Float32Array(pos)), mat)
  cage.name = 'iglooCage'
  cage.renderOrder = 999
  cage.frustumCulled = false
  cage.matrixAutoUpdate = false
  cage.visible = false
  cage.userData.nodes = [...nodes.values()]
  return cage
}
