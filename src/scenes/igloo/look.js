import { Color, Mesh, Group, SphereGeometry, PlaneGeometry, ShaderMaterial, BackSide } from 'three'
import '../../glsl/chunks.js'

// Look kit scene igloo (M0.5 palette test). Semua unlit: tanpa lampu, tanpa scene.fog (blueprint 4.3).
// Warna langit/kabut = data hasil bedah (blueprint 4.4).
export const SKY = { dark: new Color('#afb6c7'), light: new Color('#d1d6e3'), intro: new Color('#b3bac9') }

export function skyUniforms() {
  return { uSkyDark: { value: SKY.dark }, uSkyLight: { value: SKY.light } }
}

/**
 * Langit: sphere r800 BackSide, warnanya gradient diagonal layar (abaikan geometri).
 * Intro: uProgress 0 -> 1 (3 s di detik 1.5) membaurkan warna intro #b3bac9 ke gradient. Default 1.
 */
export function createSky(globals) {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: { ...globals, ...skyUniforms(), uSkyIntro: { value: SKY.intro }, uProgress: { value: 1 } },
    vertexShader: /* glsl */ `
      void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      #include <igloo_globals>
      #include <igloo_skygradient>
      uniform vec3 uSkyIntro;
      uniform float uProgress;
      void main() {
        vec3 c = mix(uSkyIntro, skyGradient(gl_FragCoord.xy / uResolution), clamp(uProgress, 0.0, 1.0));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  })
  const sky = new Mesh(new SphereGeometry(800, 12, 12), mat)
  sky.name = 'sky'
  sky.rotation.set((16 * Math.PI) / 180, 0, (-16 * Math.PI) / 180)
  sky.scale.x = -1
  sky.renderOrder = -10
  return sky
}

// Fungsi kabut gunung: tinggi + jarak, warnanya gradient langit yang sama.
const FOG_GLSL = /* glsl */ `
  vec3 applyMountainFog(vec3 color, float worldY, float viewZ, vec2 screenUv) {
    float fog = clamp(1.0 - worldY * 0.05 - 0.5, 0.0, 1.0) + clamp(-viewZ * 0.005, 0.0, 1.0) * 0.75;
    fog = clamp(fog, 0.0, 1.0);
    vec3 fogColor = skyGradient(screenUv) * 1.1 + smoothstep(0.5, 1.0, color.r);
    return mix(color, fogColor, fog);
  }
`

/** Noise JS kecil untuk displacement gunung (deterministik). */
function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
  return s - Math.floor(s)
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const xf = x - xi, yf = y - yi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
function ridged(x, y) {
  let v = 0, amp = 0.5, f = 1
  for (let i = 0; i < 6; i++) {
    const n = 1 - Math.abs(vnoise(x * f, y * f) * 2 - 1)
    v += n * n * amp
    f *= 2.1
    amp *= 0.5
  }
  return v
}

/** Gunung prosedural (pengganti aset Blender sampai M2): bidang terdisplace ridged noise + kabut langit. */
export function createMountain(globals, { seed = 0, size = 40, height = 8 } = {}) {
  const geo = new PlaneGeometry(size, size, 96, 96)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i)
    const r = Math.hypot(x, z) / (size * 0.5)
    const falloff = Math.max(0, 1 - r * r)
    pos.setY(i, ridged(x * 0.06 + seed, z * 0.06 - seed) * height * falloff * falloff - 0.3)
  }
  geo.computeVertexNormals()
  const mat = new ShaderMaterial({
    uniforms: { ...globals, ...skyUniforms(), uBase: { value: new Color('#6f7586') }, uTop: { value: new Color('#b5bbc9') } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vViewZ;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 mv = viewMatrix * w;
        vViewZ = mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      #include <igloo_globals>
      #include <igloo_skygradient>
      #include <igloo_noise>
      uniform vec3 uBase;
      uniform vec3 uTop;
      varying vec3 vWorld;
      varying vec3 vNormal;
      varying float vViewZ;
      ${FOG_GLSL}
      void main() {
        // "bake" palsu: arah matahari tetap + rongga noise, pengganti lightmap Cycles
        vec3 L = normalize(vec3(-0.4, 0.8, 0.45));
        float diff = clamp(dot(normalize(vNormal), L) * 0.6 + 0.45, 0.0, 1.0);
        float grain = fbm(vWorld.xz * 0.35) * 0.25 + 0.75;
        vec3 c = mix(uBase, uTop, diff) * grain;
        c = applyMountainFog(c, vWorld.y, vViewZ, gl_FragCoord.xy / uResolution);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  })
  return new Mesh(geo, mat)
}

/** Tanah salju prosedural: relief noise sebagai shading, coretan angin, tepi memudar ke langit. */
export function createGround(globals) {
  const geo = new PlaneGeometry(140, 140, 1, 1)
  geo.rotateX(-Math.PI / 2)
  const mat = new ShaderMaterial({
    transparent: true,
    depthWrite: true,
    uniforms: { ...globals, ...skyUniforms(), uDark: { value: new Color('#4f5466') }, uLight: { value: new Color('#a3a9b9') } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      #include <igloo_globals>
      #include <igloo_skygradient>
      #include <igloo_noise>
      uniform vec3 uDark;
      uniform vec3 uLight;
      varying vec3 vWorld;
      float height(vec2 p) { return fbm(p * 0.45) * 1.2 + fbm(p * 2.3) * 0.18; }
      void main() {
        vec2 p = vWorld.xz;
        float e = 0.05;
        float h = height(p);
        vec3 n = normalize(vec3(height(p - vec2(e, 0.0)) - height(p + vec2(e, 0.0)), 2.0 * e * 3.0,
                                height(p - vec2(0.0, e)) - height(p + vec2(0.0, e))));
        vec3 L = normalize(vec3(-0.4, 0.8, 0.45));
        float diff = clamp(dot(n, L) * 0.9 + 0.25, 0.0, 1.0);
        vec3 c = mix(uDark, uLight, diff);
        // coretan angin: dua lookup noise memanjang yang bergerak, dikalikan
        float w1 = vnoise(vec2(p.x * 0.15, p.y * 0.6) - uTime * 0.15);
        float w2 = vnoise(vec2(p.x * 0.17, p.y * 0.7) - uTime * 0.15 + 3.1);
        c = mix(c, vec3(1.0), clamp(w1 * w2 - 0.25, 0.0, 1.0) * 0.35);
        float r = length(p);
        float fade = 1.0 - smoothstep(22.0, 60.0, r);
        gl_FragColor = vec4(mix(skyGradient(gl_FragCoord.xy / uResolution), c, fade), 1.0);
      }
    `,
  })
  const ground = new Mesh(geo, mat)
  ground.position.y = -0.55
  return ground
}

