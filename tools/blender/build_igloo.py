"""Bangun igloo bata (M3) secara deterministik di Blender headless.

Pakai (dari root projek):
  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --factory-startup \
      --python tools/blender/build_igloo.py -- [--quick] [--no-bake] [--preview] [--only igloo|ground]
      [--samples N] [--ground-samples N] [--tex N]
  Build penuh yang dipakai (11 Okt 2026, CPU dibagi agent lain): --samples 16 --ground-samples 32 (2048),
  noise bata dibersihkan blur bertopeng di finalize_igloo.py.
Lalu:  python tools/blender/finalize_igloo.py   (gutter fill + WebP + Draco)

Isi:
  70 bata salju bevel (58 di kubah dalam 6 lapis + 1 tutup, 10 di terowongan masuk sepanjang +Z three),
  radius luar 2.6, tinggi -0.55 sampai 3.7, berongga (muka dalam ikut), relief salju lewat noise.
  Bata dibangun sebagai "rounded box" di ruang parameter (u, v, w) lalu dibengkokkan ke kubah elips
  (u = sepanjang keliling, v = sepanjang meridian, w = tebal). Semua angka dihitung di koordinat three
  (x kanan, y atas, z ke arah pintu), dikonversi ke Blender (x, -z, y) hanya saat membuat mesh.

Atribut per vertex (nama berawalan _ supaya diekspor glTF, dibaca three dalam huruf kecil):
  _batchid  int   indeks bata 0..69
  _centr    vec3  centroid bata (KOORDINAT THREE, exporter tidak mengonversi atribut custom)
  _rand     vec3  acak per bata 0..1
  _emission float 0.1..1.08, tinggi di muka yang menghadap ke dalam igloo + sisi bata dekat muka dalam

UV: satu atlas tanpa tumpang tindih, dibuat sendiri (bukan Smart UV): tiap muka kubus bata = 1 pulau
persegi, di-pack rak (shelf) dengan jarak 8 px di 2048. Muka dalam diberi skala 0.3 (jarang terlihat, mahal di-bake).
Daftar persegi disimpan ke tools/blender/out/igloo_uv_rects.json untuk gutter fill di finalize.

Bake (pencahayaan sama persis dengan bake tanah lembah, konstanta dibaca dari build_valley.py):
  igloo_color.png           2048  rakit: muka kontak gelap
  igloo_exploded_color.png  2048  meledak: tiap bata digeser keluar sepanjang centroid lalu di-bake
  ground_color_igloo.png    2048  tanah lembah (ground_height yang sama) DENGAN igloo, untuk bayangan kontak
Output geometri mentah: tools/blender/out/igloo.glb (tanpa normal, tanpa material).
"""
import json
import math
import os
import re
import sys
import time

import bpy
import numpy as np

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
QUICK = '--quick' in ARGS
NO_BAKE = '--no-bake' in ARGS
PREVIEW = '--preview' in ARGS
ONLY = ARGS[ARGS.index('--only') + 1] if '--only' in ARGS else 'all'
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_GEO = os.path.join(ROOT, 'tools', 'blender', 'out')
OUT_TEX = os.path.join(ROOT, 'public', 'assets', 'textures')
VALLEY = os.path.join(ROOT, 'tools', 'blender', 'build_valley.py')
os.makedirs(OUT_GEO, exist_ok=True)
os.makedirs(OUT_TEX, exist_ok=True)


def load_valley():
    """Ambil fungsi + konstanta dari build_valley.py tanpa menjalankan main()-nya (file itu milik agent lembah)."""
    with open(VALLEY, encoding='utf-8') as f:
        src = f.read()
    src = re.sub(r'^main\(\)\s*$', 'pass', src, flags=re.M)
    ns = {'__name__': 'build_valley', '__file__': VALLEY}
    exec(compile(src, VALLEY, 'exec'), ns)
    return ns


V = load_valley()
SAMPLES = int(ARGS[ARGS.index('--samples') + 1]) if '--samples' in ARGS else V['SAMPLES']
TEX = int(ARGS[ARGS.index('--tex') + 1]) if '--tex' in ARGS else V['TEX_HI']
GROUND_SAMPLES = int(ARGS[ARGS.index('--ground-samples') + 1]) if '--ground-samples' in ARGS else SAMPLES
GRID = V['GRID']

