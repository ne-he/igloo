"""Bangun volume SDF untuk partikel ruang link (M7b, blueprint 5.5 dan 8.2 aset 17).

Pakai:  python tools/volumes/build_volumes.py [--res 64] [--only github,linkedin] [--out DIR] [--preview]

Bentuk (ruang koordinat = uvw volume 0..1, pusat 0.5, y ke atas, jarak dalam satuan uvw):
  - nehemiah: avatar dada 3D generik (kepala bulat, leher, bahu), tanpa ciri wajah
  - github  : GitHub mark resmi (Invertocat di lingkaran), dari path simple-icons (data path CC0), diekstrusi.
              Kucingnya ruang kosong (dilubangi tembus), sama seperti logo aslinya.
  - linkedin: lempeng persegi membulat dengan huruf "in" tebal dilubangi tembus (gaya ikon LinkedIn, huruf
              disusun sendiri dari primitif SDF)
  - whatsapp: logo WhatsApp resmi (gelembung chat + gagang telepon), path simple-icons, garis ditebalkan
  - email   : amplop tebal, lipatan V timbul tebal di muka depan dan belakang

Kenapa semua bentuk sekarang berupa lempeng/benda tebal (catatan fix 19 Okt 2026):
  Sim partikel (Particles.js) menarik partikel di LUAR bentuk ke permukaan terdekat, partikel di DALAM bebas,
  dan semua partikel ditarik pegas lemah ke posisi awal acaknya di kubus. Hanya partikel yang posisi awalnya
  memang di dalam bentuk yang diam mengisi badan. LinkedIn lama (huruf "in" setebal 0.15, batang 0.124,
  2.7% voxel di dalam) hampir seluruhnya bergantung pada kulit, dan kulit itu (1) diwarisi dari bentuk
  sebelumnya: batang "i" dan kaki kanan "n" ada di luar jejak emblem GitHub lama yang sempit, jadi nyaris
  kosong, dan (2) pelan-pelan terseret ke sumbu putar karena posisi awal diam sementara bentuk berputar.
  Dua-duanya diperbaiki di sim (PARTICLES.assign dan PARTICLES.spinTargets di Particles.js). Di sini bentuk
  dibuat tebal: volume igloo asli sekitar 8 sampai 10% voxel di dalam, target di sini 6 sampai 10%.

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
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'volumes')
sys.path.insert(0, HERE)
import svgpath  # noqa: E402

# Path resmi (viewBox 24x24), sama dengan yang dipakai situs ICEBERG Nehemiah (icev2/src/ParticleFace.jsx).
# Sumber: simple-icons (data path CC0). Logo dipakai untuk menautkan profil/kontak pemiliknya sendiri.
GITHUB_PATH = (
    'M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04'
    '-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838'
    ' 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0'
    '-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006'
    ' 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61'
    '-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24'
    ' 17.592 24 12.297c0-6.627-5.373-12-12-12'
)
WHATSAPP_PATH = (
    'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199'
    '-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134'
    '-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242'
    '-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462'
    ' 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571'
    '-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87'
    ' 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884'
    ' 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413'
    '-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305'
    '-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z'
)


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


def sd_box2(px, py, cx, cy, hx, hy):
    dx = np.abs(px - cx) - hx
    dy = np.abs(py - cy) - hy
    out = np.sqrt(np.maximum(dx, 0) ** 2 + np.maximum(dy, 0) ** 2)
    return out + np.minimum(np.maximum(dx, dy), 0.0)


def sd_ellipsoid(p, c, r):
    """Ellipsoid (pendekatan jarak yang terbatas baik, Quilez)."""
    q = p - np.asarray(c, float)
    r = np.asarray(r, float)
    k0 = length(q / r)
    k1 = np.maximum(length(q / (r * r)), 1e-9)
    return k0 * (k0 - 1.0) / k1


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


# ---------- bentuk ----------
_FIELDS = {}


def path_field(key, d, size, subpaths=None):
    """SDF 2D dari path SVG (di-cache, rasterisasi 1024 sekali per bentuk)."""
    if key not in _FIELDS:
        _FIELDS[key] = svgpath.field_from_path(d, (0, 0, 24, 24), size, subpaths=subpaths)
    return _FIELDS[key]


def shape_nehemiah(p):
    """Avatar dada generik: kepala telur, leher, bahu membulat yang dipotong datar di bawah. Tanpa ciri wajah."""
    x, y, z = p[..., 0], p[..., 1], p[..., 2]
    head = sd_ellipsoid(p, (0.0, 0.175, 0.0), (0.145, 0.17, 0.155))
    neck = sd_capsule(p, (0.0, -0.06, 0.0), (0.0, 0.06, 0.0), 0.068)
    torso = sd_ellipsoid(p, (0.0, -0.33, 0.0), (0.36, 0.23, 0.2))
    torso = np.maximum(torso, -(y + 0.43))  # dasar datar seperti patung dada
    d = smin(head, neck, 0.04)
    return smin(d, torso, 0.07)


def shape_github(p):
    """GitHub mark: cakram setebal 0.18 dengan siluet kucing dilubangi tembus (path resmi)."""
    x, y, z = p[..., 0], p[..., 1], p[..., 2]
    d2 = path_field('github', GITHUB_PATH, 0.86)(x, y)
    return extrude(d2, z, 0.09, 0.03)


def letters_in(x, y):
    """Huruf "in" tebal (2D) untuk lubang di lempeng LinkedIn. Batang 0.13, celah huruf n 0.1."""
    i_stem = sd_box2(x, y, -0.205, -0.085, 0.065, 0.205)
    i_dot = np.sqrt((x + 0.205) ** 2 + (y - 0.215) ** 2) - 0.075
    n_left = sd_box2(x, y, 0.005, -0.085, 0.065, 0.205)
    n_right = sd_box2(x, y, 0.235, -0.16, 0.065, 0.13)
    # lengkung atas n: cincin pusat (0.12, -0.03), jari-jari luar 0.18, dalam 0.05, setengah atas saja
    cx, cy = 0.12, -0.03
    r = np.sqrt((x - cx) ** 2 + (y - cy) ** 2)
    arch = np.maximum(np.abs(r - 0.115) - 0.065, -(y - cy))
    return np.minimum.reduce([i_stem, i_dot, n_left, n_right, arch])


def shape_linkedin(p):
    """Lempeng persegi membulat (0.8, sudut r 0.09) setebal 0.18, huruf "in" dilubangi tembus."""
    x, y, z = p[..., 0], p[..., 1], p[..., 2]
    xs = x + 0.02  # huruf sedikit ke kiri bawah seperti ikonnya, lempeng tetap di tengah
    plate = sd_box2(x, y, 0.0, 0.0, 0.4 - 0.09, 0.4 - 0.09) - 0.09
    d2 = np.maximum(plate, -letters_in(xs, y + 0.02))
    return extrude(d2, z, 0.09, 0.03)


def shape_whatsapp(p):
    """Logo WhatsApp: cincin gelembung + gagang telepon. Path asli: subpath 0 = gagang, 1 + 2 = cincin (lingkaran
    dalam dan luar). Cincin aslinya cuma selebar 0.07 (4 voxel): di partikel sisi kiri dan kanannya bolong
    (diukur 19 Okt, 25% sel muka kosong sebelum perbaikan sim). Jadi cincin ditebalkan 0.032 tiap sisi
    (lebar sekitar 0.13), gagang 0.014, lempeng setebal 0.26 supaya badan cincin berisi partikel yang posisi
    awalnya memang di dalam. Celah gagang ke cincin tetap terbuka (sekitar 0.04)."""
    x, y, z = p[..., 0], p[..., 1], p[..., 2]
    ring = path_field('whatsapp_ring', WHATSAPP_PATH, 0.8, subpaths=(1, 2))(x, y) - 0.032
    handset = path_field('whatsapp_handset', WHATSAPP_PATH, 0.8, subpaths=(0,))(x, y) - 0.014
    return extrude(np.minimum(ring, handset), z, 0.13, 0.035)


def shape_email(p):
    """Amplop tebal (setebal 0.17) dengan lipatan V timbul tebal di muka depan dan belakang."""
    x, y, z = p[..., 0], p[..., 1], p[..., 2]
    h = 0.085
    body = extrude(sd_box2(x, y, 0.0, 0.0, 0.42 - 0.04, 0.28 - 0.04) - 0.04, z, h, 0.035)
    d = body
    for zs in (-h, h):
        for a, b in (((-0.37, 0.235, zs), (0.0, -0.035, zs)), ((0.37, 0.235, zs), (0.0, -0.035, zs))):
            d = smin(d, sd_capsule(p, a, b, 0.036), 0.02)
    # bibir lipatan bawah supaya amplop tidak terbaca sebagai kotak polos
    for zs in (-h, h):
        for a, b in (((-0.37, -0.235, zs), (-0.11, 0.0, zs)), ((0.37, -0.235, zs), (0.11, 0.0, zs))):
            d = smin(d, sd_capsule(p, a, b, 0.024), 0.015)
    return d


SHAPES = {
    'nehemiah': shape_nehemiah,
    'github': shape_github,
    'linkedin': shape_linkedin,
    'whatsapp': shape_whatsapp,
    'email': shape_email,
}


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
    """Proyeksi biner tiap bentuk: depan (muka yang menghadap kamera saat reset) dan samping."""
    from PIL import Image
    tiles = []
    for name, (d, _g) in vols.items():
        inside = d < 0  # [z][y][x], muka bentuk ada di bidang (z volume, y)
        front = np.flipud(inside.any(axis=2).T[:, ::-1])  # [y][z], -z volume = +x bentuk
        side = np.flipud(inside.any(axis=0))  # [y][x]
        tiles.append(np.concatenate([front, side], axis=1).astype(np.uint8) * 255)
    img = np.concatenate(tiles, axis=0)
    Image.fromarray(img).resize((img.shape[1] * 3, img.shape[0] * 3), Image.NEAREST).save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--res', type=int, default=64)
    ap.add_argument('--only', default='', help='nama bentuk dipisah koma (default semua)')
    ap.add_argument('--out', default=OUT, help='folder hasil .vol (default public/assets/volumes)')
    ap.add_argument('--preview', action='store_true')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    names = [n for n in args.only.split(',') if n] or list(SHAPES)
    vols = {}
    total = 0
    for name in names:
        d, g = build(SHAPES[name], args.res)
        vols[name] = (d, g)
        data = pack(encode(d, g), args.res)
        path = os.path.join(args.out, f'{name}_{args.res}.vol')
        with open(path, 'wb') as f:
            f.write(data)
        total += len(data)
        inside = (d < 0).mean() * 100
        print(f'{name:9s} {args.res}^3  dalam {inside:4.1f}%  jarak {d.min():+.3f}..{d.max():+.3f}  '
              f'{len(data) / 1024:6.1f} KB  {path}')
    print(f'total {total / 1024:.1f} KB')
    if args.preview:
        prev = os.path.join(ROOT, 'tools', 'verify', 'out', 'm7b_volumes.png')
        preview(vols, prev)
        print('preview:', os.path.relpath(prev, ROOT))


if __name__ == '__main__':
    main()
