"""Bangun 3 volume SDF untuk partikel ruang link (M7b, blueprint 5.5 dan 8.2 aset 17).

Pakai:  python tools/volumes/build_volumes.py [--res 64] [--preview]

Semua bentuk dirancang sendiri dan disusun dari primitif SDF analitik (numpy murni, tanpa mesh, tanpa Blender):
  - github  : emblem "cabang": tiga cincin simpul (torus) disambung batang dan satu lengkung cabang (gaya git branch)
  - linkedin: huruf "in" kecil yang tebal, diekstrusi, sudut dibulatkan
  - email   : amplop, kotak membulat dengan lipatan V timbul di depan dan belakang

Ruang koordinat = uvw volume 0..1 (pusat 0.5), y ke atas. Jarak dalam satuan uvw.
Encoding (sama dengan pembacaan shader sim):
  RGB = gradient ternormalisasi * 0.5 + 0.5      -> shader: normalize(rgb * 2 - 1)
  A   = jarak / 4 + 0.5                          -> shader: (a * 2 - 1) * 2
Format file .vol (dibaca src/scenes/entry/volumes.js):
  header 16 byte: 'SDF1', uint32 res, uint32 jumlah byte terkompres, uint32 cadangan (0)
  isi = gzip( 4 bidang planar R,G,B,A, tiap bidang di-delta per baris x (byte - byte sebelumnya, mod 256) )
  Delta + planar membuat gzip jauh lebih efektif karena medan jarak dan gradient halus.
"""
import argparse
import gzip
import os
import struct

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'volumes')


# ---------- primitif SDF (p = array (..., 3), pusat 0) ----------
def length(v):
    return np.sqrt(np.sum(v * v, axis=-1))


def sd_capsule(p, a, b, r):
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    pa = p - a
    ba = b - a
    h = np.clip(np.sum(pa * ba, axis=-1) / np.dot(ba, ba), 0.0, 1.0)
    return length(pa - h[..., None] * ba) - r


def sd_torus_z(p, c, big_r, small_r):
    """Torus di bidang XY (sumbu z), pusat c."""
    q = p - np.asarray(c, float)
    ring = np.sqrt(q[..., 0] ** 2 + q[..., 1] ** 2) - big_r
    return np.sqrt(ring ** 2 + q[..., 2] ** 2) - small_r


def sd_box2(px, py, cx, cy, hx, hy):
    dx = np.abs(px - cx) - hx
    dy = np.abs(py - cy) - hy
    out = np.sqrt(np.maximum(dx, 0) ** 2 + np.maximum(dy, 0) ** 2)
    return out + np.minimum(np.maximum(dx, dy), 0.0)


def extrude(d2, z, h, r):
    """Ekstrusi SDF 2D setebal 2h di z, tepi dibulatkan r."""
    wx = d2 + r
    wy = np.abs(z) - h + r
    out = np.sqrt(np.maximum(wx, 0) ** 2 + np.maximum(wy, 0) ** 2)
    return np.minimum(np.maximum(wx, wy), 0.0) + out - r


def smin(a, b, k):
    """Union halus (polinomial), sambungan tidak bersudut tajam."""
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)


def bezier_points(p0, p1, p2, n):
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 2 * np.asarray(p0) + 2 * (1 - t) * t * np.asarray(p1) + t ** 2 * np.asarray(p2)


# ---------- bentuk ----------
def shape_github(p):
    """Emblem cabang: batang utama A-B, cabang lengkung dari C turun menyatu ke batang."""
    tube = 0.046
    ring_r, ring_t = 0.095, 0.04
    A = (-0.13, -0.30, 0.0)
    B = (-0.13, 0.30, 0.0)
    C = (0.17, 0.14, 0.0)
    d = sd_torus_z(p, A, ring_r, ring_t)
    d = np.minimum(d, sd_torus_z(p, B, ring_r, ring_t))
    d = np.minimum(d, sd_torus_z(p, C, ring_r, ring_t))
    # batang utama di antara dua cincin (tidak menembus lubang cincin)
    stem = sd_capsule(p, (A[0], A[1] + ring_r, 0), (B[0], B[1] - ring_r, 0), tube)
    d = smin(d, stem, 0.02)
    # cabang: kurva kuadratik dari bawah cincin C, turun lalu membelok ke batang
    pts = bezier_points((C[0], C[1] - ring_r, 0.0), (C[0], -0.12, 0.0), (A[0] + 0.01, -0.16, 0.0), 14)
    br = None
    for i in range(len(pts) - 1):
        s = sd_capsule(p, pts[i], pts[i + 1], tube)
        br = s if br is None else np.minimum(br, s)
    return smin(d, br, 0.03)


def shape_linkedin(p):
    """Huruf "in" kecil tebal, ekstrusi setebal 0.15, tepi membulat."""
    x, y, z = p[..., 0], p[..., 1], p[..., 2]
    x = x + 0.01
    # i: batang + titik bulat
    i_stem = sd_box2(x, y, -0.27, -0.12, 0.062, 0.2)
    i_dot = np.sqrt((x + 0.27) ** 2 + (y - 0.21) ** 2) - 0.075
    # n: batang kiri, batang kanan, lengkung atas (setengah cincin)
    n_left = sd_box2(x, y, -0.06, -0.12, 0.062, 0.2)
    n_right = sd_box2(x, y, 0.25, -0.21, 0.062, 0.11)
    # lengkung: jari-jari tengah 0.155 tepat menyambung sisi luar batang kiri ke sisi luar batang kanan
    cx, cy = 0.095, -0.1
    ring = np.abs(np.sqrt((x - cx) ** 2 + (y - cy) ** 2) - 0.155) - 0.062
    arch = np.maximum(ring, -(y - cy))
    d2 = np.minimum.reduce([i_stem, i_dot, n_left, n_right, arch])
    return extrude(d2, z, 0.075, 0.025)


