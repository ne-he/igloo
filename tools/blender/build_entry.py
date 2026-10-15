"""Bangun aset scene entry (M7a: cincin portal + lantai ruang link) secara deterministik di Blender headless.

Pakai (dari root projek):
  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --factory-startup \
      --python tools/blender/build_entry.py -- [--quick] [--no-bake] [--preview] [--only rings|floor]
      [--samples N] [--threads N]
Lalu:  python tools/blender/finalize_entry.py   (denoise + isi gutter + WebP/PNG + Draco)

Desain sendiri (bukan aset igloo), hanya spesifikasi tekniknya yang mengikuti blueprint 8.2 nomor 12 dan 13:

Cincin pecah, 2 varian (ring_a: 10 blok jadi 4 keping, ring_b: 12 blok jadi 6 keping):
  Cincin bata salju r luar 0.4, r dalam 0.27, tebal 0.13 (z -0.014..0.117). Tiap blok = kotak bulat
  yang dibengkokkan mengikuti busur, celah tipis antar blok, permukaan diberi relief noise.
  Greeble: tonjolan kecil di muka atas, rel tipis di muka dalam, nub di muka luar.
  Koordinat = koordinat lokal three cincin (bidang XY, sumbu z = atas). Runtime memutar -90 derajat di x,
  jadi muka +z menghadap ke atas dunia. Di Blender mesh dibangun dengan koordinat yang sama (z Blender = atas,
  pas untuk bake), lalu diputar +90 di x sebelum ekspor supaya glTF mengeluarkan koordinat aslinya lagi.
  Atribut: _centr (vec3, centroid keping, koordinat three lokal), _rand (vec3 acak per keping 0..1).
  Bake: <nama>_color 1024 (DIFFUSE: langsung + tidak langsung + warna), <nama>_glow 256 (EMIT dari atribut
  glowsrc: muka yang menghadap pusat cincin + ujung blok di celah, tidak ikut diekspor).

Lantai ruang (floor): podium bulat bertingkat radius 1.8 (runtime diskala 0.73), alur konsentris.
  iterasi 0 podium tengah (alur ukir), 1 cincin utuh, 2 = 12 ubin bertanda, 3 = 18 ubin bertanda, plat dasar
  di bawah celah. Ubin bertanda (iterasi 2 dan 3) = _animationmask 1, bergoyang di runtime.
  Tanda (garis tick, blok glyph, lingkar putus-putus) digambar ke tekstur planar (tools/textures/
  entry_gen_floor_marks.py, jalankan dulu) lalu dipakai material bake sebagai warna ukir + bump, jadi tandanya
  ada di bake tanpa menambah geometri.
  Atribut: _iteration (0..3), _animationmask (0/1), _glow (0, 0.2, 0.95, 1: dasar alur menyala).
  Bake: floor_color 2048.

Output mentah: tools/blender/out/ring_a.glb, ring_b.glb, floor.glb (tanpa normal, tanpa material),
bake PNG ke tools/blender/out/bakes/ (finalize memindah hasil jadi ke public/assets).
"""
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
QUICK = '--quick' in ARGS
NO_BAKE = '--no-bake' in ARGS
PREVIEW = '--preview' in ARGS
ONLY = ARGS[ARGS.index('--only') + 1] if '--only' in ARGS else 'all'
SAMPLES = int(ARGS[ARGS.index('--samples') + 1]) if '--samples' in ARGS else (8 if QUICK else 24)
THREADS = int(ARGS[ARGS.index('--threads') + 1]) if '--threads' in ARGS else 4  # mesin dipakai bersama
RING_TEX = 256 if QUICK else 1024
GLOW_TEX = 256
FLOOR_TEX = 512 if QUICK else 2048
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'tools', 'blender', 'out')
BAKES = os.path.join(OUT, 'bakes')
os.makedirs(BAKES, exist_ok=True)

rng = np.random.default_rng(20261013)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ---------- noise 3D deterministik ----------
def _h3(ix, iy, iz, seed):
    h = np.sin(ix * 127.1 + iy * 311.7 + iz * 74.7 + seed * 19.19) * 43758.5453
    return h - np.floor(h)


