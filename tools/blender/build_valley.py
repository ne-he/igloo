"""Bangun aset lembah salju (M2) secara deterministik di Blender headless.

Pakai (dari root projek):
  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --factory-startup \
      --python tools/blender/build_valley.py -- [--quick] [--only ground|mountain]
Lalu:  python tools/blender/finalize.py   (PNG -> WebP, glb -> Draco)

Isi:
  ground   : heightfield 24 x 24 m (koordinat three: x, z). Plateau rata r < 2.9 untuk igloo (kaki igloo y -0.55),
             koridor rendah ke arah kamera (dataran depan igloo terlihat), gundukan besar kiri depan, punggung kanan
             di belakang terowongan, tanjakan di belakang. Posisi fitur ditulis relatif kamera istirahat (A, B).
  mountain : heightfield 20 x 23 m, massif membulat + punggung ridged multifractal, tinggi maks ~3 m, tepi turun ke 0.
Untuk tiap heightfield: mesh rapat untuk bake Cycles, lalu salinan di-decimate untuk web.
UV = proyeksi atas dari posisi lokal, jadi shader bisa menghitung UV sendiri dan decimate tidak merusaknya:
  u = x / sizeX + 0.5,   v = 0.5 - z / sizeZ   (cocok dengan TextureLoader flipY default three)

Output:
  tools/blender/out/ground.glb, mountain.glb        (tanpa normal, tanpa UV, tanpa material; Draco menyusul)
  public/assets/textures/ground_color.png    2048   bake diffuse (langsung + tidak langsung), tanpa igloo
  public/assets/textures/ground_glow.png     1024   hanya cahaya titik dari posisi igloo
  public/assets/textures/mountain_color.png  2048
Pencahayaan: matahari dari +x (kanan layar di titik istirahat kamera), elevasi 27 derajat, bayangan lembut,
langit lavender untuk isi bayangan. Eksposur dinaikkan (v2): scene dirender terang dan datar, LUT scene igloo
yang memberi kontras (blueprint 2 nomor 8). Target rata-rata bake tanah sekitar 0.6 sRGB, gunung sekitar 0.65.
"""
import math
import os
import sys
import time

import bpy
import numpy as np

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
QUICK = '--quick' in ARGS
ONLY = ARGS[ARGS.index('--only') + 1] if '--only' in ARGS else None
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_GEO = os.path.join(ROOT, 'tools', 'blender', 'out')
OUT_TEX = os.path.join(ROOT, 'public', 'assets', 'textures')
os.makedirs(OUT_GEO, exist_ok=True)
os.makedirs(OUT_TEX, exist_ok=True)

SAMPLES = 16 if QUICK else 64
TEX_HI = 512 if QUICK else 2048
TEX_LO = 256 if QUICK else 1024
GRID = 160 if QUICK else 400
# Eksposur bake (v2, lebih terang dari v1 yang rata-ratanya 0.41 dan jadi hampir hitam setelah LUT).
# Nilai ini juga dipakai build_igloo.py (add_sun() tanpa argumen + SKY_STRENGTH), jadi bake igloo ikut sama.
SUN_ENERGY = 1.35
SUN_ELEV = 27
SKY_COLOR = (0.62, 0.66, 0.78)
SKY_STRENGTH = 0.15
GLOW_ENERGY = 650


# ---------- noise numpy (deterministik) ----------
def _hash(ix, iy, seed):
    h = np.sin(ix * 127.1 + iy * 311.7 + seed * 74.7) * 43758.5453
    return h - np.floor(h)


def vnoise(x, y, seed=0.0):
    ix, iy = np.floor(x), np.floor(y)
    fx, fy = x - ix, y - iy
    ux, uy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    a = _hash(ix, iy, seed); b = _hash(ix + 1, iy, seed)
    c = _hash(ix, iy + 1, seed); d = _hash(ix + 1, iy + 1, seed)
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy


