"""Bangun aset lembah salju (M2) secara deterministik di Blender headless.

Pakai (dari root projek):
  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --factory-startup \
      --python tools/blender/build_valley.py -- [--quick]

Isi:
  ground   : heightfield 24 x 24 m (koordinat three: x, z), plateau rata r < 3.2 untuk igloo, gundukan depan.
  mountain : heightfield 20 x 23 m, punggung terkikis angin, tinggi maks ~3 m, tepi turun ke 0.
Untuk tiap heightfield: mesh rapat untuk bake Cycles, lalu salinan di-decimate untuk web.
UV = proyeksi atas dari posisi lokal, jadi shader bisa menghitung UV sendiri dan decimate tidak merusaknya:
  u = x / sizeX + 0.5,   v = 0.5 - z / sizeZ   (cocok dengan TextureLoader flipY default three)

Output:
  tools/blender/out/ground.glb, mountain.glb        (tanpa normal, tanpa UV, tanpa material; Draco menyusul)
  public/assets/textures/ground_color.png    2048   bake diffuse (langsung + tidak langsung), tanpa igloo
  public/assets/textures/ground_glow.png     1024   hanya cahaya titik dari posisi igloo
  public/assets/textures/mountain_color.png  2048
Pencahayaan: matahari dari +x (kanan layar di titik istirahat kamera), elevasi 32 derajat, energi 0.66,
langit lavender kekuatan 0.09 (eksposur diatur supaya rata-rata bake tanah sekitar 0.5 sRGB).
"""
import math
import os
import sys
import time

import bpy
import numpy as np

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
QUICK = '--quick' in ARGS
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_GEO = os.path.join(ROOT, 'tools', 'blender', 'out')
OUT_TEX = os.path.join(ROOT, 'public', 'assets', 'textures')
os.makedirs(OUT_GEO, exist_ok=True)
os.makedirs(OUT_TEX, exist_ok=True)

SAMPLES = 16 if QUICK else 64
TEX_HI = 512 if QUICK else 2048
TEX_LO = 256 if QUICK else 1024
GRID = 160 if QUICK else 400
# Eksposur bake: target rata-rata tanah sekitar 0.5 sRGB (bake igloo 0.46 sampai 0.52), LUT yang menaikkan kontras.
SKY_STRENGTH = 0.09


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


def fbm(x, y, octaves=5, seed=0.0, lac=2.03, gain=0.5):
    v = np.zeros_like(x); amp = 0.5; f = 1.0
    for o in range(octaves):
        v += vnoise(x * f, y * f, seed + o * 13.1) * amp
        f *= lac; amp *= gain
    return v


def ridged(x, y, octaves=5, seed=0.0):
    v = np.zeros_like(x); amp = 0.5; f = 1.0
    for o in range(octaves):
        n = 1 - np.abs(vnoise(x * f, y * f, seed + o * 7.7) * 2 - 1)
        v += n * n * amp
        f *= 2.1; amp *= 0.5
    return v


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ---------- heightfield (koordinat three: x ke kanan, z ke arah kamera, y ke atas) ----------
def ground_height(x, z):
    warp = fbm(x * 0.08, z * 0.08, 3, 5.0) * 4.0
    base = (fbm(x / 9.0, z / 9.0, 4, 1.0) - 0.5) * 1.1
    dunes = (ridged((x + warp) / 4.5, z / 6.5, 4, 2.0) - 0.35) * 0.5
    sastrugi = (ridged(x * 0.9 + warp * 0.3, z * 0.25, 3, 3.0) - 0.4) * 0.08
    micro = (fbm(x * 1.7, z * 1.7, 4, 4.0) - 0.5) * 0.06
    h = base + dunes + sastrugi + micro
    # gundukan salju di depan (arah kamera istirahat: -x, +z), komposisi seperti ref 03
    for cx, cz, amp, rad in [(-6.5, 5.5, 0.75, 2.6), (-3.5, 8.5, 0.6, 2.2), (-9.0, 1.0, 0.55, 3.0),
                             (2.5, 7.5, 0.45, 2.4), (5.5, 2.5, 0.4, 2.8), (-2.0, -6.0, 0.6, 3.2)]:
        h += amp * np.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * rad * rad))
    # plateau rata untuk igloo + tanggul tipis di sekelilingnya
    r = np.sqrt(x * x + z * z)
    plateau = -0.5 + micro * 0.4
    h = plateau + (h - plateau) * smoothstep(3.0, 4.8, r)
    h += 0.12 * np.exp(-((r - 3.7) ** 2) / 0.35)
    return np.clip(h, -1.45, 1.1)


def mountain_height(x, z):
    r = np.sqrt((x / 10.0) ** 2 + (z / 11.5) ** 2)
    fall = np.clip(1 - r, 0, 1) ** 1.4
    warp = fbm(x * 0.12, z * 0.12, 3, 9.0) * 3.0
    peaks = ridged((x + warp) * 0.11, (z - warp) * 0.11, 6, 11.0)
    carve = (ridged(x * 0.6 + warp, z * 0.18, 3, 12.0) - 0.4) * 0.12
    h = (peaks * 4.2 + carve) * fall - 0.15
    return np.clip(h, -0.15, 3.1)


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


def snow_material(name, albedo=(0.86, 0.88, 0.93)):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*albedo, 1)
    bsdf.inputs['Roughness'].default_value = 0.92
    # butiran salju lewat bump noise
    tex = nt.nodes.new('ShaderNodeTexNoise')
    tex.inputs['Scale'].default_value = 60.0
    tex.inputs['Detail'].default_value = 6.0
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs["Strength"].default_value = 0.3
    nt.links.new(tex.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def set_world(color, strength):
    w = bpy.data.worlds.new('World')
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (*color, 1)
    bg.inputs['Strength'].default_value = strength
    bpy.context.scene.world = w


def add_sun(elev_deg=32, azim_deg=8, energy=0.66, angle_deg=9):
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
    # ---- tanah ----
    reset_scene()
    set_world((0.62, 0.66, 0.78), SKY_STRENGTH)
    add_sun()
    g = make_heightfield('ground', 24, 24, GRID, ground_height)
    g.data.materials.append(snow_material('snow'))
    bake(g, os.path.join(OUT_TEX, 'ground_color.png'), TEX_HI)
    # glow: dunia gelap, hanya lampu titik dari posisi igloo
    bpy.context.scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.0
    bpy.data.objects['Sun'].hide_render = True
    pl = bpy.data.lights.new('IglooGlow', 'POINT')
    pl.energy = 1400
    pl.shadow_soft_size = 1.2
    pl.color = (0.78, 0.86, 1.0)
    plo = bpy.data.objects.new('IglooGlow', pl)
    plo.location = (0, 0, 0.6)
    bpy.context.scene.collection.objects.link(plo)
    bake(g, os.path.join(OUT_TEX, 'ground_glow.png'), TEX_LO)
    export_decimated(g, os.path.join(OUT_GEO, 'ground.glb'), 24, 24, 5000)

    # ---- gunung ----
    reset_scene()
    set_world((0.62, 0.66, 0.78), SKY_STRENGTH)
    add_sun(elev_deg=28, azim_deg=20)
    m = make_heightfield('mountain', 20, 23, GRID, mountain_height)
    m.data.materials.append(snow_material('snow_m', albedo=(0.8, 0.83, 0.9)))
    bake(m, os.path.join(OUT_TEX, 'mountain_color.png'), TEX_HI)
    export_decimated(m, os.path.join(OUT_GEO, 'mountain.glb'), 20, 23, 3000)
    print(f'[done] {time.time() - t0:.1f}s', flush=True)


main()
