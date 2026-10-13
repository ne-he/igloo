"""Bangun aset scene kristal (M5a) secara deterministik di Blender headless.

Pakai (dari root projek):
  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --factory-startup \
      --python tools/blender/build_crystals.py -- [--quick] [--nobake] [--only crystal1,inner2]
Lalu:  python tools/blender/finalize_crystals.py   (PNG master -> WebP, glb mentah -> glb Draco)

Isi (semua desain sendiri, tidak meniru bentuk/nama aset igloo):
  crystal1  serpih tinggi bergerigi      crystal2  lempeng tebal      crystal3  bongkah gemuk
    Bentuk: kotak dipotong 12 sampai 20 bidang acak (bmesh bisect) -> polihedron cembung dengan faset lebar,
    takik bertingkat (boolean kotak miring di pojok), remesh voxel, lalu "chip" lokal: vertex di dalam bola
    kecil diproyeksikan ke bidang miring (patahan konkoidal yang rata), plus noise halus.
    HIGH = versi rapat + retakan mikro (untuk bake), LOW = decimate ke sekitar 6.5k sampai 7.5k tris.
    Rongga = cangkang dalam (normal menghadap ke dalam rongga) yang digabung ke LOW, tempat objek dalam.
    UV0 (UVMap): smart project untuk normal 2048 + roughness 1024. UV1: unwrap kedua tanpa overlap (frost M5b).
    Bake: normal tangent space dari HIGH (retakan voronoi + remuk di sekitar chip), roughness abu
    bergrain dengan beberapa noda licin (emit bake, Non-Color).
  inner1  tumpukan batu (cairn)      inner2  pita terpilin setengah putaran      inner3  bola berlubang tiga sumbu
    Bake 1024: terang gaya plester (scene kristal) dan gelap rim-lit (detail view, M6).

Output mentah:
  tools/blender/out/crystal{1,2,3}.glb, inner{1,2,3}.glb             (Draco menyusul di finalize)
  tools/blender/out/bakes/crystal{N}_normal.png (2048), crystal{N}_roughness.png (1024)
  tools/blender/out/bakes/inner{N}_color.png, inner{N}_dark_color.png (1024)
Koordinat: three (x, y, z) = Blender (x, -z, y), ekspor export_yup=True. Kamera three di +z = Blender -Y.
"""
import json
import math
import os
import sys
import time

import bmesh
import bpy
import numpy as np
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
QUICK = '--quick' in ARGS
NOBAKE = '--nobake' in ARGS  # iterasi bentuk: geometri resolusi penuh tanpa bake
ONLY = None
for i, a in enumerate(ARGS):
    if a == '--only' and i + 1 < len(ARGS):
        ONLY = set(ARGS[i + 1].split(','))

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_GEO = os.path.join(ROOT, 'tools', 'blender', 'out')
OUT_BAKE = os.path.join(OUT_GEO, 'bakes')
os.makedirs(OUT_BAKE, exist_ok=True)

VOXEL_HI = 0.03 if QUICK else 0.012
NORMAL_RES = 512 if QUICK else 2048
ROUGH_RES = 256 if QUICK else 1024
INNER_RES = 256 if QUICK else 1024
INNER_SAMPLES = 12 if QUICK else 48


# ---------- noise numpy (deterministik) ----------
def _hash3(ix, iy, iz, seed):
    h = np.sin(ix * 127.1 + iy * 311.7 + iz * 74.7 + seed * 19.19) * 43758.5453
    return h - np.floor(h)


def vnoise3(p, seed=0.0):
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    ix, iy, iz = np.floor(x), np.floor(y), np.floor(z)
    fx, fy, fz = x - ix, y - iy, z - iz
    ux, uy, uz = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy), fz * fz * (3 - 2 * fz)
    out = 0.0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (ux if dx else 1 - ux) * (uy if dy else 1 - uy) * (uz if dz else 1 - uz)
                out = out + w * _hash3(ix + dx, iy + dy, iz + dz, seed)
    return out


def fbm3(p, octaves=4, seed=0.0):
    v = np.zeros(len(p)); amp = 0.5; f = 1.0; tot = 0.0
    for o in range(octaves):
        v += vnoise3(p * f, seed + o * 3.7) * amp
        tot += amp; f *= 2.03; amp *= 0.5
    return v / tot


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def unit(v):
    v = np.asarray(v, float)
    return v / max(np.linalg.norm(v), 1e-9)


