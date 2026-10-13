"""Bangkitkan tekstur scene kristal (M5a). Semua buatan sendiri, tidak ada string/gambar igloo.

Pakai:  python tools/textures/gen_crystal_textures.py
Output di public/assets/textures/:
  crystals_env.hdr           512x256  Radiance RGBE (RLE). Langit mendung abu, satu titik matahari terang
                                      (puncak sekitar 3100) di atas belakang kamera, sorotan lembut di bawah.
  dot_pattern.png             64      satu titik putih kecil di pojok tile (grid titik latar, di-tile 45x)
  blurrytext_atlas.png       512      8 baris teks mono yang sudah di-blur (blur di-bake, tanpa blur pass)
  blurrytext_atlas.json               kotak UV tiap baris + rasio aspek, dibaca CrystalsScene
  shapes_blurred.png      512x1024    8 gambar polihedra wireframe, tingkat blur berbeda (tajam sampai buram)
Arah di env ditulis dalam ruang dunia three lalu diputar PI di sumbu Y (material memakai envMapRotation.y = PI),
jadi yang dilihat kamera kristal (menatap -z) sama dengan yang ditulis di DUNIA di bawah.
"""
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'textures')
rng = np.random.default_rng(2610)


# ---------------------------------------------------------------- env HDR
def _rle(ch):
    """RLE Radiance per kanal: paket run (128 + n, nilai) untuk >= 4 byte sama, sisanya paket literal (n, byte...)."""
    out = bytearray()
    i, n = 0, len(ch)
    lit = bytearray()

    def flush():
        for k in range(0, len(lit), 128):
            part = lit[k:k + 128]
            out.append(len(part))
            out.extend(part)
        lit.clear()

    while i < n:
        j = i
        while j < n and j - i < 127 and ch[j] == ch[i]:
            j += 1
        if j - i >= 4:
            flush()
            out.append(128 + (j - i))
            out.append(ch[i])
            i = j
        else:
            lit.append(ch[i])
            i += 1
    flush()
    return bytes(out)


