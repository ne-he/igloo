"""Bangkitkan tekstur noise untuk scene igloo (M2). Buatan sendiri, semua tileable.

Pakai:  python tools/textures/gen_noises.py
Output di public/assets/textures/ (PNG grayscale lossless, ini data):
  wind_noise.png        256  goresan salju tertiup (fbm memanjang + domain warp)
  perlin.png             64  noise halus
  mosaic.png             32  noise kotak-kotak (dibaca nearest) untuk dissolve blok
  triangles_tiling.png  512  garis segitiga Delaunay putih di hitam (efek "materialize" intro)
"""
import os

import numpy as np
from PIL import Image, ImageDraw
from scipy.spatial import Delaunay

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'textures')
rng = np.random.default_rng(1006)


def value_noise(size, cy, cx, rng):
    g = rng.random((cy, cx))
    y = np.linspace(0, cy, size, endpoint=False)
    x = np.linspace(0, cx, size, endpoint=False)
    y0 = np.floor(y).astype(int); x0 = np.floor(x).astype(int)
    fy = y - y0; fx = x - x0
    fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
    y1 = (y0 + 1) % cy; x1 = (x0 + 1) % cx
    return (g[y0][:, x0] * (1 - fx) + g[y0][:, x1] * fx) * (1 - fy)[:, None] + \
           (g[y1][:, x0] * (1 - fx) + g[y1][:, x1] * fx) * fy[:, None]


def fbm(size, base, octaves, rng, aniso=(1, 1), gain=0.5):
    out = np.zeros((size, size)); amp = 1.0; tot = 0.0
    for o in range(octaves):
        out += value_noise(size, max(1, int(base * aniso[0] * 2 ** o)), max(1, int(base * aniso[1] * 2 ** o)), rng) * amp
        tot += amp; amp *= gain
    return out / tot


def warp_sample(img, dx, dy):
    """Sampling bilinear dengan wrap (domain warp tetap tileable)."""
    h, w = img.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    x = (xx + dx) % w; y = (yy + dy) % h
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int)
    fx = x - x0; fy = y - y0
    x1 = (x0 + 1) % w; y1 = (y0 + 1) % h
    return (img[y0, x0] * (1 - fx) + img[y0, x1] * fx) * (1 - fy) + (img[y1, x0] * (1 - fx) + img[y1, x1] * fx) * fy


def norm(a):
    a = a - a.min()
    return a / max(a.max(), 1e-9)


def save(a, name):
    Image.fromarray((np.clip(a, 0, 1) * 255).round().astype(np.uint8), 'L').save(os.path.join(OUT, name), optimize=True)
    print(name, a.shape, 'mean %.3f' % a.mean())


def wind(size=256):
    streak = fbm(size, 2, 6, rng, aniso=(5, 1))  # frekuensi tinggi di sumbu y = goresan memanjang horizontal
    wx = (fbm(size, 3, 3, rng) - 0.5) * 40
    wy = (fbm(size, 3, 3, rng) - 0.5) * 18
    w = warp_sample(streak, wx, wy)
    w = norm(w) ** 1.6  # sebagian besar gelap, goresan terang
    return norm(w)


def triangles(size=512, points=110, line=2):
    # titik acak di torus (salin 3x3) supaya Delaunay tileable
    pts = rng.random((points, 2)) * size
    tiles = np.concatenate([pts + np.array([dx, dy]) * size for dx in (-1, 0, 1) for dy in (-1, 0, 1)])
    tri = Delaunay(tiles)
    img = Image.new('L', (size * 3, size * 3), 0)
    d = ImageDraw.Draw(img)
    off = np.array([size, size])
    for s in tri.simplices:
        p = [tuple(tiles[i] + off) for i in s]
        d.line([p[0], p[1], p[2], p[0]], fill=255, width=line)
    img = img.crop((size, size, size * 2, size * 2))
    return np.asarray(img).astype(float) / 255


def main():
    os.makedirs(OUT, exist_ok=True)
    save(wind(), 'wind_noise.png')
    save(norm(fbm(64, 2, 4, rng)), 'perlin.png')
    m = value_noise(32, 32, 32, rng)
    save(m, 'mosaic.png')
    save(triangles(), 'triangles_tiling.png')


if __name__ == '__main__':
    main()