# ---------- helper Blender ----------
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 4
    sc.render.bake.margin = 16
    sc.view_settings.view_transform = 'Standard'
    return sc


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def obj_from_bm(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(bpy.data.objects.new(name, me))


def obj_from_arrays(name, verts, faces):
    me = bpy.data.meshes.new(name)
    me.from_pydata(np.asarray(verts).tolist(), [], np.asarray(faces).tolist())
    me.validate()
    me.update()
    return link(bpy.data.objects.new(name, me))


def activate(obj, others=()):
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    for o in others:
        o.select_set(True)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply_mod(obj, kind, **kw):
    activate(obj)
    m = obj.modifiers.new(kind.lower(), kind)
    for k, v in kw.items():
        setattr(m, k, v)
    bpy.ops.object.modifier_apply(modifier=m.name)
    return obj


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def get_co(obj):
    me = obj.data
    co = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    return co.reshape(-1, 3)


def set_co(obj, co):
    me = obj.data
    me.vertices.foreach_set('co', np.asarray(co, float).ravel())
    me.update()


def get_vnormals(obj):
    me = obj.data
    n = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('normal', n)
    return n.reshape(-1, 3)


def decimate_to(obj, target):
    t = tri_count(obj)
    if t > target:
        apply_mod(obj, 'DECIMATE', ratio=target / t, use_collapse_triangulate=True)
    return obj


def smart_uv(obj, name, angle_deg, margin):
    me = obj.data
    if name not in me.uv_layers:
        me.uv_layers.new(name=name)
    me.uv_layers.active = me.uv_layers[name]
    activate(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle_deg), island_margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def new_image(name, size, non_color):
    img = bpy.data.images.new(name, size, size, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'
    return img


def target_material(obj, name):
    """Material sederhana di objek target bake, berisi satu node image yang aktif."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    node = mat.node_tree.nodes.new('ShaderNodeTexImage')
    mat.node_tree.nodes.active = node
    return mat, node


def save_bake(img, path):
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()


def export_glb(obj, path, normals=True, uvs=True):
    activate(obj)
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB', export_yup=True,
                              export_normals=normals, export_texcoords=uvs, export_materials='NONE',
                              export_tangents=False, export_attributes=False, export_apply=True)
    print(f'[export] {os.path.relpath(path, ROOT)} {tri_count(obj)} tris, {len(obj.data.vertices)} vert, '
          f'{os.path.getsize(path) / 1024:.1f} KB', flush=True)


# node helper: a/b boleh socket atau angka
def _sock(nt, node_in, v):
    if isinstance(v, (int, float)):
        node_in.default_value = v
    else:
        nt.links.new(v, node_in)


def nmath(nt, op, a, b=0.0, clamp=False):
    n = nt.nodes.new('ShaderNodeMath')
    n.operation = op
    n.use_clamp = clamp
    _sock(nt, n.inputs[0], a)
    _sock(nt, n.inputs[1], b)
    return n.outputs[0]


def noise(nt, coord, scale, detail=2.0, rough=0.5):
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.noise_dimensions = '3D'
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = rough
    nt.links.new(coord, n.inputs['Vector'])
    return n.outputs['Fac']


def maprange(nt, v, a, b, c=0.0, d=1.0, smooth=True):
    n = nt.nodes.new('ShaderNodeMapRange')
    n.interpolation_type = 'SMOOTHSTEP' if smooth else 'LINEAR'
    n.clamp = True
    _sock(nt, n.inputs['Value'], v)
    n.inputs['From Min'].default_value = a
    n.inputs['From Max'].default_value = b
    n.inputs['To Min'].default_value = c
    n.inputs['To Max'].default_value = d
    return n.outputs['Result']


# ======================================================================================
# KRISTAL
# ======================================================================================
# half = setengah ukuran kotak awal (Blender x, y = kedalaman ke arah kamera, z = tinggi).
# cuts = daftar (jumlah, sudut elevasi min/maks derajat, fraksi potong min/maks) per kelompok bidang.
CRYSTALS = {
    'crystal1': dict(  # serpih tinggi bergerigi: ujung atas runcing miring, condong, bawah patah
        seed=11, half=(0.58, 0.5, 1.32), cavity=(0.42, 0.32, 0.78), shear=(0.2, 0.06),
        cuts=[(4, 28, 62, 0.25, 0.5), (3, -68, -30, 0.14, 0.34), (8, -25, 25, 0.1, 0.3)],
        notches=3, notch_size=(0.22, 0.36), chips=56, target=6700,
    ),
    'crystal2': dict(  # lempeng tebal: muka lebar menghadap kamera, pojok dan tepi terpotong
        seed=22, half=(1.1, 0.44, 1.05), cavity=(0.7, 0.3, 0.68), shear=(0.05, 0.0),
        cuts=[(9, -32, 32, 0.07, 0.26), (3, 50, 80, 0.05, 0.18), (2, -80, -50, 0.05, 0.18)],
        notches=4, chips=46, target=6500,
        face_tilt=True,
    ),
    'crystal3': dict(  # bongkah gemuk: pojok dipangkas dalam
        seed=33, half=(0.95, 0.85, 0.9), cavity=(0.6, 0.55, 0.6), shear=(0.0, 0.0),
        cuts=[(8, 18, 50, 0.18, 0.4), (5, -18, 18, 0.07, 0.22), (4, -58, -25, 0.12, 0.3)],
        notches=5, chips=60, target=6900,
    ),
}


def convex_base(cfg, rng):
    """Kotak dipotong bidang acak -> polihedron cembung + daftar bidangnya (untuk masker tepi)."""
    hx, hy, hz = cfg['half']
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * hx, v.co.y * hy, v.co.z * hz))
    planes = [(np.array(n, float), h) for n, h in [((1, 0, 0), hx), ((-1, 0, 0), hx), ((0, 1, 0), hy),
                                                   ((0, -1, 0), hy), ((0, 0, 1), hz), ((0, 0, -1), hz)]]

    def cut(n, frac):
        n = unit(n)
        h = max(Vector(n).dot(v.co) for v in bm.verts)
        d = h * (1 - frac)
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=Vector(n * d),
                               plane_no=Vector(n), clear_outer=True)
        edges = [e for e in bm.edges if e.is_boundary]
        if edges:
            bmesh.ops.contextual_create(bm, geom=edges)
        planes.append((n, d))

    if cfg.get('face_tilt'):
        # muka lebar depan/belakang dibuat tidak sejajar (lempeng terasa dipahat, bukan papan)
        cut((rng.uniform(-0.25, 0.25), -1, rng.uniform(-0.25, 0.25)), 0.12)
        cut((rng.uniform(-0.25, 0.25), 1, rng.uniform(-0.25, 0.25)), 0.1)
    for count, el0, el1, f0, f1 in cfg['cuts']:
        az0 = rng.uniform(0, 2 * math.pi)
        for k in range(count):
            az = az0 + 2 * math.pi * k / count + rng.uniform(-0.35, 0.35)
            el = math.radians(rng.uniform(el0, el1))
            n = (math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el))
            cut(n, rng.uniform(f0, f1))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    # condong (geser x/y sebanding tinggi) supaya serpih tidak berdiri tegak sempurna.
    # Bidang ikut ditransformasi (normal pakai invers-transpos geser) karena dipakai untuk masker tepi.
    sx, sy = cfg.get('shear', (0, 0))
    for v in bm.verts:
        v.co.x += sx * v.co.z
        v.co.y += sy * v.co.z
    sheared = []
    for n, h in planes:
        n2 = np.array([n[0], n[1], n[2] - sx * n[0] - sy * n[1]])
        L = np.linalg.norm(n2)
        sheared.append((n2 / L, h / L))
    return bm, sheared


def add_notches(obj, cfg, rng):
    """Takik bertingkat: boolean kotak miring yang menggigit pojok/tepi polihedron."""
    co = get_co(obj)
    for k in range(cfg['notches']):
        # pilih vertex terjauh di arah acak = pojok
        d = unit(rng.normal(0, 1, 3) * np.array([1, 0.6, 1]))
        p = co[np.argmax(co @ d)]
        s = rng.uniform(*cfg.get('notch_size', (0.35, 0.6)))
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        cutter = obj_from_bm(f'notch{k}', bm)
        cutter.scale = (s * rng.uniform(0.8, 1.6), s * rng.uniform(0.8, 1.6), s * rng.uniform(0.5, 1.1))
        cutter.rotation_euler = tuple(rng.uniform(-0.7, 0.7, 3))
        cutter.location = tuple(p - d * s * rng.uniform(0.0, 0.18))
        activate(obj)
        m = obj.modifiers.new('notch', 'BOOLEAN')
        m.operation = 'DIFFERENCE'
        m.solver = 'EXACT'
        m.object = cutter
        bpy.ops.object.modifier_apply(modifier=m.name)
        bpy.data.objects.remove(cutter)


def keep_largest_part(obj):
    """Buang komponen terpisah selain yang terbesar. Remesh voxel kadang menyisakan cangkang void kecil
    di dalam (sisa boolean takik) yang mengacaukan uji rongga dan bake."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    seen = set()
    parts = []
    for v0 in bm.verts:
        if v0.index in seen:
            continue
        stack, comp = [v0], []
        seen.add(v0.index)
        while stack:
            v = stack.pop()
            comp.append(v)
            for e in v.link_edges:
                w = e.other_vert(v)
                if w.index not in seen:
                    seen.add(w.index)
                    stack.append(w)
        parts.append(comp)
    parts.sort(key=len, reverse=True)
    drop = [v for comp in parts[1:] for v in comp]
    if drop:
        bmesh.ops.delete(bm, geom=drop, context='VERTS')
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return len(parts) - 1


def chip_surface(obj, cfg, planes, rng):
    """Chip lokal: vertex di dalam elips memanjang (tepi bergerigi noise) dan di luar bidang miring
    diproyeksikan ke bidang itu. Hasilnya serpih rata dan teras bertingkat seperti es yang dipukul.
    Pusat chip condong ke tepi polihedron. Mengembalikan masker 'remuk' per vertex."""
    co = get_co(obj)
    nrm = get_vnormals(obj)
    s = np.stack([np.abs(co @ n - h) for n, h in planes], 1)
    s.sort(1)
    edge0 = np.exp(-(s[:, 1] / 0.08) ** 2)
    prob = (0.25 + edge0) / (0.25 + edge0).sum()
    crush = np.zeros(len(co))
    for k in range(cfg['chips']):
        i = rng.choice(len(co), p=prob)
        p, n0 = co[i].copy(), nrm[i]
        at_edge = edge0[i] > 0.3
        n = unit(n0 + rng.normal(0, 0.55 if at_edge else 0.22, 3))
        if n @ n0 < 0.4:
            n = unit(n0 + n)
        depth = rng.uniform(0.03, 0.1) if at_edge else rng.uniform(0.012, 0.045)
        r = rng.uniform(0.14, 0.4)
        # elips memanjang di sepanjang sumbu acak, radius diganggu noise -> garis patahan tidak bulat
        ax = unit(np.cross(n, rng.normal(0, 1, 3)))
        rel = co - p
        along = rel @ ax
        perp = rel - along[:, None] * ax[None, :]
        dist = np.sqrt((along / rng.uniform(1.3, 2.2)) ** 2 + (perp ** 2).sum(1))
        near = dist < r * 1.3
        w = np.zeros(len(co))
        rn = r * (0.75 + 0.5 * fbm3(co[near] * 7.0 + k * 3.1, 3, cfg['seed'] + k))
        w[near] = smoothstep(rn, rn * 0.92, dist[near])
        q = p - n0 * depth
        d = (co - q) @ n
        # dibatasi supaya bidang yang miring tajam tidak menggali tembus volume (jadi teras, bukan jurang)
        push = np.clip(d, 0.0, depth * 1.8 + 0.015) * w
        co -= n[None, :] * push[:, None]
        hit = push > 1e-4
        crush = np.maximum(crush, (w * (1 - w) * 4.0) * hit + 0.3 * hit)
    s = np.stack([np.abs(co @ n - h) for n, h in planes], 1)
    s.sort(1)
    edge = np.exp(-(s[:, 1] / 0.05) ** 2)
    # gelombang halus supaya faset tidak terlalu sempurna
    co += nrm * ((fbm3(co * 3.0, 3, cfg['seed']) - 0.5) * 0.016)[:, None]
    set_co(obj, co)
    return np.clip(np.maximum(crush, edge), 0, 1)


def cavity_shell(cfg, scale=1.0):
    """Rongga = icosphere tak beraturan dengan normal menghadap ke dalam (ke pusat rongga)."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    hx, hy, hz = (c * scale for c in cfg['cavity'])
    for v in bm.verts:
        p = np.array(v.co)
        j = 1 + (vnoise3(p[None] * 2.2, cfg['seed'] + 5)[0] - 0.5) * 0.25
        v.co = Vector((p[0] * hx * j, p[1] * hy * j, p[2] * hz * j))
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    return bm


def fit_cavity(outer, cfg, margin=0.07):
    """Kecilkan rongga sampai semua vertex-nya di dalam kulit luar dengan jarak minimal margin.
    Uji di dalam = 6 sinar sumbu (BVH), minimal 5 harus keluar lewat muka yang menghadap searah sinar.
    (Uji tanda normal titik terdekat tidak andal di dekat dinding chip yang curam.)"""
    from mathutils.bvhtree import BVHTree
    deps = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(outer, deps)
    dirs = [Vector(d) for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))]

    def inside(p):
        good = 0
        for d in dirs:
            hit, nrm, _, _ = tree.ray_cast(p, d)
            if hit is not None and d.dot(nrm) > 0:
                good += 1
        return good >= 5

    scale = 1.0
    for _ in range(40):
        bm = cavity_shell(cfg, scale)
        ok = True
        for v in bm.verts:
            if not inside(v.co) or tree.find_nearest(v.co)[3] < margin:
                ok = False
                break
        bm.free()
        if ok:
            return scale
        scale *= 0.95
    return scale


def join_shell(obj, bm_shell):
    shell = obj_from_bm(obj.name + '_cav', bm_shell)
    activate(obj, [shell])
    bpy.ops.object.join()
    return obj


def crystal_materials(mask_name='mask'):
    """mat_n: BSDF dengan bump retakan (bake NORMAL). mat_r: emisi roughness (bake EMIT). Koordinat Object 3D."""
    mat_n = bpy.data.materials.new('ice_normal')
    mat_n.use_nodes = True
    nt = mat_n.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tc = nt.nodes.new('ShaderNodeTexCoord').outputs['Object']
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_name = mask_name
    mask = attr.outputs['Fac']
    vor = nt.nodes.new('ShaderNodeTexVoronoi')
    vor.voronoi_dimensions = '3D'
    vor.feature = 'DISTANCE_TO_EDGE'
    vor.inputs['Scale'].default_value = 7.0
    nt.links.new(tc, vor.inputs['Vector'])
    crack = maprange(nt, vor.outputs['Distance'], 0.0, 0.035, 1.0, 0.0)  # garis retak tipis
    crack_mask = maprange(nt, noise(nt, tc, 2.4, 3.0), 0.45, 0.6)  # retak hanya di sebagian muka
    crush_n = noise(nt, tc, 55.0, 8.0, 0.65)  # remuk kristalin halus
    crush_amt = nmath(nt, 'ADD', nmath(nt, 'MULTIPLY', mask, 0.9), 0.08)
    h = nmath(nt, 'MULTIPLY', nmath(nt, 'MULTIPLY', crack, crack_mask), 0.5)
    h = nmath(nt, 'ADD', h, nmath(nt, 'MULTIPLY', crush_n, crush_amt))
    h = nmath(nt, 'ADD', h, nmath(nt, 'MULTIPLY', noise(nt, tc, 9.0, 2.0), 0.12))
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.55
    bump.inputs['Distance'].default_value = 0.02
    nt.links.new(h, bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])

    mat_r = bpy.data.materials.new('ice_rough')
    mat_r.use_nodes = True
    nt = mat_r.node_tree
    for n in list(nt.nodes):
        if n.type == 'BSDF_PRINCIPLED':
            nt.nodes.remove(n)
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
    emit = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(emit.outputs['Emission'], out.inputs['Surface'])
    tc = nt.nodes.new('ShaderNodeTexCoord').outputs['Object']
    attr = nt.nodes.new('ShaderNodeAttribute')
    attr.attribute_name = mask_name
    grain = nmath(nt, 'SUBTRACT', noise(nt, tc, 160.0, 2.0, 0.6), 0.5)
    grain2 = nmath(nt, 'SUBTRACT', noise(nt, tc, 38.0, 4.0, 0.55), 0.5)
    r = nmath(nt, 'ADD', nmath(nt, 'MULTIPLY', grain, 0.7), 0.52)
    r = nmath(nt, 'ADD', r, nmath(nt, 'MULTIPLY', grain2, 0.35))
    r = nmath(nt, 'ADD', r, nmath(nt, 'MULTIPLY', attr.outputs['Fac'], 0.12))
    smudge = maprange(nt, noise(nt, tc, 1.9, 3.0, 0.5), 0.6, 0.72)  # beberapa noda licin
    smudge = nmath(nt, 'MULTIPLY', smudge, 0.78)
    r = nmath(nt, 'ADD', nmath(nt, 'MULTIPLY', r, nmath(nt, 'SUBTRACT', 1.0, smudge)),
              nmath(nt, 'MULTIPLY', smudge, 0.14), clamp=True)
    comb = nt.nodes.new('ShaderNodeCombineColor')
    for k in range(3):
        nt.links.new(r, comb.inputs[k])
    nt.links.new(comb.outputs['Color'], emit.inputs['Color'])
    emit.inputs['Strength'].default_value = 1.0
    return mat_n, mat_r


def build_crystal(name, cfg):
    t0 = time.time()
    reset_scene()
    rng = np.random.default_rng(cfg['seed'])
    bm, planes = convex_base(cfg, rng)
    base = obj_from_bm(name + '_base', bm)
    add_notches(base, cfg, rng)
    apply_mod(base, 'REMESH', mode='VOXEL', voxel_size=VOXEL_HI, adaptivity=0.0, use_smooth_shade=False)
    dropped = keep_largest_part(base)
    print(f'[{name}] remesh {tri_count(base)} tris, buang {dropped} komponen dalam, {time.time() - t0:.1f}s', flush=True)
    mask = chip_surface(base, cfg, planes, rng)
    print(f'[{name}] chip {time.time() - t0:.1f}s', flush=True)

    # HIGH: salinan rapat + rongga, atribut masker untuk shader bake
    high = base.copy()
    high.data = base.data.copy()
    high.name = name + '_high'
    link(high)
    attr = high.data.color_attributes.new('mask', 'FLOAT_COLOR', 'POINT')
    cols = np.ones((len(mask), 4))
    cols[:, 0] = cols[:, 1] = cols[:, 2] = mask
    attr.data.foreach_set('color', cols.ravel())
    cav = fit_cavity(base, cfg)
    print(f'[{name}] skala rongga {cav:.2f}', flush=True)
    join_shell(high, cavity_shell(cfg, cav))
    save_fit(name, [round(h * cav, 4) for h in cfg['cavity']])

    # LOW: decimate + rongga + tepi tajam di sudut > 35 derajat
    low = base
    low.name = name
    decimate_to(low, cfg['target'] - 320)
    print(f'[{name}] decimate {time.time() - t0:.1f}s', flush=True)
    join_shell(low, cavity_shell(cfg, cav))
    for p in low.data.polygons:
        p.use_smooth = True
    low.data.set_sharp_from_angle(angle=math.radians(35))
    smart_uv(low, 'UVMap', 66, 0.004)
    smart_uv(low, 'UV1', 48, 0.012)
    low.data.uv_layers.active = low.data.uv_layers['UVMap']
    low.data.uv_layers['UVMap'].active_render = True
    print(f'[{name}] high {tri_count(high)} tris, low {tri_count(low)} tris', flush=True)

    # bake normal (HIGH -> LOW, tangent space) lalu roughness (emit HIGH -> LOW)
    mat_n, mat_r = crystal_materials()
    high.data.materials.clear()
    high.data.materials.append(mat_n)
    _, node = target_material(low, name + '_target')
    sc = bpy.context.scene
    sc.cycles.samples = 4
    jobs = [('NORMAL', mat_n, f'{name}_normal', NORMAL_RES), ('EMIT', mat_r, f'{name}_roughness', ROUGH_RES)]
    for kind, mat, out_name, res in ([] if NOBAKE else jobs):
        high.data.materials[0] = mat
        img = new_image(out_name, res, non_color=True)
        node.image = img
        activate(low, [high])
        tb = time.time()
        kw = dict(normal_space='TANGENT') if kind == 'NORMAL' else {}
        bpy.ops.object.bake(type=kind, use_selected_to_active=True, cage_extrusion=0.03, max_ray_distance=0.12,
                            margin=16, use_clear=True, uv_layer='UVMap', **kw)
        save_bake(img, os.path.join(OUT_BAKE, out_name + '.png'))
        print(f'[bake] {out_name} {res}px {time.time() - tb:.1f}s', flush=True)

    low.data.materials.clear()
    export_glb(low, os.path.join(OUT_GEO, name + '.glb'), normals=True, uvs=True)
    bpy.data.objects.remove(high)
    print(f'[{name}] selesai {time.time() - t0:.1f}s', flush=True)


# ======================================================================================
# OBJEK DALAM (patung abstrak netral, desain sendiri)
# ======================================================================================
def inner_cairn():
    """Tumpukan 4 batu sungai pipih yang menyatu (remesh voxel), tinggi sekitar 1.05."""
    rng = np.random.default_rng(101)
    stones = [((0.0, 0.0, -0.36), (0.29, 0.21, 0.16)), ((0.03, 0.01, -0.08), (0.24, 0.18, 0.14)),
              ((-0.025, -0.01, 0.16), (0.185, 0.145, 0.115)), ((0.01, 0.0, 0.36), (0.12, 0.1, 0.095))]
    objs = []
    for k, (c, s) in enumerate(stones):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=4, radius=1.0)
        for v in bm.verts:
            p = np.array(v.co)
            j = 1 + (vnoise3(p[None] * 1.6, 7 + k)[0] - 0.5) * 0.22
            v.co = Vector((p[0] * s[0] * j, p[1] * s[1] * j, p[2] * s[2] * j))
        o = obj_from_bm(f'stone{k}', bm)
        o.location = c
        o.rotation_euler = (rng.uniform(-0.12, 0.12), rng.uniform(-0.12, 0.12), rng.uniform(-0.4, 0.4))
        objs.append(o)
    activate(objs[0], objs[1:])
    bpy.ops.object.join()
    o = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    apply_mod(o, 'REMESH', mode='VOXEL', voxel_size=0.012, adaptivity=0.0)
    apply_mod(o, 'SMOOTH', factor=0.6, iterations=6)
    return o


def inner_band():
    """Pita tebal terpilin setengah putaran (permukaan satu sisi), lebar berdenyut, di bidang layar."""
    nu, R = 144, 0.4
    prof = []  # persegi panjang membulat, simetris terhadap putaran 180 derajat
    for k in range(20):
        a = 2 * math.pi * (k + 0.5) / 20
        x, y = math.cos(a), math.sin(a)
        # superellipse supaya sudutnya membulat
        e = 2 / 5
        prof.append((math.copysign(abs(x) ** e, x), math.copysign(abs(y) ** e, y)))
    npf = len(prof)
    verts, faces = [], []
    for i in range(nu):
        u = 2 * math.pi * i / nu
        w = 0.085 + 0.045 * math.sin(u) ** 2  # setengah lebar
        t = 0.03
        th = u / 2
        r = np.array([math.cos(u), 0, math.sin(u)])
        yax = np.array([0, 1.0, 0])
        c = r * R
        for a, b in prof:
            aa, bb = a * w, b * t
            p = c + r * (aa * math.cos(th) - bb * math.sin(th)) + yax * (aa * math.sin(th) + bb * math.cos(th))
            verts.append(p)
    for i in range(nu):
        j = i + 1
        for k in range(npf):
            k2 = (k + 1) % npf
            if j < nu:
                a, b, c2, d = i * npf + k, i * npf + k2, j * npf + k2, j * npf + k
            else:  # sambungan Mobius: profil berputar 180 derajat = geser setengah indeks
                a, b = i * npf + k, i * npf + k2
                c2, d = (k2 + npf // 2) % npf, (k + npf // 2) % npf
            faces.append((a, b, c2, d))
    o = obj_from_arrays('band', verts, faces)
    activate(o)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    # sedikit miring supaya terbaca sebagai patung, bukan logo datar
    o.rotation_euler = (0.15, -0.35, 0.2)
    bpy.ops.object.transform_apply(rotation=True)
    return o


def inner_orb():
    """Bola ditembus tiga lorong silinder tegak lurus, tepi dibulatkan."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=5, radius=0.42)
    o = obj_from_bm('orb', bm)
    for k, rot in enumerate([(0, 0, 0), (math.pi / 2, 0, 0), (0, math.pi / 2, 0)]):
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=48, radius1=0.12, radius2=0.12, depth=1.2)
        c = obj_from_bm(f'cyl{k}', bm)
        c.rotation_euler = rot
        activate(o)
        m = o.modifiers.new('hole', 'BOOLEAN')
        m.operation = 'DIFFERENCE'
        m.solver = 'EXACT'
        m.object = c
        bpy.ops.object.modifier_apply(modifier=m.name)
        bpy.data.objects.remove(c)
    apply_mod(o, 'REMESH', mode='VOXEL', voxel_size=0.01, adaptivity=0.0)
    apply_mod(o, 'SMOOTH', factor=0.7, iterations=8)
    o.rotation_euler = (0.5, 0.3, 0.6)
    activate(o)
    bpy.ops.object.transform_apply(rotation=True)
    return o


INNERS = {
    'inner1': dict(make=inner_cairn, target=5600, scale=1.45),
    'inner2': dict(make=inner_band, target=5800, scale=1.3),
    'inner3': dict(make=inner_orb, target=5200, scale=1.3),
}


def plaster_material(dark):
    mat = bpy.data.materials.new('plaster_dark' if dark else 'plaster')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (0.13, 0.14, 0.16, 1) if dark else (0.9, 0.91, 0.93, 1)
    bsdf.inputs['Roughness'].default_value = 0.85
    tc = nt.nodes.new('ShaderNodeTexCoord').outputs['Object']
    h = nmath(nt, 'ADD', nmath(nt, 'MULTIPLY', noise(nt, tc, 90.0, 8.0, 0.6), 0.7),
              nmath(nt, 'MULTIPLY', noise(nt, tc, 16.0, 3.0), 0.3))
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.3
    bump.inputs['Distance'].default_value = 0.01
    nt.links.new(h, bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def add_light(name, kind, loc, energy, color=(1, 1, 1), size=1.0, angle=10):
    light = bpy.data.lights.new(name, kind)
    light.energy = energy
    light.color = color
    if kind == 'AREA':
        light.size = size
    if kind == 'SUN':
        light.angle = math.radians(angle)
    o = link(bpy.data.objects.new(name, light))
    o.location = loc
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector(-np.array(loc, float)).to_track_quat('-Z', 'Y')
    return o


def set_world(color, strength):
    w = bpy.data.worlds.new('World')
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (*color, 1)
    bg.inputs['Strength'].default_value = strength
    bpy.context.scene.world = w
    return bg


FIT_PATH = os.path.join(OUT_GEO, 'crystal_fit.json')


def save_fit(name, half):
    """Catat setengah ukuran rongga final tiap kristal. build_inner memakainya untuk menskala objek dalam."""
    data = json.load(open(FIT_PATH)) if os.path.exists(FIT_PATH) else {}
    data[name] = half
    json.dump(data, open(FIT_PATH, 'w'), indent=1)


def build_inner(name, cfg):
    t0 = time.time()
    reset_scene()
    o = cfg['make']()
    o.name = name
    activate(o)
    # skala = isi rongga kristal pasangannya (inner1 -> crystal1), cadangan cfg['scale'] kalau belum ada data
    fits = json.load(open(FIT_PATH)) if os.path.exists(FIT_PATH) else {}
    half = fits.get(name.replace('inner', 'crystal'))
    if half:
        dims = o.dimensions
        # sumbu kedalaman (y) boleh sedikit melewati rongga: cangkang rongga tidak pernah terlihat langsung
        allow = (1.02, 1.35, 1.02)
        sc = min(2 * half[i] * allow[i] / max(dims[i], 1e-6) for i in range(3))
    else:
        sc = cfg['scale']
    print(f'[{name}] skala {sc:.2f} (rongga {half})', flush=True)
    o.scale = (sc,) * 3
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    decimate_to(o, cfg['target'])
    for p in o.data.polygons:
        p.use_smooth = True
    smart_uv(o, 'UVMap', 66, 0.006)
    sc = bpy.context.scene
    sc.cycles.samples = INNER_SAMPLES

    # rig terang: langit dingin + kunci lembut kiri atas depan (kamera di -Y Blender)
    world = set_world((0.66, 0.7, 0.8), 0.55)
    key = add_light('key', 'SUN', (-1.2, -1.5, 1.8), 2.2, (1.0, 0.98, 0.95), angle=28)
    # rig gelap: dua rim dari belakang samping, langit hampir hitam kebiruan
    rim1 = add_light('rim1', 'AREA', (-1.6, 1.4, 0.6), 160, (0.82, 0.9, 1.0), size=1.2)
    rim2 = add_light('rim2', 'AREA', (1.7, 1.2, 0.9), 120, (0.82, 0.9, 1.0), size=1.2)
    fill = add_light('fill', 'AREA', (0.2, -2.0, -1.2), 6, (0.6, 0.7, 1.0), size=2.0)

    mats = {'plaster': plaster_material(False), 'dark': plaster_material(True)}
    for variant, out_name in ([] if NOBAKE else [('plaster', f'{name}_color'), ('dark', f'{name}_dark_color')]):
        dark = variant == 'dark'
        world.inputs['Color'].default_value = (0.02, 0.03, 0.05, 1) if dark else (0.66, 0.7, 0.8, 1)
        world.inputs['Strength'].default_value = 0.4 if dark else 0.55
        key.hide_render = dark
        for l in (rim1, rim2, fill):
            l.hide_render = not dark
        # material bake = plaster/gelap + node image target (node target harus aktif di material yang dirender)
        mat = mats[variant]
        if 'bake_target' not in mat.node_tree.nodes:
            tn = mat.node_tree.nodes.new('ShaderNodeTexImage')
            tn.name = 'bake_target'
        tn = mat.node_tree.nodes['bake_target']
        img = new_image(out_name, INNER_RES, non_color=False)
        tn.image = img
        mat.node_tree.nodes.active = tn
        o.data.materials.clear()
        o.data.materials.append(mat)
        activate(o)
        tb = time.time()
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT', 'COLOR'}, margin=16,
                            use_clear=True, uv_layer='UVMap')
        save_bake(img, os.path.join(OUT_BAKE, out_name + '.png'))
        print(f'[bake] {out_name} {INNER_RES}px {time.time() - tb:.1f}s', flush=True)
    o.data.materials.clear()
    dims = o.dimensions
    print(f'[{name}] ukuran Blender {dims.x:.2f} x {dims.y:.2f} x {dims.z:.2f}', flush=True)
    export_glb(o, os.path.join(OUT_GEO, name + '.glb'), normals=False, uvs=True)
    print(f'[{name}] selesai {time.time() - t0:.1f}s', flush=True)


def main():
    t0 = time.time()
    for name, cfg in CRYSTALS.items():
        if ONLY is None or name in ONLY:
            build_crystal(name, cfg)
    for name, cfg in INNERS.items():
        if ONLY is None or name in ONLY:
            build_inner(name, cfg)
    print(f'[done] {time.time() - t0:.1f}s', flush=True)


main()