def shape_email(p):
    """Amplop: kotak membulat tipis + lipatan V timbul di muka depan dan belakang."""
    x, y, z = p[..., 0], p[..., 1], p[..., 2]
    body = extrude(sd_box2(x, y, 0.0, 0.0, 0.4, 0.26), z, 0.055, 0.03)
    d = body
    for zs in (-0.06, 0.06):
        for a, b in (((-0.36, 0.22, zs), (0.0, -0.04, zs)), ((0.36, 0.22, zs), (0.0, -0.04, zs))):
            d = smin(d, sd_capsule(p, a, b, 0.024), 0.015)
    # bibir lipatan bawah (garis V terbalik halus) supaya amplop tidak terbaca sebagai kotak polos
    for zs in (-0.058, 0.058):
        for a, b in (((-0.36, -0.22, zs), (-0.1, 0.0, zs)), ((0.36, -0.22, zs), (0.1, 0.0, zs))):
            d = smin(d, sd_capsule(p, a, b, 0.014), 0.012)
    return d


SHAPES = {'github': shape_github, 'linkedin': shape_linkedin, 'email': shape_email}


def grid(res):
    c = (np.arange(res) + 0.5) / res - 0.5
    z, y, x = np.meshgrid(c, c, c, indexing='ij')  # urutan [z][y][x] = urutan memori Data3DTexture
    return np.stack([x, y, z], axis=-1)


def facing(fn):
    """Putar bentuk 90 derajat di Y: sim membaca volume di rotY(uRotation) * posisi, dan uRotation di-reset ke
    1.5 PI saat ganti link. Dengan putaran ini muka depan bentuk (dirancang di bidang XY, x ke kanan) menghadap
    kamera tepat saat reset, lalu berputar menjauh."""
    def wrapped(p):
        # digabung dengan rotY(1.5 PI) di shader hasilnya putaran 180 derajat (bukan cermin): kamera di -z melihat
        # ke +z, kanan layar = -x dunia = +x bentuk, jadi huruf terbaca benar
        return fn(np.stack([-p[..., 2], p[..., 1], p[..., 0]], axis=-1))
    return wrapped


def build(fn, res):
    fn = facing(fn)
    p = grid(res)
    d = fn(p)
    # gradient analitik lewat beda pusat setengah voxel (bukan beda antar voxel), stabil di dekat permukaan
    h = 0.5 / res
    g = np.zeros_like(p)
    for k in range(3):
        e = np.zeros(3)
        e[k] = h
        g[..., k] = fn(p + e) - fn(p - e)
    n = length(g)
    # titik tanpa gradient (simetri sempurna): pakai arah dari pusat, hindari normalize(0) = NaN di shader
    bad = n < 1e-9
    fallback = p / np.maximum(length(p), 1e-6)[..., None]
    g = np.where(bad[..., None], fallback, g / np.maximum(n, 1e-12)[..., None])
    return d, g


def encode(d, g):
    rgb = np.clip(np.round((g * 0.5 + 0.5) * 255), 0, 255).astype(np.uint8)
    a = np.clip(np.round((d / 4 + 0.5) * 255), 0, 255).astype(np.uint8)
    return np.concatenate([rgb, a[..., None]], axis=-1)  # [z][y][x][4]


def pack(rgba, res):
    planes = np.moveaxis(rgba, -1, 0).astype(np.int16)  # [4][z][y][x]
    delta = planes.copy()
    delta[..., 1:] = planes[..., 1:] - planes[..., :-1]
    raw = (delta % 256).astype(np.uint8).tobytes()
    comp = gzip.compress(raw, compresslevel=9, mtime=0)
    return struct.pack('<4sIII', b'SDF1', res, len(comp), 0) + comp


def preview(vols, path):
    from PIL import Image
    tiles = []
    for name, (d, _g) in vols.items():
        inside = d < 0
        row = []
        for ax in (0, 2):  # proyeksi depan (sumbu z) dan samping (sumbu x)
            proj = inside.any(axis=ax).astype(np.uint8) * 255
            row.append(np.flipud(proj))
        tiles.append(np.concatenate(row, axis=1))
    img = np.concatenate(tiles, axis=0)
    Image.fromarray(img).resize((img.shape[1] * 3, img.shape[0] * 3), Image.NEAREST).save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--res', type=int, default=64)
    ap.add_argument('--preview', action='store_true')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    vols = {}
    total = 0
    for name, fn in SHAPES.items():
        d, g = build(fn, args.res)
        vols[name] = (d, g)
        data = pack(encode(d, g), args.res)
        path = os.path.join(OUT, f'{name}_{args.res}.vol')
        with open(path, 'wb') as f:
            f.write(data)
        total += len(data)
        inside = (d < 0).mean() * 100
        print(f'{name:9s} {args.res}^3  dalam {inside:4.1f}%  jarak {d.min():+.3f}..{d.max():+.3f}  '
              f'{len(data) / 1024:6.1f} KB  {os.path.relpath(path, ROOT)}')
    print(f'total {total / 1024:.1f} KB')
    if args.preview:
        prev = os.path.join(ROOT, 'tools', 'verify', 'out', 'm7b_volumes.png')
        preview(vols, prev)
        print('preview:', os.path.relpath(prev, ROOT))


if __name__ == '__main__':
    main()