def gnoise(x, y, seed=0.0):
    """Noise gradient (Perlin) 2D, hasil kira-kira -0.7..0.7, lebih halus dari value noise (tanpa pola grid)."""
    ix, iy = np.floor(x), np.floor(y)
    fx, fy = x - ix, y - iy

    def grad(cx, cy, dx, dy):
        a = _hash(cx, cy, seed) * 6.2831853
        return np.cos(a) * dx + np.sin(a) * dy

    ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
    uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
    n00 = grad(ix, iy, fx, fy); n10 = grad(ix + 1, iy, fx - 1, fy)
    n01 = grad(ix, iy + 1, fx, fy - 1); n11 = grad(ix + 1, iy + 1, fx - 1, fy - 1)
    return (n00 + (n10 - n00) * ux) + ((n01 + (n11 - n01) * ux) - (n00 + (n10 - n00) * ux)) * uy


def fbm(x, y, octaves=5, seed=0.0, lac=2.03, gain=0.5):
    v = np.zeros_like(x); amp = 0.5; f = 1.0
    for o in range(octaves):
        v += vnoise(x * f, y * f, seed + o * 13.1) * amp
        f *= lac; amp *= gain
    return v


def gfbm(x, y, octaves=5, seed=0.0, lac=2.03, gain=0.5):
    v = np.zeros_like(x); amp = 0.5; f = 1.0
    for o in range(octaves):
        v += gnoise(x * f, y * f, seed + o * 13.1) * amp
        f *= lac; amp *= gain
    return v


def ridged(x, y, octaves=5, seed=0.0):
    v = np.zeros_like(x); amp = 0.5; f = 1.0
    for o in range(octaves):
        n = 1 - np.abs(vnoise(x * f, y * f, seed + o * 7.7) * 2 - 1)
        v += n * n * amp
        f *= 2.1; amp *= 0.5
    return v


def ridged_mf(x, y, octaves=6, seed=0.0, lac=2.05, gain=2.0, offset=1.0):
    """Ridged multifractal (Musgrave): punggung tajam, lembah halus. Hasil kira-kira 0..1."""
    v = np.zeros_like(x); w = np.ones_like(x); f = 1.0; amp = 1.0; tot = 0.0
    for o in range(octaves):
        s = offset - np.abs(gnoise(x * f, y * f, seed + o * 5.3)) * 1.6
        s = s * s * w
        v += s * amp
        tot += amp
        w = np.clip(s * gain, 0, 1)
        f *= lac; amp *= 0.5
    return v / tot


def soft_max(h, knee, top):
    """Puncak dibulatkan (bukan dipotong rata): di atas knee, h mendekati top secara asimtotik."""
    over = np.maximum(h - knee, 0)
    return np.where(h > knee, knee + (top - knee) * np.tanh(over / (top - knee)), h)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# arah kamera istirahat di bidang xz (blueprint 6.4): A = dari igloo ke arah kamera, B = ke kanan layar
CAM_TOWARD = (-0.683, 0.730)
SCREEN_RIGHT = (0.730, 0.683)

# Fitur komposisi tanah (koordinat A, B relatif kamera istirahat), ditiru dari ref 03:
# (A, B, tinggi, sigma A, sigma B). Tinggi dihitung dari dasar -0.5 (= plateau igloo).
GROUND_FEATURES = [
    (4.4, -3.6, 1.45, 1.4, 1.8),   # gundukan besar kiri depan (puncaknya kira-kira setinggi kaki igloo di layar)
    (6.0, -6.4, 0.95, 1.8, 1.6),   # menyambung ke tepi kiri
    (0.0, 5.3, 1.05, 2.2, 1.2),    # punggung kanan di belakang terowongan
    (-2.8, 7.2, 0.85, 2.0, 1.6),   # punggung kanan jauh
    (-8.0, -2.5, 0.75, 2.5, 3.0),  # tanjakan belakang kiri (jauh, tidak jadi bibir mangkuk)
    (-6.8, 4.2, 0.70, 2.2, 2.5),   # belakang kanan
    (7.6, -1.8, 0.45, 1.0, 1.3),   # gundukan kecil latar depan
    (8.0, 1.6, 0.40, 1.1, 1.2),
    (6.8, 4.6, 0.65, 1.3, 1.5),    # latar depan kanan
]