# ---------- bentuk ----------
Y0 = -0.55            # kaki igloo (three y), tanah plateau di -0.5
A_OUT, B_OUT = 2.6, 4.25   # elips luar: radius horizontal, tinggi dari Y0 (puncak 3.7)
THICK = 0.55
A_MID, B_MID = A_OUT - THICK / 2, B_OUT - THICK / 2
GAP = 0.034           # setengah celah antar bata
BEVEL = 0.075
SEG_LEN = 0.16        # panjang segmen bagian datar
BEVEL_STEPS = 2       # langkah per setengah bevel (bevel 90 derajat = 4 segmen)
# batas lapis sepanjang meridian (meter busur di elips tengah), sisanya tutup
S_BOUNDS = [0.0, 0.95, 1.85, 2.68, 3.45, 4.12, 4.62]
COURSE_COUNT = [11, 11, 13, 11, 8, 5]
# terowongan: profil superelips di bidang xy, diekstrusi sepanjang +z
TUN_N = 4.0           # eksponen superelips (makin besar makin kotak, bahu lebih menutup lubang kubah)
TUN_W_OUT = 1.0
TUN_THICK = 0.45
TUN_SEGMENTS = 5      # batu pelengkung per cincin (ganjil supaya ada batu kunci di puncak)
TUN_RINGS = [(1.70, 2.45), (2.45, 3.15)]
EXPLODE = 0.55        # bake meledak: posisi bata = centroid * (1 + EXPLODE) + angkat sedikit
RELIEF = 0.03        # amplitudo gumpalan salju (meter)
INNER_UV_SCALE = 0.3
UV_PAD = 8 / 2048     # jarak antar pulau UV (8 px di 2048)

rng = np.random.default_rng(20261006)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# ---------- noise 3D (value noise, deterministik) ----------
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
    v = np.zeros(len(p)); amp = 0.5; f = 1.0
    for o in range(octaves):
        v += vnoise3(p * f, seed + o * 3.7) * amp
        f *= 2.07; amp *= 0.5
    return v


# ---------- kurva dasar ----------
def build_meridian():
    """Tabel elips tengah kubah: busur s -> (r, y, normal r, normal y)."""
    t = np.linspace(0, np.pi / 2, 8192)
    r = A_MID * np.cos(t)
    y = Y0 + B_MID * np.sin(t)
    seg = np.hypot(np.diff(r), np.diff(y))
    s = np.concatenate([[0], np.cumsum(seg)])
    nr, ny = B_MID * np.cos(t), A_MID * np.sin(t)
    nl = np.hypot(nr, ny)
    return s, r, y, nr / nl, ny / nl


MER_S, MER_R, MER_Y, MER_NR, MER_NY = build_meridian()
S_TOTAL = float(MER_S[-1])


def meridian(s):
    return (np.interp(s, MER_S, MER_R), np.interp(s, MER_S, MER_Y),
            np.interp(s, MER_S, MER_NR), np.interp(s, MER_S, MER_NY))