def write_hdr(path, rgb):
    """Radiance .hdr dengan scanline RLE gaya baru (dibaca RGBELoader three)."""
    h, w, _ = rgb.shape
    rgb = np.maximum(rgb.astype(np.float64), 0)
    m = rgb.max(2)
    e = np.where(m > 1e-32, np.ceil(np.log2(np.maximum(m, 1e-32))), 0)
    scale = np.where(m > 1e-32, 256.0 / np.power(2.0, e), 0)
    mant = np.clip(np.floor(rgb * scale[..., None]), 0, 255).astype(np.uint8)
    ex = np.where(m > 1e-32, e + 128, 0).clip(0, 255).astype(np.uint8)
    rgbe = np.concatenate([mant, ex[..., None]], 2)
    with open(path, 'wb') as f:
        f.write(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n')
        f.write(f'-Y {h} +X {w}\n'.encode())
        for y in range(h):
            f.write(bytes([2, 2, (w >> 8) & 255, w & 255]))
            for c in range(4):
                f.write(_rle(rgbe[y, :, c].tobytes()))


def env_hdr():
    W, H = 512, 256
    u = (np.arange(W) + 0.5) / W
    v = 1 - (np.arange(H) + 0.5) / H  # baris 0 = atas (v = 1)
    U, V = np.meshgrid(u, v)
    phi = (U - 0.5) * 2 * math.pi
    lat = (V - 0.5) * math.pi
    # arah di ruang file (sesuai equirectUv three: u = atan(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5)
    d = np.stack([np.cos(lat) * np.cos(phi), np.sin(lat), np.cos(lat) * np.sin(phi)], -1)

    def from_world(x, y, z):
        # envMapRotation.y = PI memutar arah lookup: (x, y, z) -> (-x, y, -z)
        a = np.array([-x, y, -z], float)
        return a / np.linalg.norm(a)

    up = np.clip(d[..., 1], -1, 1)
    sky = np.array([0.80, 0.85, 0.95])
    ground = np.array([0.30, 0.31, 0.34])
    t = np.clip(up, 0, 1) ** 0.55
    col = np.where(up[..., None] > 0, (0.72 + 0.3 * t[..., None]) * sky, ground * (1 + 0.6 * up[..., None]))
    # awan halus (variasi 10 persen) supaya pantulan tidak terlalu rata
    yy, xx = np.mgrid[0:H, 0:W]
    cloud = 0.5 * np.sin(xx * 0.05 + np.sin(yy * 0.09) * 2) + 0.5 * np.sin(yy * 0.07 + np.cos(xx * 0.031) * 3)
    col *= (1 + 0.08 * cloud)[..., None]
    # pita horizon sedikit lebih terang (kabut)
    col += (0.18 * np.exp(-(up / 0.08) ** 2))[..., None] * sky

    def lobe(dirw, power, width_deg):
        s = from_world(*dirw)
        ang = np.degrees(np.arccos(np.clip(d @ s, -1, 1)))
        return power * np.exp(-(ang / width_deg) ** 2)

    sun_w = (-0.35, 0.65, 0.68)
    sun = lobe(sun_w, 3200, 0.9) + lobe(sun_w, 22, 5) + lobe(sun_w, 2.0, 22)
    col += sun[..., None] * np.array([1.0, 0.97, 0.92])
    below = lobe((0.3, -0.42, 0.85), 5.0, 14) + lobe((0.3, -0.42, 0.85), 0.8, 35)
    col += below[..., None] * np.array([0.85, 0.9, 1.0])
    path = os.path.join(OUT, 'crystals_env.hdr')
    write_hdr(path, col.astype(np.float32))
    print('crystals_env.hdr', col.shape, 'maks %.0f' % col.max(), 'rata2 %.3f' % col.mean(),
          '%.1f KB' % (os.path.getsize(path) / 1024))


# ---------------------------------------------------------------- dot tile
def dot_pattern():
    n = 64
    y, x = np.mgrid[0:n, 0:n].astype(float)
    # jarak ke pojok (0, 0) dengan wrap, jadi titik utuh muncul di sambungan tile
    dx = np.minimum(x, n - x)
    dy = np.minimum(y, n - y)
    r = np.sqrt(dx * dx + dy * dy)
    a = np.clip(1.9 - r, 0, 1)
    Image.fromarray((a * 255).round().astype(np.uint8), 'L').save(os.path.join(OUT, 'dot_pattern.png'), optimize=True)
    print('dot_pattern.png', a.shape)


# ---------------------------------------------------------------- blurry text atlas
LINES = [
    'ICE CORE 0447',
    'SAMPLE / 03 OF 09',
    'DRIFT 0.0031 MM',
    'DEPTH 12.80 M',
    'THAW LOCK : ON',
    'GRID 45 X 45',
    'FIELD LOG 2026.10',
    'NODE 7 / STANDBY',
]


def load_font(size):
    for p in [os.path.join(ROOT, 'node_modules', '@ibm', 'plex-mono', 'fonts', 'complete', 'woff', 'IBMPlexMono-Medium.woff'),
              'C:/Windows/Fonts/consola.ttf']:
        try:
            return ImageFont.truetype(p, size), os.path.basename(p)
        except Exception:
            continue
    raise RuntimeError('font mono tidak ditemukan')


def blurry_text():
    S, rows = 512, len(LINES)
    rh = S // rows
    font, fname = load_font(38)
    img = Image.new('L', (S, S), 0)
    dr = ImageDraw.Draw(img)
    rects = []
    pad = 10
    for i, txt in enumerate(LINES):
        bbox = dr.textbbox((0, 0), txt, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        x0 = pad
        y0 = i * rh + (rh - th) // 2 - bbox[1]
        dr.text((x0, y0), txt, fill=255, font=font)
        w = min(S, tw + 2 * pad + 8)
        # UV three (flipY default): v = 1 di baris atas gambar
        rects.append({'text': txt, 'u0': 0.0, 'u1': w / S, 'v0': 1 - (i + 1) * rh / S, 'v1': 1 - i * rh / S,
                      'aspect': w / rh})
    img = img.filter(ImageFilter.GaussianBlur(4.5))
    a = np.asarray(img).astype(float)
    a = np.clip(a / max(a.max(), 1) * 1.15, 0, 1)
    Image.fromarray((a * 255).round().astype(np.uint8), 'L').save(os.path.join(OUT, 'blurrytext_atlas.png'), optimize=True)
    with open(os.path.join(OUT, 'blurrytext_atlas.json'), 'w', encoding='utf8') as f:
        json.dump({'size': S, 'font': fname, 'lines': rects}, f, indent=1)
    print('blurrytext_atlas.png', S, 'font', fname, '%.1f KB' % (os.path.getsize(os.path.join(OUT, 'blurrytext_atlas.png')) / 1024))


# ---------------------------------------------------------------- blurred wireframe polyhedra
def polyhedra():
    p = (1 + 5 ** 0.5) / 2
    tet = np.array([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]], float)
    cube = np.array([[x, y, z] for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)], float)
    octa = np.array([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], float)
    ico = np.array([[0, a, b * p] for a in (-1, 1) for b in (-1, 1)] + [[a, b * p, 0] for a in (-1, 1) for b in (-1, 1)]
                   + [[a * p, 0, b] for a in (-1, 1) for b in (-1, 1)], float)
    dode = np.array([[x, y, z] for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
                    + [[0, a / p, b * p] for a in (-1, 1) for b in (-1, 1)] + [[a / p, b * p, 0] for a in (-1, 1) for b in (-1, 1)]
                    + [[a * p, 0, b / p] for a in (-1, 1) for b in (-1, 1)], float)
    ang = np.arange(3) * 2 * math.pi / 3
    prism = np.array([[math.cos(a), math.sin(a), z] for z in (-1.2, 1.2) for a in ang], float)
    star = np.concatenate([tet, -tet])
    ang5 = np.arange(5) * 2 * math.pi / 5
    anti = np.array([[math.cos(a), math.sin(a), 0.6] for a in ang5] + [[math.cos(a + math.pi / 5), math.sin(a + math.pi / 5), -0.6] for a in ang5], float)

    def edges(vs, tol=0.02):
        """Sisi = pasangan vertex dengan jarak terpendek (cukup untuk polihedra beraturan)."""
        dm = np.linalg.norm(vs[:, None] - vs[None], axis=2)
        dmin = dm[dm > 1e-6].min()
        return [(i, j) for i in range(len(vs)) for j in range(i + 1, len(vs)) if abs(dm[i, j] - dmin) < dmin * tol + 1e-6]

    out = []
    for vs in [tet, cube, octa, ico, dode, prism, anti]:
        out.append((vs / np.linalg.norm(vs, axis=1).max(), edges(vs)))
    # dua tetrahedron saling tembus: sisi masing-masing, tanpa sambungan antar keduanya
    e1 = edges(tet)
    out.append((star / np.linalg.norm(star, axis=1).max(), e1 + [(a + 4, b + 4) for a, b in e1]))
    # prisma: tambahkan rusuk tegak (jaraknya beda dengan rusuk segitiga)
    vs, e = out[5]
    out[5] = (vs, e + [(i, i + 3) for i in range(3) if (i, i + 3) not in e])
    return out


def rot(ax, ay, az):
    cx, sx, cy, sy, cz, sz = math.cos(ax), math.sin(ax), math.cos(ay), math.sin(ay), math.cos(az), math.sin(az)
    rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return rz @ ry @ rx


def shapes_blurred():
    W, H, cell, ss = 512, 1024, 256, 4
    atlas = np.zeros((H, W))
    blurs = [1.0, 7.0, 3.0, 10.0, 5.0, 2.0, 12.0, 6.0]  # tajam sampai sangat buram
    for k, (vs, es) in enumerate(polyhedra()):
        big = Image.new('L', (cell * ss, cell * ss), 0)
        dr = ImageDraw.Draw(big)
        R = rot(*rng.uniform(0, 2 * math.pi, 3))
        p = vs @ R.T
        z = p[:, 2] + 3.2
        sc = cell * ss * 0.36 * 3.2
        xy = np.stack([p[:, 0] / z * sc + cell * ss / 2, p[:, 1] / z * sc + cell * ss / 2], 1)
        for i, j in es:
            dr.line([tuple(xy[i]), tuple(xy[j])], fill=255, width=3 * ss)
        for q in xy:
            r = 5 * ss
            dr.ellipse([q[0] - r, q[1] - r, q[0] + r, q[1] + r], fill=255)
        im = big.resize((cell, cell), Image.LANCZOS).filter(ImageFilter.GaussianBlur(blurs[k]))
        a = np.asarray(im).astype(float)
        a = a / max(a.max(), 1)
        cx, cy = (k % 2) * cell, (k // 2) * cell
        atlas[cy:cy + cell, cx:cx + cell] = a
    Image.fromarray((np.clip(atlas, 0, 1) * 255).round().astype(np.uint8), 'L').save(os.path.join(OUT, 'shapes_blurred.png'), optimize=True)
    print('shapes_blurred.png', atlas.shape, '%.1f KB' % (os.path.getsize(os.path.join(OUT, 'shapes_blurred.png')) / 1024))


if __name__ == '__main__':
    env_hdr()
    dot_pattern()
    blurry_text()
    shapes_blurred()