def ground_height(x, z):
    A = x * CAM_TOWARD[0] + z * CAM_TOWARD[1]
    B = x * SCREEN_RIGHT[0] + z * SCREEN_RIGHT[1]
    r = np.sqrt(x * x + z * z)
    warp = gfbm(x * 0.09, z * 0.09, 3, 5.0) * 5.0
    # dekat igloo tenang (tanah setinggi plateau), makin jauh makin bergelombang: igloo tidak duduk di mangkuk
    calm = smoothstep(3.0, 7.5, r)
    base = gfbm(x / 10.0, z / 10.0, 4, 1.0) * 0.6 * calm
    # punggung salju memanjang searah angin (dari +x), tepi tajam ala sastrugi
    drifts = (ridged_mf((x + warp) / 5.0, (z + warp * 0.3) / 2.2, 4, 2.0) - 0.45) * 0.35 * (0.35 + 0.65 * calm)
    sastrugi = (ridged_mf(x * 0.35 + warp * 0.2, z * 1.1, 3, 3.0) - 0.45) * 0.09
    micro = gfbm(x * 1.6, z * 1.6, 4, 4.0) * 0.07
    h = -0.5 + base + drifts + sastrugi + micro + 0.3 * smoothstep(6.0, 11.0, r)
    for a0, b0, amp, sa, sb in GROUND_FEATURES:
        h += amp * np.exp(-((A - a0) ** 2 / (2 * sa * sa) + (B - b0) ** 2 / (2 * sb * sb)))
    # koridor depan (igloo -> kamera) sedikit lebih rendah supaya dataran di depan kaki igloo kelihatan
    corridor = np.exp(-(B * B) / (2 * 2.0 ** 2)) * smoothstep(2.5, 3.5, A) * (1 - smoothstep(6.0, 8.0, A))
    h = h + (-0.6 + micro - h) * corridor * 0.8
    # plateau rata untuk igloo (kaki igloo di y -0.55), cukup lebar untuk terowongan (z sampai ~3.3)
    plateau = -0.5 + micro * 0.3
    h = plateau + (h - plateau) * smoothstep(3.0, 4.6, r)
    return np.clip(soft_max(h, 0.6, 1.12), -1.45, 1.12)


def mountain_height(x, z):
    u, v = x / 10.0, z / 11.5
    r = np.sqrt(u * u + v * v)
    fall = smoothstep(1.0, 0.55, r)
    warp = gfbm(x * 0.1, z * 0.1, 3, 9.0) * 4.0
    # massif membulat: puncak utama + bahu panjang ke satu sisi
    dome = np.exp(-((u + 0.05) ** 2 + (v - 0.02) ** 2) / (2 * 0.30 ** 2))
    shoulder = np.exp(-((u - 0.38) ** 2 / (2 * 0.28 ** 2) + (v + 0.1) ** 2 / (2 * 0.2 ** 2)))
    ridges = ridged_mf((x + warp) * 0.15, (z - warp) * 0.15, 5, 11.0)
    gully = gfbm(x * 0.45 + warp, z * 0.12, 4, 12.0) * 0.15
    h = (dome * 1.9 + shoulder * 0.8 + ridges * 1.2 * (0.35 + dome) + gully) * fall - 0.15
    return np.clip(soft_max(h, 2.2, 3.05), -0.15, 3.1)


# ---------- helper Blender ----------
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = SAMPLES
    sc.render.bake.margin = 16
    sc.view_settings.view_transform = 'Standard'
    return sc


def make_heightfield(name, size_x, size_z, res, fn):
    xs = np.linspace(-size_x / 2, size_x / 2, res + 1)
    zs = np.linspace(-size_z / 2, size_z / 2, res + 1)
    X, Z = np.meshgrid(xs, zs)
    H = fn(X, Z)
    # three (x, y, z) -> Blender (x, -z, y)
    verts = np.stack([X.ravel(), -Z.ravel(), H.ravel()], -1)
    idx = np.arange((res + 1) * (res + 1)).reshape(res + 1, res + 1)
    a = idx[:-1, :-1].ravel(); b = idx[:-1, 1:].ravel(); c = idx[1:, 1:].ravel(); d = idx[1:, :-1].ravel()
    faces = np.stack([a, d, c, b], -1)  # urutan supaya normal menghadap ke atas (+Z Blender)
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts.tolist(), [], faces.tolist())
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    set_planar_uv(obj, size_x, size_z)
    for p in me.polygons:
        p.use_smooth = True
    return obj


