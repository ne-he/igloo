import { Points, BufferGeometry, Float32BufferAttribute, ShaderMaterial, AdditiveBlending } from 'three'
import '../../glsl/chunks.js'

// Angka intro (blueprint 5.1, skill ref 02 4.8): 252 titik di node lattice cage (+0.1), tiap titik menampilkan
// angka 2 digit dari atlas 32 sel yang berganti dalam gelombang radial, alpha = shockwave radial * 0.5.
// Hanya saat intro: default tersembunyi, uAlpha 0.
export class IntroDigits extends Points {
  constructor(globals, nodes, texture, count = 252) {
    let s = 3
    const rnd = () => {
      s = (s * 16807) % 2147483647
      return (s - 1) / 2147483646
    }
    // node yang dilewati cage dulu, sisanya node lattice acak
    const pool = nodes.slice()
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    while (pool.length < count) {
      pool.push([-15 + 2 * Math.floor(rnd() * 16), -3 + 2 * Math.floor(rnd() * 5), -15 + 2 * Math.floor(rnd() * 16)])
    }
    const pos = new Float32Array(count * 3)
    const seed = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      pos.set([pool[i][0] + 0.1, pool[i][1] + 0.1, pool[i][2] + 0.1], i * 3)
      seed[i] = rnd()
    }
    const geo = new BufferGeometry()
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3))
    geo.setAttribute('aSeed', new Float32BufferAttribute(seed, 1))

    const material = new ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { ...globals, tDigits: { value: texture }, uProgress: { value: 1 }, uAlpha: { value: 0 } },
      vertexShader: /* glsl */ `
        #include <igloo_globals>
        #include <igloo_common>
        uniform float uProgress;
        uniform float uAlpha;
        attribute float aSeed;
        varying float vCell;
        varying float vAlpha;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          float d = length(w.xyz);
          // sel atlas maju seiring progress, tertunda menurut jarak: angka berganti dalam gelombang radial
          vCell = mod(floor(uProgress * 48.0 - d) + floor(aSeed * 32.0), 32.0);
          vAlpha = falloff(d, 0.0, 20.0, 5.0, uProgress) * 0.5 * uAlpha;
          vec4 mv = viewMatrix * w;
          gl_PointSize = uResolution.y / 80.0;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDigits;
        varying float vCell;
        varying float vAlpha;
        void main() {
          vec2 cell = vec2(mod(vCell, 8.0), floor(vCell / 8.0));
          vec2 uv = vec2((cell.x + gl_PointCoord.x) / 8.0, 1.0 - (cell.y + gl_PointCoord.y) / 4.0);
          float a = texture2D(tDigits, uv).a * vAlpha;
          if (a < 0.003) discard;
          gl_FragColor = vec4(0.85, 0.9, 1.0, a);
        }
      `,
    })
    super(geo, material)
    this.name = 'iglooIntroDigits'
    this.renderOrder = 1000
    this.frustumCulled = false
    this.matrixAutoUpdate = false
    this.visible = false
  }
}