/** Pengganti igloo untuk palette test: kubah + terowongan, shading palsu ala bake (sisi gelap + AO bawah). */
export function createIglooStandIn(globals) {
  const mat = new ShaderMaterial({
    uniforms: { ...globals, uColor: { value: new Color('#9ea6bf') }, uShadow: { value: new Color('#727b9c') } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      #include <igloo_noise>
      uniform vec3 uColor;
      uniform vec3 uShadow;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vec3 L = normalize(vec3(-0.4, 0.8, 0.45));
        float diff = clamp(dot(normalize(vNormal), L) * 0.7 + 0.45, 0.0, 1.0);
        float ao = smoothstep(-0.6, 1.2, vWorld.y);
        float grain = fbm(vWorld.xy * 3.0 + vWorld.z) * 0.15 + 0.92;
        vec3 c = mix(uShadow, uColor * 1.35, diff * ao) * grain;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  })
  const group = new Group()
  const dome = new Mesh(new SphereGeometry(2.6, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), mat)
  dome.scale.y = 1.3
  dome.position.y = -0.45
  const tunnel = new Mesh(new SphereGeometry(1.1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat)
  tunnel.scale.set(1, 1.25, 1.6)
  tunnel.position.set(0, -0.45, 2.4)
  group.add(dome, tunnel)
  return group
}