def set_planar_uv(obj, size_x, size_z):
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    co = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    vi = np.zeros(len(me.loops), dtype=np.int64)
    me.loops.foreach_get('vertex_index', vi)
    x = co[vi, 0]; zthree = -co[vi, 1]
    u = x / size_x + 0.5
    v_blender = 0.5 + (-zthree) / size_z  # gambar Blender: v=0 di bawah. Lihat docstring untuk pemetaan di three.
    me.uv_layers[0].data.foreach_set('uv', np.stack([u, v_blender], -1).ravel())


def snow_material(name, albedo=(0.86, 0.88, 0.93), rock=(0.30, 0.31, 0.36), rock_amount=1.0):
    """Salju Principled + bump butiran. Albedo bervariasi: batu gelap di lereng curam (sebagian saja, lewat
    masker noise) dan kerikil kecil jarang, seperti ref (salju bersih dengan sedikit batu)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    N = nt.nodes.new
    L = nt.links.new
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Roughness'].default_value = 0.92
    # butiran salju lewat bump noise
    tex = N('ShaderNodeTexNoise')
    tex.inputs['Scale'].default_value = 60.0
    tex.inputs['Detail'].default_value = 6.0
    bump = N('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.3
    L(tex.outputs['Fac'], bump.inputs['Height'])
    L(bump.outputs['Normal'], bsdf.inputs['Normal'])

    coord = N('ShaderNodeTexCoord')

    def map_range(src, a0, a1, b0=0.0, b1=1.0):
        m = N('ShaderNodeMapRange')
        m.clamp = True
        m.inputs['From Min'].default_value = a0
        m.inputs['From Max'].default_value = a1
        m.inputs['To Min'].default_value = b0
        m.inputs['To Max'].default_value = b1
        L(src, m.inputs['Value'])
        return m.outputs['Result']

    def op(kind, x, y):
        m = N('ShaderNodeMath')
        m.operation = kind
        for i, v in enumerate((x, y)):
            if isinstance(v, (int, float)):
                m.inputs[i].default_value = v
            else:
                L(v, m.inputs[i])
        return m.outputs['Value']

    def noise(scale, detail=3.0):
        t = N('ShaderNodeTexNoise')
        t.inputs['Scale'].default_value = scale
        t.inputs['Detail'].default_value = detail
        L(coord.outputs['Object'], t.inputs['Vector'])
        return t.outputs['Fac']

    # lereng curam (normal geometri, tanpa bump), hanya di luar plateau igloo
    geo = N('ShaderNodeNewGeometry')
    sep = N('ShaderNodeSeparateXYZ')
    L(geo.outputs['Normal'], sep.inputs['Vector'])
    slope = map_range(sep.outputs['Z'], 0.86, 0.7)
    dist = N('ShaderNodeVectorMath')
    dist.operation = 'LENGTH'
    L(coord.outputs['Object'], dist.inputs[0])
    away = map_range(dist.outputs['Value'], 4.5, 6.0)
    patches = map_range(noise(0.35), 0.5, 0.62)
    rocks = op('MULTIPLY', op('MULTIPLY', slope, patches), away)
    # kerikil: titik voronoi kecil, hanya di sebagian area
    vor = N('ShaderNodeTexVoronoi')
    vor.inputs['Scale'].default_value = 14.0
    L(coord.outputs['Object'], vor.inputs['Vector'])
    dots = map_range(vor.outputs['Distance'], 0.02, 0.09, 1.0, 0.0)
    stones = op('MULTIPLY', op('MULTIPLY', dots, map_range(noise(0.6), 0.52, 0.62)), 0.75)
    stones = op('MULTIPLY', stones, away)
    mask = op('MULTIPLY', op('MAXIMUM', rocks, stones), rock_amount)
    ramp = N('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*albedo, 1)
    ramp.color_ramp.elements[1].color = (*rock, 1)
    L(mask, ramp.inputs['Fac'])
    L(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    return mat


def set_world(color, strength):
    w = bpy.data.worlds.new('World')
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (*color, 1)
    bg.inputs['Strength'].default_value = strength
    bpy.context.scene.world = w


def add_sun(elev_deg=SUN_ELEV, azim_deg=8, energy=SUN_ENERGY, angle_deg=12):
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = energy
    sun.angle = math.radians(angle_deg)
    sun.color = (1.0, 0.985, 0.96)
    obj = bpy.data.objects.new('Sun', sun)
    bpy.context.scene.collection.objects.link(obj)
    # arah cahaya datang dari +x three (= +x Blender), sedikit dari belakang
    el, az = math.radians(elev_deg), math.radians(azim_deg)
    d = np.array([math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)])  # arah KE matahari
    obj.rotation_mode = 'QUATERNION'
    from mathutils import Vector
    obj.rotation_quaternion = Vector(-d).to_track_quat('-Z', 'Y')
    return obj


def bake(obj, path, size, filt=('DIRECT', 'INDIRECT', 'COLOR')):
    img = bpy.data.images.new(os.path.basename(path), size, size, alpha=False, float_buffer=True)
    img.colorspace_settings.name = 'sRGB'
    mat = obj.active_material
    nt = mat.node_tree
    node = nt.nodes.new('ShaderNodeTexImage')
    node.image = img
    for n in nt.nodes:
        n.select = False
    node.select = True
    nt.nodes.active = node
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    t0 = time.time()
    bpy.ops.object.bake(type='DIFFUSE', pass_filter=set(filt), margin=16, use_clear=True)
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    nt.nodes.remove(node)
    print(f'[bake] {os.path.relpath(path, ROOT)} {size}px {time.time() - t0:.1f}s', flush=True)


def export_decimated(obj, path, size_x, size_z, target_tris):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    mod = obj.modifiers.new('dec', 'DECIMATE')
    mod.ratio = min(1.0, target_tris / tris)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    set_planar_uv(obj, size_x, size_z)
    out_tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB', export_yup=True,
                              export_normals=False, export_texcoords=False, export_materials='NONE',
                              export_apply=True)
    print(f'[export] {os.path.relpath(path, ROOT)} {out_tris} tris, {os.path.getsize(path) / 1024:.1f} KB', flush=True)


def main():
    t0 = time.time()
    if ONLY in (None, 'ground'):
        # ---- tanah ----
        reset_scene()
        set_world(SKY_COLOR, SKY_STRENGTH)
        add_sun()
        g = make_heightfield('ground', 24, 24, GRID, ground_height)
        g.data.materials.append(snow_material('snow'))
        bake(g, os.path.join(OUT_TEX, 'ground_color.png'), TEX_HI)
        # glow: dunia gelap, hanya lampu titik dari posisi igloo
        bpy.context.scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.0
        bpy.data.objects['Sun'].hide_render = True
        pl = bpy.data.lights.new('IglooGlow', 'POINT')
        pl.energy = GLOW_ENERGY
        pl.shadow_soft_size = 1.2
        pl.color = (0.78, 0.86, 1.0)
        plo = bpy.data.objects.new('IglooGlow', pl)
        plo.location = (0, 0, 0.6)
        bpy.context.scene.collection.objects.link(plo)
        bake(g, os.path.join(OUT_TEX, 'ground_glow.png'), TEX_LO)
        export_decimated(g, os.path.join(OUT_GEO, 'ground.glb'), 24, 24, 5000)

    if ONLY in (None, 'mountain'):
        # ---- gunung ----
        reset_scene()
        set_world(SKY_COLOR, SKY_STRENGTH * 1.15)
        add_sun(elev_deg=26, azim_deg=20, energy=SUN_ENERGY * 1.1)
        m = make_heightfield('mountain', 20, 23, GRID, mountain_height)
        m.data.materials.append(snow_material('snow_m', albedo=(0.86, 0.88, 0.94), rock_amount=0.45))
        bake(m, os.path.join(OUT_TEX, 'mountain_color.png'), TEX_HI)
        export_decimated(m, os.path.join(OUT_GEO, 'mountain.glb'), 20, 23, 3000)
    print(f'[done] {time.time() - t0:.1f}s', flush=True)


main()