def build_tunnel_profile(height):
    """Profil tengah terowongan (superelips), alpha 0 = kaki kanan (+x), pi = kaki kiri."""
    w_mid = TUN_W_OUT - TUN_THICK / 2
    h_mid = height - TUN_THICK / 2
    a = np.linspace(0, np.pi, 8193)
    c, s = np.cos(a), np.sin(a)
    x = w_mid * np.sign(c) * np.abs(c) ** (2 / TUN_N)
    y = Y0 + h_mid * np.abs(s) ** (2 / TUN_N)
    seg = np.hypot(np.diff(x), np.diff(y))
    arc = np.concatenate([[0], np.cumsum(seg)])
    tx, ty = np.gradient(x), np.gradient(y)
    tl = np.hypot(tx, ty)
    nx, ny = ty / tl, -tx / tl          # normal keluar (kanan dari arah jalan)
    nx[0], ny[0], nx[-1], ny[-1] = 1, 0, -1, 0
    # profil luar (untuk memotong bata kubah di samping pintu)
    ox, oy = x + nx * TUN_THICK / 2, y + ny * TUN_THICK / 2
    half = oy[: len(oy) // 2 + 1], ox[: len(ox) // 2 + 1]
    return arc, x, y, nx, ny, half


# ---------- rounded box di ruang parameter ----------
def axis_samples(h, r, segs_mid):
    inner = h - r
    ang = np.linspace(0, np.pi / 4, BEVEL_STEPS + 1)[1:]
    bev = inner + r * np.tan(ang)
    mid = np.linspace(-inner, inner, segs_mid + 1)
    return np.concatenate([-bev[::-1], mid, bev])


def rounded_box(hs, r):
    """Permukaan kotak bulat: vertex (param), quad, uv param per sudut quad, id muka kubus (0..5)."""
    segs = [max(2, int(round((2 * h - 2 * r) / SEG_LEN))) for h in hs]
    axes = [axis_samples(hs[i], r, segs[i]) for i in range(3)]
    n = [len(a) for a in axes]
    key_to_idx = {}
    P = []
    quads, quad_uv, quad_face = [], [], []
    eye = np.eye(3)
    for a in range(3):
        b, c = [k for k in range(3) if k != a]
        for side in (0, 1):
            ia = 0 if side == 0 else n[a] - 1
            sgn = -1 if side == 0 else 1
            flip = np.cross(eye[b], eye[c])[a] * sgn < 0

            def vid(i, j):
                idx = [0, 0, 0]
                idx[a] = ia; idx[b] = i; idx[c] = j
                key = tuple(idx)
                if key not in key_to_idx:
                    key_to_idx[key] = len(P)
                    P.append([axes[0][idx[0]], axes[1][idx[1]], axes[2][idx[2]]])
                return key_to_idx[key]

            for i in range(n[b] - 1):
                for j in range(n[c] - 1):
                    q = [vid(i, j), vid(i + 1, j), vid(i + 1, j + 1), vid(i, j + 1)]
                    uv = [(axes[b][i], axes[c][j]), (axes[b][i + 1], axes[c][j]),
                          (axes[b][i + 1], axes[c][j + 1]), (axes[b][i], axes[c][j + 1])]
                    if flip:
                        q, uv = q[::-1], uv[::-1]
                    quads.append(q); quad_uv.append(uv); quad_face.append(a * 2 + side)
    P = np.array(P)
    inner = np.array(hs) - r
    Q = np.clip(P, -inner, inner)
    D = P - Q
    L = np.linalg.norm(D, axis=1, keepdims=True)
    P = Q + D / np.maximum(L, 1e-9) * r
    return P, quads, quad_uv, quad_face


def rot_matrix(rx, ry, rz):
    cx, sx, cy, sy, cz, sz = math.cos(rx), math.sin(rx), math.cos(ry), math.sin(ry), math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return Rz @ Ry @ Rx


# ---------- tata letak bata ----------
def layout():
    """Daftar bata: tiap item punya fungsi map(P param) -> posisi three, plus half size dan info."""
    bricks = []
    # tinggi terowongan disamakan dengan batas atas lapis 1 (supaya tidak ada lubang di atas lengkung)
    r_top, y_top, nr_top, ny_top = meridian(S_BOUNDS[2])
    tun_height = float(y_top + ny_top * THICK / 2 - Y0 - GAP)
    arc, tx, ty, tnx, tny, (out_y, out_x) = build_tunnel_profile(tun_height)
    order = np.argsort(out_y)
    out_y, out_x = out_y[order], out_x[order]

    def x_cut(y):
        # sisi bata kubah di samping pintu mengikuti profil luar terowongan (minimal 0.6)
        return np.maximum(np.interp(y, out_y, out_x, right=0.0), 0.6) + 2 * GAP

    door_half = math.asin((TUN_W_OUT + 2 * GAP) / A_OUT)

    # kubah, lapis demi lapis
    for c, count in enumerate(COURSE_COUNT):
        s0, s1 = S_BOUNDS[c], S_BOUNDS[c + 1]
        sc = (s0 + s1) / 2
        rc = float(meridian(sc)[0])
        door = c <= 1
        start, span = (door_half, 2 * math.pi - 2 * door_half) if door else (0.0, 2 * math.pi)
        offset = 0.0 if door else (0.5 * (c % 2) + rng.uniform(-0.15, 0.15)) * span / count
        for k in range(count):
            g = GAP * rng.uniform(0.8, 1.25)
            p0 = start + offset + span * k / count
            p1 = p0 + span / count
            ga = g / rc
            phi0, phi1 = p0 + ga, p1 - ga
            hu = (phi1 - phi0) / 2 * rc
            hv = (s1 - s0) / 2 - g
            cut0 = door and k == 0
            cut1 = door and k == count - 1

            def mapper(P, sc=sc, phi0=phi0, phi1=phi1, hu=hu, cut0=cut0, cut1=cut1):
                r_m, y_m, nr, ny = meridian(sc + P[:, 1])
                r = r_m + nr * P[:, 2]
                y = y_m + ny * P[:, 2]
                a0 = np.arcsin(np.clip(x_cut(y) / r, 0, 1)) if cut0 else phi0
                a1 = 2 * math.pi - np.arcsin(np.clip(x_cut(y) / r, 0, 1)) if cut1 else phi1
                t = (P[:, 0] + hu) / (2 * hu)
                phi = a0 + t * (a1 - a0)
                return np.stack([r * np.sin(phi), y, r * np.cos(phi)], -1)

            bricks.append(dict(kind='dome', course=c, hs=(hu, hv, THICK / 2), map=mapper,
                               light=np.array([0.0, 0.9, 0.0])))

    # tutup puncak: kotak bulat yang dipetakan ke cakram lalu ditempel ke elips
    r_cap = float(meridian(S_BOUNDS[-1])[0]) - GAP

    def cap_mapper(P, h=r_cap):
        un, vn = P[:, 0] / h, P[:, 1] / h
        x = P[:, 0] * np.sqrt(np.clip(1 - vn * vn / 2, 0, 1))
        z = -P[:, 1] * np.sqrt(np.clip(1 - un * un / 2, 0, 1))
        rho2 = np.clip((x * x + z * z) / A_MID ** 2, 0, 0.99)
        y = Y0 + B_MID * np.sqrt(1 - rho2)
        n = np.stack([x / A_MID ** 2, (y - Y0) / B_MID ** 2, z / A_MID ** 2], -1)
        n /= np.linalg.norm(n, axis=1, keepdims=True)
        return np.stack([x, y, z], -1) + n * P[:, 2:3]

    bricks.append(dict(kind='cap', course=6, hs=(r_cap, r_cap, THICK / 2), map=cap_mapper,
                       light=np.array([0.0, 0.9, 0.0])))

    # terowongan: 2 cincin x 5 batu pelengkung
    arc_total = float(arc[-1])
    for (z0, z1) in TUN_RINGS:
        zc = (z0 + z1) / 2
        for k in range(TUN_SEGMENTS):
            g = GAP * rng.uniform(0.8, 1.25)
            a0, a1 = arc_total * k / TUN_SEGMENTS, arc_total * (k + 1) / TUN_SEGMENTS
            sc = (a0 + a1) / 2
            hu = (a1 - a0) / 2 - g
            hv = (z1 - z0) / 2 - g

            def tmapper(P, sc=sc, zc=zc):
                s = sc + P[:, 0]
                x = np.interp(s, arc, tx) + np.interp(s, arc, tnx) * P[:, 2]
                y = np.interp(s, arc, ty) + np.interp(s, arc, tny) * P[:, 2]
                return np.stack([x, y, zc + P[:, 1]], -1)

            bricks.append(dict(kind='tunnel', course=7, hs=(hu, hv, TUN_THICK / 2), map=tmapper,
                               light=np.array([0.0, 0.1, zc])))
    return bricks, tun_height


# ---------- packing UV ----------
def shelf_pack(rects, W, pad):
    order = sorted(range(len(rects)), key=lambda i: -rects[i][1])
    x = y = pad
    shelf = 0.0
    pos = [None] * len(rects)
    for i in order:
        w, h = rects[i]
        if x + w + pad > W:
            y += shelf + pad
            x, shelf = pad, 0.0
        pos[i] = (x, y)
        x += w + pad
        shelf = max(shelf, h)
    return pos, y + shelf + pad


def pack_square(rects):
    area = sum(w * h for w, h in rects)
    lo, hi = math.sqrt(area), math.sqrt(area) * 2
    best = None
    for _ in range(40):
        S = (lo + hi) / 2
        pos, H = shelf_pack(rects, S, UV_PAD * S)
        if H <= S:
            best = (S, pos)
            hi = S
        else:
            lo = S
    S, pos = best
    print(f'[uv] {len(rects)} pulau, efisiensi {area / (S * S) * 100:.1f}%', flush=True)
    return S, pos


# ---------- bangun mesh ----------
def build_igloo():
    bricks, tun_height = layout()
    cap = next(b for b in bricks if b['kind'] == 'cap')
    print(f'[igloo] {len(bricks)} bata, tinggi terowongan {tun_height:.3f}, radius tutup {cap["hs"][0]:.3f}', flush=True)
    verts, wparam, ids, lights = [], [], [], []
    quads, quad_uv, quad_face, quad_brick = [], [], [], []
    face_dims = []   # (brick, face) -> (w, h) param
    base = 0
    for bi, b in enumerate(bricks):
        hs = b['hs']
        P, q, quv, qf = rounded_box(hs, BEVEL)
        X = b['map'](P)
        # goyang kecil per bata (buatan tangan), diputar di centroid
        c0 = X.mean(0)
        R = rot_matrix(*rng.uniform(-0.026, 0.026, 3))
        X = c0 + (X - c0) @ R.T
        verts.append(X)
        wparam.append((P[:, 2] / hs[2] + 1) / 2)   # 0 = muka dalam, 1 = muka luar
        ids.append(np.full(len(P), bi))
        lights.append(np.repeat(b['light'][None], len(P), 0))
        quads.extend([[i + base for i in qq] for qq in q])
        quad_uv.extend(quv)
        quad_face.extend(qf)
        quad_brick.extend([bi] * len(q))
        for f in range(6):
            a = f // 2
            bb, cc = [k for k in range(3) if k != a]
            face_dims.append((bi, f, 2 * hs[bb], 2 * hs[cc]))
        base += len(P)
    V3 = np.concatenate(verts)
    W = np.concatenate(wparam)
    ID = np.concatenate(ids)
    LIGHT = np.concatenate(lights)
    nb = len(bricks)

    # pulau UV: satu per muka kubus per bata
    rects, rect_info = [], {}
    for (bi, f, w, h) in face_dims:
        sc = INNER_UV_SCALE if f == 4 else 1.0   # f 4 = muka -w (dalam)
        rot = h > w
        rw, rh = (h, w) if rot else (w, h)
        rect_info[(bi, f)] = (len(rects), rot, sc)
        rects.append((rw * sc, rh * sc))
    S, pos = pack_square(rects)
    loop_uv = np.zeros((len(quads), 4, 2))
    for qi, (bi, f) in enumerate(zip(quad_brick, quad_face)):
        ri, rot, sc = rect_info[(bi, f)]
        _, _, w, h = face_dims[bi * 6 + f]
        ox, oy = pos[ri]
        for k, (pb, pc) in enumerate(quad_uv[qi]):
            lu, lv = (pb + w / 2) * sc, (pc + h / 2) * sc
            if rot:
                lu, lv = lv, lu
            loop_uv[qi, k] = ((ox + lu) / S, (oy + lv) / S)
    with open(os.path.join(OUT_GEO, 'igloo_uv_rects.json'), 'w') as fp:
        # [u0, v0, u1, v1, muka] muka: 0..5 = -u +u -v +v -w(dalam) +w(luar)
        json.dump([[x / S, y / S, (x + w) / S, (y + h) / S, f] for ((x, y), (w, h)), (_, f, _, _)
                   in zip(zip(pos, rects), face_dims)], fp)

    # mesh Blender (konversi three -> Blender: (x, -z, y))
    to_b = lambda A: np.stack([A[:, 0], -A[:, 2], A[:, 1]], -1)
    me = bpy.data.meshes.new('igloo')
    me.from_pydata(to_b(V3).tolist(), [], quads)
    me.update()
    me.uv_layers.new(name='UVMap').data.foreach_set('uv', loop_uv.ravel())
    for p in me.polygons:
        p.use_smooth = True

    # pastikan semua muka menghadap keluar dari centroid bata (jaga-jaga pemetaan membalik orientasi)
    flipped = 0
    for bi in range(nb):
        sel = np.where(np.array(quad_brick) == bi)[0]
        cen = V3[ID == bi].mean(0)
        score = 0.0
        for pi in sel[:: max(1, len(sel) // 40)]:
            poly = me.polygons[int(pi)]
            n = np.array(poly.normal); ctr = np.array(poly.center)
            n3 = np.array([n[0], n[2], -n[1]]); c3 = np.array([ctr[0], ctr[2], -ctr[1]])
            score += float(np.dot(n3, c3 - cen))
        if score < 0:
            flipped += 1
            for pi in sel:
                me.polygons[int(pi)].flip()
    if flipped:
        print(f'[igloo] {flipped} bata dibalik orientasinya', flush=True)
    me.update()

    # relief salju: gumpalan rendah frekuensi di sepanjang normal
    nrm = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('normal', nrm)
    nrm = nrm.reshape(-1, 3)
    N3 = np.stack([nrm[:, 0], nrm[:, 2], -nrm[:, 1]], -1)
    lump = (fbm3(V3 * 2.3, 4, 1.0) - 0.5) * 2 * RELIEF + (fbm3(V3 * 7.0, 3, 5.0) - 0.5) * 0.008
    V3 = V3 + N3 * lump[:, None]
    me.vertices.foreach_set('co', to_b(V3).ravel())
    me.update()
    nrm = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('normal', nrm)
    nrm = nrm.reshape(-1, 3)
    N3 = np.stack([nrm[:, 0], nrm[:, 2], -nrm[:, 1]], -1)

    # atribut
    centr = np.zeros((nb, 3))
    for bi in range(nb):
        centr[bi] = V3[ID == bi].mean(0)
    rnd = rng.uniform(0.005, 0.995, (nb, 3))
    to_light = LIGHT - V3
    to_light /= np.linalg.norm(to_light, axis=1, keepdims=True)
    ndl = np.sum(N3 * to_light, 1)
    glow = np.clip(0.62 * smoothstep(-0.25, 1.0, ndl) + 0.38 * (1 - W) ** 2, 0, 1)
    emission = np.clip(0.1 + 0.985 * glow + (fbm3(V3 * 3.0, 2, 9.0) - 0.5) * 0.02, 0.0995, 1.085)

    def attr(name, typ, data, key):
        a = me.attributes.new(name=name, type=typ, domain='POINT')
        a.data.foreach_set(key, data.ravel())

    attr('_batchid', 'INT', ID.astype(np.int32), 'value')
    attr('_centr', 'FLOAT_VECTOR', centr[ID].astype(np.float32), 'vector')
    attr('_rand', 'FLOAT_VECTOR', rnd[ID].astype(np.float32), 'vector')
    attr('_emission', 'FLOAT', emission.astype(np.float32), 'value')

    obj = bpy.data.objects.new('igloo', me)
    bpy.context.scene.collection.objects.link(obj)
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    cy = centr[:, 1]
    print(f'[igloo] {len(me.vertices)} vertex, {tris} tris, centroid y {cy.min():.2f}..{cy.max():.2f}, '
          f'emisi {emission.min():.3f}..{emission.max():.3f}', flush=True)
    bbox = np.array([V3.min(0), V3.max(0)])
    print(f'[igloo] bbox three min {np.round(bbox[0], 3)} max {np.round(bbox[1], 3)}', flush=True)
    return obj, centr, ID


def exploded_copy(obj, centr, ID):
    me = obj.data.copy()
    me.name = 'igloo_exploded'
    co = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3)
    off3 = centr[ID] * EXPLODE + np.array([0.0, 0.06, 0.0])
    co += np.stack([off3[:, 0], -off3[:, 2], off3[:, 1]], -1)
    me.vertices.foreach_set('co', co.ravel())
    me.update()
    o = bpy.data.objects.new('igloo_exploded', me)
    bpy.context.scene.collection.objects.link(o)
    return o


def brick_material(name='brick_snow'):
    """Salju padat bata: albedo sama dengan salju lembah, butiran + gumpalan lewat bump di koordinat objek."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (0.86, 0.88, 0.93, 1)
    bsdf.inputs['Roughness'].default_value = 0.92
    coord = nt.nodes.new('ShaderNodeTexCoord')
    fine = nt.nodes.new('ShaderNodeTexNoise')
    fine.inputs['Scale'].default_value = 16.0
    fine.inputs['Detail'].default_value = 4.0
    coarse = nt.nodes.new('ShaderNodeTexNoise')
    coarse.inputs['Scale'].default_value = 3.5
    coarse.inputs['Detail'].default_value = 1.0
    mix = nt.nodes.new('ShaderNodeMath')
    mix.operation = 'MULTIPLY_ADD'
    mix.inputs[1].default_value = 0.6
    nt.links.new(coord.outputs['Object'], fine.inputs['Vector'])
    nt.links.new(coord.outputs['Object'], coarse.inputs['Vector'])
    nt.links.new(fine.outputs['Fac'], mix.inputs[0])
    nt.links.new(coarse.outputs['Fac'], mix.inputs[2])
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.2
    nt.links.new(mix.outputs['Value'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def bake_rgba(obj, path, size):
    """Bake DIFFUSE (langsung + tidak langsung + warna) ke PNG RGBA; alpha 0 = piksel yang tidak kena pulau."""
    img = bpy.data.images.new(os.path.basename(path), size, size, alpha=True, float_buffer=True)
    img.colorspace_settings.name = 'sRGB'
    img.generated_color = (0, 0, 0, 0)
    nt = obj.active_material.node_tree
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
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT', 'COLOR'}, margin=16, use_clear=True)
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    nt.nodes.remove(node)
    px = np.empty(size * size * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(-1, 4)
    cov = px[:, 3] > 0.5
    print(f'[bake] {os.path.relpath(path, ROOT)} {size}px {time.time() - t0:.1f}s, cakupan {cov.mean() * 100:.1f}%', flush=True)


def export_glb(obj, path):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format='GLB', export_yup=True,
                              export_normals=False, export_texcoords=True, export_attributes=True,
                              export_materials='NONE', export_apply=True)
    print(f'[export] {os.path.relpath(path, ROOT)} {os.path.getsize(path) / 1024:.1f} KB', flush=True)


def render_preview(path):
    """Render cepat dari titik istirahat kamera (blueprint 6.4) untuk cek bentuk."""
    from mathutils import Vector
    sc = bpy.context.scene
    cam = bpy.data.cameras.new('cam')
    cam.sensor_fit = 'VERTICAL'
    cam.angle = math.radians(30)
    co = bpy.data.objects.new('cam', cam)
    sc.collection.objects.link(co)
    co.location = (-13.49, -14.43, 2.65)
    d = Vector((0, 0, 1.24)) - co.location
    co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.camera = co
    sc.render.resolution_x, sc.render.resolution_y = 800, 600
    old = sc.cycles.samples
    sc.cycles.samples = 24
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    sc.cycles.samples = old
    print(f'[preview] {os.path.relpath(path, ROOT)}', flush=True)


def main():
    t0 = time.time()
    V['reset_scene']()
    bpy.context.scene.cycles.samples = SAMPLES
    # pencahayaan = bake tanah lembah (dibaca dari build_valley.py supaya selalu sama)
    V['set_world'](V.get('SKY_COLOR', (0.60, 0.65, 0.80)), V['SKY_STRENGTH'])
    V['add_sun'](elev_deg=30, azim_deg=8, energy=V.get('SUN_ENERGY', 1.25), angle_deg=12)
    igloo, centr, ID = build_igloo()
    igloo.data.materials.append(brick_material())
    ground = V['make_heightfield']('ground', 24, 24, GRID, V['ground_height'])
    ground.data.materials.append(V['snow_material']('snow'))
    export_glb(igloo, os.path.join(OUT_GEO, 'igloo.glb'))
    if PREVIEW:
        render_preview(os.path.join(OUT_GEO, 'igloo_preview.png'))
    if NO_BAKE:
        print(f'[done] {time.time() - t0:.1f}s (tanpa bake)', flush=True)
        return
    if ONLY in ('all', 'igloo'):
        # bata: pantulan dibatasi (ruang dalam kubah tertutup bikin jalur cahaya memantul sampai batas)
        cy = bpy.context.scene.cycles
        saved = (cy.max_bounces, cy.diffuse_bounces, cy.glossy_bounces, cy.transmission_bounces)
        cy.max_bounces, cy.diffuse_bounces, cy.glossy_bounces, cy.transmission_bounces = 3, 3, 0, 0
        bake_rgba(igloo, os.path.join(OUT_TEX, 'igloo_color.png'), TEX)
        ex = exploded_copy(igloo, centr, ID)
        igloo.hide_render = True
        bake_rgba(ex, os.path.join(OUT_TEX, 'igloo_exploded_color.png'), TEX)
        ex.hide_render = True
        igloo.hide_render = False
        cy.max_bounces, cy.diffuse_bounces, cy.glossy_bounces, cy.transmission_bounces = saved
    if ONLY in ('all', 'ground'):
        # tanah dengan igloo rakit: bayangan kontak + AO di kaki igloo, UV planar sama dengan ground_color
        bpy.context.scene.cycles.samples = GROUND_SAMPLES
        V['bake'](ground, os.path.join(OUT_TEX, 'ground_color_igloo.png'), TEX)
    print(f'[done] {time.time() - t0:.1f}s', flush=True)


main()