def vnoise3(p, seed=0.0):
    i = np.floor(p)
    f = p - i
    u = f * f * (3 - 2 * f)
    acc = 0.0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (u[:, 0] if dx else 1 - u[:, 0]) * (u[:, 1] if dy else 1 - u[:, 1]) * (u[:, 2] if dz else 1 - u[:, 2])
                acc = acc + w * _h3(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return acc


def fbm3(p, octaves=4, seed=0.0):
    v = np.zeros(len(p))
    amp, f = 0.5, 1.0
    for o in range(octaves):
        v += vnoise3(p * f, seed + o * 3.7) * amp
        f *= 2.07
        amp *= 0.5
    return v


# ---------- kotak bulat di ruang parameter ----------
def axis_samples(h, r, n_mid, n_bev):
    """Sampel 1D di [-h, h]: bagian datar n_mid segmen, n_bev langkah bevel di tiap ujung."""
    inner = h - r
    ang = np.linspace(0, np.pi / 2, n_bev + 1)[1:]
    bev = inner + r * np.sin(ang)
    return np.concatenate([-bev[::-1], np.linspace(-inner, inner, n_mid + 1), bev])


def rounded_box(hs, r, n_mid, n_bev):
    """Permukaan kotak bulat setengah-ukuran hs, radius bevel r. Return (P, N, quads), P/N di ruang parameter."""
    axes = [axis_samples(hs[k], r, n_mid[k], n_bev) for k in range(3)]
    eye = np.eye(3)
    P, quads = [], []
    for a in range(3):
        b, c = [k for k in range(3) if k != a]
        for sgn in (-1, 1):
            nb, nc = len(axes[b]), len(axes[c])
            grid = np.zeros((nb, nc, 3))
            grid[..., a] = sgn * hs[a]
            grid[..., b] = axes[b][:, None]
            grid[..., c] = axes[c][None, :]
            base = sum(len(x) for x in P)
            P.append(grid.reshape(-1, 3))
            flip = np.cross(eye[b], eye[c])[a] * sgn < 0
            for i in range(nb - 1):
                for j in range(nc - 1):
                    q = [base + i * nc + j, base + (i + 1) * nc + j, base + (i + 1) * nc + j + 1, base + i * nc + j + 1]
                    quads.append(q[::-1] if flip else q)
    P = np.concatenate(P)
    inner = np.array(hs) - r
    Q = np.clip(P, -inner, inner)
    D = P - Q
    L = np.linalg.norm(D, axis=1, keepdims=True)
    N = D / np.maximum(L, 1e-9)
    P = Q + N * r
    return P, N, np.array(quads)


def merge(P, N, quads, extra=()):
    """Gabung vertex kembar (sambungan antar muka kotak), buang quad yang runtuh."""
    key = np.round(P * 1e6).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    inv = inv.ravel()
    q = inv[quads]
    out = []
    for row in q:
        u = []
        for v in row:
            if v not in u:
                u.append(v)
        if len(u) >= 3:
            out.append(u)
    return P[first], N[first], out, [e[first] for e in extra]


# ---------- cincin ----------
R_OUT, R_IN = 0.4, 0.27
R_MID = (R_OUT + R_IN) / 2
HV = (R_OUT - R_IN) / 2
Z_MID, HW = (0.117 - 0.014) / 2, (0.117 + 0.014) / 2
BEVEL = 0.021
GAP = 0.0045  # setengah celah antar blok (meter busur)


def bend(P, N, ac, rm=R_MID, zm=Z_MID):
    """Param (u sepanjang busur, v radial, w tinggi) -> posisi cincin di bidang XY."""
    ang = ac + P[:, 0] / rm
    R = rm + P[:, 1]
    ca, sa = np.cos(ang), np.sin(ang)
    pos = np.stack([R * ca, R * sa, zm + P[:, 2]], -1)
    T = np.stack([-sa, ca, np.zeros_like(sa)], -1)
    Rad = np.stack([ca, sa, np.zeros_like(sa)], -1)
    nrm = N[:, :1] * T + N[:, 1:2] * Rad + N[:, 2:3] * np.array([0, 0, 1.0])
    return pos, nrm


def build_ring(name, blocks, pieces, seed):
    """blocks = jumlah blok, pieces = jumlah blok per keping (berurutan)."""
    assert sum(pieces) == blocks
    r = np.random.default_rng(seed)
    # batas blok sedikit diacak supaya tidak terasa seperti jam
    cuts = np.linspace(0, 2 * np.pi, blocks + 1)[:-1] + r.uniform(-0.12, 0.12, blocks) * (2 * np.pi / blocks)
    cuts = np.sort(cuts) + r.uniform(0, 2 * np.pi)
    piece_of_block = np.repeat(np.arange(len(pieces)), pieces)
    verts, quads, piece_id, glow, is_block = [], [], [], [], []
    base = 0

    def add(P, N, q, pid, g, blk):
        nonlocal base
        verts.append(P)
        quads.extend((np.array(x) + base).tolist() for x in q)
        piece_id.append(np.full(len(P), pid))
        glow.append(g)
        is_block.append(np.full(len(P), blk))
        base += len(P)

    for bi in range(blocks):
        a0, a1 = cuts[bi], cuts[(bi + 1) % blocks] + (2 * np.pi if bi == blocks - 1 else 0)
        ac = (a0 + a1) / 2
        hu = (a1 - a0) / 2 * R_MID - GAP
        pid = piece_of_block[bi]
        n_u = max(3, int(round(hu * 2 / 0.05)))
        P, N, q = rounded_box((hu, HV, HW), BEVEL, (n_u, 2, 2), 2)
        P, N, q, (Pp,) = merge(P, N, q, (P,))
        # glow: muka yang menghadap pusat cincin + ujung blok (cahaya bocor dari celah)
        inward = smoothstep(0.0, 0.85, -N[:, 1])
        ends = smoothstep(0.55, 1.0, np.abs(Pp[:, 0]) / hu) * 0.55
        pos, nrm = bend(P, N, ac)
        add(pos, nrm, q, pid, np.maximum(inward, ends), 1)

        # greeble: 1-2 tonjolan di muka atas
        for k in range(r.integers(1, 3)):
            gs = (r.uniform(0.012, 0.03), r.uniform(0.008, 0.016), r.uniform(0.004, 0.009))
            gu = r.uniform(-hu + gs[0] + 0.01, hu - gs[0] - 0.01)
            gv = r.uniform(-HV + gs[1] + 0.012, HV - gs[1] - 0.012)
            P, N, q = rounded_box(gs, min(gs) * 0.6, (1, 1, 1), 1)
            P, N, q, _ = merge(P, N, q)
            P = P + np.array([gu, gv, HW + gs[2] - 0.004])
            pos, nrm = bend(P, N, ac)
            add(pos, nrm, q, pid, np.full(len(P), 0.1), 0)
        # rel tipis di muka dalam (menyala)
        gs = (hu * 0.78, 0.007, 0.012)
        P, N, q = rounded_box(gs, 0.005, (3, 1, 1), 1)
        P, N, q, _ = merge(P, N, q)
        P = P + np.array([r.uniform(-0.01, 0.01), -HV - gs[1] + 0.003, r.uniform(-0.02, 0.02)])
        pos, nrm = bend(P, N, ac)
        add(pos, nrm, q, pid, np.full(len(P), 1.0), 0)
        # nub di muka luar
        gs = (r.uniform(0.01, 0.02), 0.006, r.uniform(0.012, 0.025))
        P, N, q = rounded_box(gs, 0.004, (1, 1, 1), 1)
        P, N, q, _ = merge(P, N, q)
        P = P + np.array([r.uniform(-hu * 0.6, hu * 0.6), HV + gs[1] - 0.003, r.uniform(-0.02, 0.02)])
        pos, nrm = bend(P, N, ac)
        add(pos, nrm, q, pid, np.full(len(P), 0.05), 0)

    V = np.concatenate(verts)
    PID = np.concatenate(piece_id)
    G = np.concatenate(glow)
    BLK = np.concatenate(is_block)
    # relief: gumpalan kecil di sepanjang normal (blok saja, greeble tetap tajam)
    me = bpy.data.meshes.new(name)
    me.from_pydata(V.tolist(), [], quads)
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    # pemetaan bend membalik orientasi (T x Rad = -Z), jadi normal diseragamkan keluar oleh Blender
    recalc_normals(obj)
    nrm = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('normal', nrm)
    nrm = nrm.reshape(-1, 3)
    lump = (fbm3(V * 22.0, 4, seed * 0.1) - 0.5) * 0.007 + (fbm3(V * 70.0, 2, seed * 0.1 + 3) - 0.5) * 0.002
    V = V + nrm * (lump * BLK)[:, None]
    me.vertices.foreach_set('co', V.ravel())
    me.update()
    for p in me.polygons:
        p.use_smooth = True

    n_p = len(pieces)
    centr = np.array([V[PID == k].mean(0) for k in range(n_p)])
    rnd = r.uniform(0.005, 0.995, (n_p, 3))

    def attr(an, typ, data, key):
        a = me.attributes.new(name=an, type=typ, domain='POINT')
        a.data.foreach_set(key, data.ravel())

    attr('_centr', 'FLOAT_VECTOR', centr[PID].astype(np.float32), 'vector')
    attr('_rand', 'FLOAT_VECTOR', rnd[PID].astype(np.float32), 'vector')
    noise = fbm3(V * 9.0, 3, seed * 0.3 + 7)
    attr('glowsrc', 'FLOAT', np.clip(G * (0.55 + 0.9 * noise), 0, 1).astype(np.float32), 'value')
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    print(f'[{name}] {len(me.vertices)} vertex, {tris} tris, {n_p} keping, bbox '
          f'{np.round(V.min(0), 3)} .. {np.round(V.max(0), 3)}', flush=True)
    for k in range(n_p):
        print(f'   keping {k}: centr {np.round(centr[k], 3)} rand {np.round(rnd[k], 3)}', flush=True)
    return obj


# ---------- lantai ----------
FLOOR_R = 1.8
H_BASE = -0.0375


def sweep(profile, a0, a1, segs, closed, attrs):
    """Putar profil 2D (r, h) di sekitar sumbu z dari a0 ke a1. closed = lingkaran penuh.
    Ujung sektor ditutup tutup datar (fan dari titik tengah profil). attrs: dict nama -> nilai per titik profil.
    Return (V, faces, per-vertex attrs)."""
    prof = np.array(profile, dtype=float)
    m = len(prof)
    n = segs if closed else segs + 1
    ang = np.linspace(a0, a1, segs + 1)[:n]
    V = np.zeros((n, m, 3))
    V[..., 0] = prof[None, :, 0] * np.cos(ang)[:, None]
    V[..., 1] = prof[None, :, 0] * np.sin(ang)[:, None]
    V[..., 2] = prof[None, :, 1]
    faces = []
    for i in range(segs):
        i1 = (i + 1) % n
        for j in range(m - 1):
            # urutan (profil, lalu sudut) = normal atas menghadap +z, dinding dalam ke pusat
            faces.append([i * m + j, i * m + j + 1, i1 * m + j + 1, i1 * m + j])
    V = V.reshape(-1, 3)
    out = {k: np.tile(np.asarray(v, dtype=float), n) for k, v in attrs.items()}
    if not closed:
        # tutup ujung: poligon profil (cembung, sudut bawah tertutup)
        for i, flip in ((0, True), (n - 1, False)):
            ring = [i * m + j for j in range(m)]
            faces.append(ring[::-1] if flip else ring)
    return V, faces, out


def step_profile(r0, r1, ht, b=0.012, grooves=(), sub=1, inner_wall=True, outer_wall=True):
    """Profil anak tangga: dinding dalam, bevel, atas (dengan alur ukir), bevel, dinding luar.
    Return list titik (r, h) dan nilai glow per titik."""
    pts, gl = [], []

    def p(r, h, g=0.0):
        pts.append((r, h))
        gl.append(g)

    if inner_wall and r0 > 0:
        p(r0, H_BASE)
        p(r0, ht - b)
        p(r0 + b * 0.29, ht - b * 0.29)
        p(r0 + b, ht)
    else:
        p(max(r0, 0.0), ht)
    cur = r0 + (b if inner_wall and r0 > 0 else 0)
    for g0, g1, depth in grooves:
        for k in range(1, sub + 1):
            p(cur + (g0 - cur) * k / (sub + 1), ht)
        p(g0, ht)
        p(g0 + 0.003, ht - depth, 1.0)
        p(g1 - 0.003, ht - depth, 1.0)
        p(g1, ht)
        cur = g1
    end = r1 - (b if outer_wall else 0)
    for k in range(1, sub + 1):
        p(cur + (end - cur) * k / (sub + 1), ht)
    if outer_wall:
        p(r1 - b, ht)
        p(r1 - b * 0.29, ht - b * 0.29)
        p(r1, ht - b)
        p(r1, H_BASE)
    else:
        p(r1, ht)
    return pts, gl


def build_floor():
    parts = []  # (V, faces, glow, iteration, mask)

    def add(V, faces, gl, it, mask):
        parts.append((V, faces, gl, it, mask))

    # plat dasar di bawah celah (menyala), lingkaran penuh
    prof = [(0.5, H_BASE + 0.004), (0.8, H_BASE + 0.004), (1.2, H_BASE + 0.004), (1.62, H_BASE + 0.004),
            (FLOOR_R + 0.03, H_BASE + 0.004)]
    V, f, a = sweep(prof, 0, 2 * np.pi, 128, True, {'g': [0.95] * len(prof)})
    add(V, f, a['g'], 3, 0)
    # iterasi 0: podium tengah dengan alur ukir
    pts, gl = step_profile(0.0, 0.55, 0.085, b=0.016, grooves=[(0.40, 0.43, 0.012)], sub=2, inner_wall=False)
    V, f, a = sweep(pts, 0, 2 * np.pi, 128, True, {'g': gl})
    add(V, f, a['g'], 0, 0)
    # iterasi 1: cincin utuh dengan dua alur
    pts, gl = step_profile(0.6, 1.0, 0.05, grooves=[(0.72, 0.735, 0.01), (0.86, 0.875, 0.01)], sub=1)
    V, f, a = sweep(pts, 0, 2 * np.pi, 160, True, {'g': gl})
    add(V, f, a['g'], 1, 0)
    # iterasi 2 dan 3: ubin bertanda (bergoyang di runtime)
    for it, count, r0, r1, ht, segs, gap in ((2, 12, 1.05, 1.38, 0.03, 16, 0.006), (3, 18, 1.43, 1.8, 0.016, 10, 0.006)):
        span = 2 * np.pi / count
        for t in range(count):
            pts, gl = step_profile(r0, r1, ht, b=0.01, grooves=[(r0 + (r1 - r0) * 0.62, r0 + (r1 - r0) * 0.62 + 0.012, 0.007)])
            ga = gap / ((r0 + r1) / 2)
            V, f, a = sweep(pts, t * span + ga, (t + 1) * span - ga, segs, False, {'g': gl})
            # tutup ujung ubin sedikit menyala (celah antar ubin)
            g = a['g'].copy()
            m = len(pts)
            g[:m] = np.maximum(g[:m], 0.2)
            g[-m:] = np.maximum(g[-m:], 0.2)
            add(V, f, g, it, 1)

    verts, faces, G, IT, MK = [], [], [], [], []
    base = 0
    for V, f, g, it, mk in parts:
        verts.append(V)
        faces.extend([[i + base for i in x] for x in f])
        G.append(g)
        IT.append(np.full(len(V), it, dtype=float))
        MK.append(np.full(len(V), mk, dtype=float))
        base += len(V)
    V = np.concatenate(verts)
    G, IT, MK = np.concatenate(G), np.concatenate(IT), np.concatenate(MK)
    # titik pusat podium (r = 0) kembar 128 kali: gabungkan supaya tidak ada quad runtuh
    center = np.where(np.linalg.norm(V[:, :2], axis=1) < 1e-9)[0]
    if len(center):
        keep = center[0]
        remap = np.arange(len(V))
        remap[center] = keep
        new_faces = []
        for fc in faces:
            u = []
            for v in fc:
                v = int(remap[v])
                if v not in u:
                    u.append(v)
            if len(u) >= 3:
                new_faces.append(u)
        faces = new_faces
    # Blender: z = atas (koordinat three lantai (x, y, z) = Blender (x, -z, y); simetri putar jadi aman)
    me = bpy.data.meshes.new('floor')
    me.from_pydata(V.tolist(), [], faces)
    me.update()
    me.validate()
    for p in me.polygons:
        p.use_smooth = True

    def attr(an, data):
        a = me.attributes.new(name=an, type='FLOAT', domain='POINT')
        a.data.foreach_set('value', data.astype(np.float32))

    attr('_iteration', IT)
    attr('_animationmask', MK)
    attr('_glow', G)
    obj = bpy.data.objects.new('floor', me)
    bpy.context.scene.collection.objects.link(obj)
    recalc_normals(obj)
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    share = MK.mean() * 100
    print(f'[floor] {len(me.vertices)} vertex, {tris} tris, animationmask {share:.0f}% vertex, '
          f'glow level {sorted(set(np.round(G, 2)))}', flush=True)
    return obj


# ---------- scene, material, bake ----------
def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = SAMPLES
    sc.render.threads_mode = 'FIXED'
    sc.render.threads = THREADS
    sc.render.bake.margin = 16
    sc.view_settings.view_transform = 'Standard'
    return sc


def set_world(color, strength):
    w = bpy.data.worlds.new('World')
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs['Color'].default_value = (*color, 1)
    bg.inputs['Strength'].default_value = strength
    bpy.context.scene.world = w


def add_sun(elev_deg, azim_deg, energy, angle_deg):
    from mathutils import Vector
    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = energy
    sun.angle = math.radians(angle_deg)
    sun.color = (1.0, 0.99, 0.97)
    obj = bpy.data.objects.new('Sun', sun)
    bpy.context.scene.collection.objects.link(obj)
    el, az = math.radians(elev_deg), math.radians(azim_deg)
    d = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = (-d).to_track_quat('-Z', 'Y')
    return obj


def mix_rgb(nt, blend):
    """Node Mix mode warna. Socket A/B dicari per tipe (nama A/B dipakai juga oleh socket float/vektor)."""
    m = nt.nodes.new('ShaderNodeMix')
    m.data_type = 'RGBA'
    m.blend_type = blend
    a = next(i for i in m.inputs if i.name == 'A' and i.type == 'RGBA')
    b = next(i for i in m.inputs if i.name == 'B' and i.type == 'RGBA')
    fac = next(i for i in m.inputs if i.name == 'Factor' and i.type == 'VALUE')
    out = next(o for o in m.outputs if o.name == 'Result' and o.type == 'RGBA')
    return m, fac, a, b, out


def recalc_normals(obj):
    activate(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def stone_material(name, albedo, rough, bump_scale, bump_strength, marks=None, tint_amount=0.25):
    """Bata salju padat / lantai: albedo + bump noise di koordinat objek, opsional tekstur tanda planar."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Roughness'].default_value = rough
    coord = nt.nodes.new('ShaderNodeTexCoord')
    fine = nt.nodes.new('ShaderNodeTexNoise')
    fine.inputs['Scale'].default_value = bump_scale
    fine.inputs['Detail'].default_value = 6.0
    coarse = nt.nodes.new('ShaderNodeTexNoise')
    coarse.inputs['Scale'].default_value = bump_scale * 0.18
    coarse.inputs['Detail'].default_value = 2.0
    nt.links.new(coord.outputs['Object'], fine.inputs['Vector'])
    nt.links.new(coord.outputs['Object'], coarse.inputs['Vector'])
    height = nt.nodes.new('ShaderNodeMath')
    height.operation = 'MULTIPLY_ADD'
    height.inputs[1].default_value = 0.5
    nt.links.new(fine.outputs['Fac'], height.inputs[0])
    nt.links.new(coarse.outputs['Fac'], height.inputs[2])
    # variasi albedo halus dari noise kasar
    _, t_fac, t_a, t_b, color_out = mix_rgb(nt, 'MULTIPLY')
    t_fac.default_value = tint_amount
    t_a.default_value = (*albedo, 1)
    # Fac (abu), bukan Color: output Color noise berwarna dan menggeser hue bake
    nt.links.new(coarse.outputs['Fac'], t_b)
    if marks is not None:
        mapping = nt.nodes.new('ShaderNodeMapping')
        mapping.inputs['Location'].default_value = (0.5, 0.5, 0)
        mapping.inputs['Scale'].default_value = (1 / (2 * FLOOR_R), 1 / (2 * FLOOR_R), 1)
        nt.links.new(coord.outputs['Object'], mapping.inputs['Vector'])
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = marks
        tex.interpolation = 'Linear'
        tex.extension = 'CLIP'
        nt.links.new(mapping.outputs['Vector'], tex.inputs['Vector'])
        _, d_fac, d_a, d_b, d_out = mix_rgb(nt, 'MIX')
        d_b.default_value = (albedo[0] * 0.42, albedo[1] * 0.44, albedo[2] * 0.5, 1)
        nt.links.new(tex.outputs['Color'], d_fac)
        nt.links.new(color_out, d_a)
        color_out = d_out
        sub = nt.nodes.new('ShaderNodeMath')
        sub.operation = 'MULTIPLY_ADD'
        sub.inputs[1].default_value = -0.6
        nt.links.new(tex.outputs['Color'], sub.inputs[0])
        nt.links.new(height.outputs['Value'], sub.inputs[2])
        height = sub
    nt.links.new(color_out, bsdf.inputs['Base Color'])
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = bump_strength
    bump.inputs['Distance'].default_value = 0.004
    nt.links.new(height.outputs['Value'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def glow_material(name, attr_name):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        if n.type != 'OUTPUT_MATERIAL':
            nt.nodes.remove(n)
    out = next(n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL')
    at = nt.nodes.new('ShaderNodeAttribute')
    at.attribute_name = attr_name
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Strength'].default_value = 1.0
    nt.links.new(at.outputs['Fac'], em.inputs['Color'])
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return mat


def smart_uv(obj, angle_deg, margin):
    me = obj.data
    if not me.uv_layers:
        me.uv_layers.new(name='UVMap')
    activate(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle_deg), island_margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def bake_to(obj, path, size, kind, non_color=False, filt=('DIRECT', 'INDIRECT', 'COLOR')):
    """Bake ke PNG RGBA (alpha 0 = piksel di luar pulau UV + margin, dipakai finalize untuk gutter)."""
    img = bpy.data.images.new(os.path.basename(path), size, size, alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'Non-Color' if non_color else 'sRGB'
    img.generated_color = (0, 0, 0, 0)
    nt = obj.active_material.node_tree
    node = nt.nodes.new('ShaderNodeTexImage')
    node.image = img
    for n in nt.nodes:
        n.select = False
    node.select = True
    nt.nodes.active = node
    activate(obj)
    t0 = time.time()
    if kind == 'DIFFUSE':
        bpy.ops.object.bake(type='DIFFUSE', pass_filter=set(filt), margin=16, use_clear=True)
    else:
        bpy.ops.object.bake(type=kind, margin=16, use_clear=True)
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    nt.nodes.remove(node)
    print(f'[bake] {os.path.relpath(path, ROOT)} {kind} {size}px {time.time() - t0:.1f}s', flush=True)


def export_glb(obj, path):
    activate(obj)
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB', export_yup=True,
                              export_normals=False, export_texcoords=True, export_attributes=True,
                              export_materials='NONE', export_apply=True)
    print(f'[export] {os.path.relpath(path, ROOT)} {os.path.getsize(path) / 1024:.1f} KB', flush=True)


def render_preview(path, loc, look, lens_deg=40):
    from mathutils import Vector
    sc = bpy.context.scene
    cam = bpy.data.cameras.new('cam')
    cam.sensor_fit = 'VERTICAL'
    cam.angle = math.radians(lens_deg)
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    co.location = loc
    co.rotation_euler = (Vector(look) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = co
    sc.render.resolution_x, sc.render.resolution_y = 640, 480
    old = sc.cycles.samples
    sc.cycles.samples = 12
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    sc.cycles.samples = old
    bpy.data.objects.remove(co)
    print(f'[preview] {os.path.relpath(path, ROOT)}', flush=True)


def run_rings():
    reset_scene()
    # langit lavender dingin + matahari tinggi lembut: muka atas terang, sisi dan celah gelap
    set_world((0.62, 0.66, 0.80), 0.45)
    add_sun(52, 25, 2.4, 14)
    # bata lapuk: bump kasar lebih kuat + variasi albedo lebih lebar supaya terbaca batu salju, bukan plastik
    stone = stone_material('ring_stone', (0.66, 0.69, 0.77), 0.85, 22.0, 0.55, tint_amount=0.5)
    glow = glow_material('ring_glow', 'glowsrc')
    specs = [('ring_a', 10, [3, 2, 3, 2], 11), ('ring_b', 12, [2, 2, 3, 1, 2, 2], 23)]
    objs = []
    for name, blocks, pieces, seed in specs:
        obj = build_ring(name, blocks, pieces, seed)
        smart_uv(obj, 60, 0.006)
        obj.data.materials.append(stone)
        objs.append(obj)
    # pisahkan kedua cincin supaya tidak saling membayangi saat bake
    objs[1].location.x = 3.0
    if PREVIEW:
        render_preview(os.path.join(OUT, 'entry_rings_preview.png'), (1.5, -2.2, 2.4), (1.5, 0, 0), 38)
    for obj in objs:
        if not NO_BAKE:
            bake_to(obj, os.path.join(BAKES, f'{obj.name}_color.png'), RING_TEX, 'DIFFUSE')
            obj.data.materials[0] = glow
            bake_to(obj, os.path.join(BAKES, f'{obj.name}_glow.png'), GLOW_TEX, 'EMIT', non_color=True)
            obj.data.materials[0] = stone
        # kembalikan ke koordinat three lokal (lihat docstring), lalu ekspor
        obj.location.x = 0
        obj.data.transform(Matrix.Rotation(math.radians(90), 4, 'X'))
        obj.data.update()
        export_glb(obj, os.path.join(OUT, f'{obj.name}.glb'))
        obj.data.transform(Matrix.Rotation(math.radians(-90), 4, 'X'))


def run_floor():
    reset_scene()
    # ruang terang: lingkungan putih kebiruan + cahaya atas lebar (podium dari langit-langit)
    set_world((0.80, 0.84, 0.93), 0.75)
    add_sun(78, 40, 1.6, 35)
    # tekstur tanda dibuat Python sistem (Blender tidak punya PIL): tools/textures/entry_gen_floor_marks.py
    marks_path = os.path.join(OUT, 'floor_marks.png')
    if not os.path.exists(marks_path):
        raise SystemExit('floor_marks.png belum ada, jalankan dulu: python tools/textures/entry_gen_floor_marks.py')
    marks = bpy.data.images.load(marks_path)
    marks.colorspace_settings.name = 'Non-Color'
    floor = build_floor()
    smart_uv(floor, 50, 0.003)
    floor.data.materials.append(stone_material('floor_stone', (0.74, 0.77, 0.84), 0.6, 30.0, 0.12, marks=marks))
    if PREVIEW:
        render_preview(os.path.join(OUT, 'entry_floor_preview.png'), (0, -2.6, 1.3), (0, 0, 0), 45)
    if not NO_BAKE:
        bake_to(floor, os.path.join(BAKES, 'floor_color.png'), FLOOR_TEX, 'DIFFUSE')
    export_glb(floor, os.path.join(OUT, 'floor.glb'))


def main():
    t0 = time.time()
    if ONLY in ('all', 'rings'):
        run_rings()
    if ONLY in ('all', 'floor'):
        run_floor()
    print(f'[done] {time.time() - t0:.1f}s', flush=True)


main()
