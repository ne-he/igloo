"""Bangkitkan tekstur awan untuk forcefield cincin scene entry (M7a). Buatan sendiri, tileable.

Pakai:  python tools/textures/entry_gen_clouds.py
Output: public/assets/textures/clouds_noise.png  256, grayscale lossless (data, bukan warna).
Isi: fBm value noise 6 oktaf dengan domain warp ringan, dinormalisasi lalu di-equalize sedikit supaya
pita sin(noise * 13) di shader tersebar rata (tidak menumpuk di nilai tengah).
"""
import os

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'textures')
SIZE = 256
rng = np.random.default_rng(20261013)


def value_noise(size, cells):
    """Value noise tileable: grid acak cells x cells, interpolasi smoothstep, wrap di tepi."""
    g = rng.random((cells, cells))
    t = np.linspace(0, cells, size, endpoint=False)
    i0 = np.floor(t).astype(int)
    f = t - i0
    f = f * f * (3 - 2 * f)
    i1 = (i0 + 1) % cells
    row0 = g[i0][:, i0] * (1 - f) + g[i0][:, i1] * f
    row1 = g[i1][:, i0] * (1 - f) + g[i1][:, i1] * f
    return row0 * (1 - f)[:, None] + row1 * f[:, None]


def fbm(size, base, octaves, gain=0.55):
    out = np.zeros((size, size))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += value_noise(size, base * 2 ** o) * amp
        tot += amp
        amp *= gain
    return out / tot


def warp(img, dx, dy):
    h, w = img.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    x = (xx + dx) % w
    y = (yy + dy) % h
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx, fy = x - x0, y - y0
    x1, y1 = (x0 + 1) % w, (y0 + 1) % h
    return (img[y0, x0] * (1 - fx) + img[y0, x1] * fx) * (1 - fy) + (img[y1, x0] * (1 - fx) + img[y1, x1] * fx) * fy


def main():
    base = fbm(SIZE, 4, 6)
    wx = (fbm(SIZE, 2, 3) - 0.5) * 40
    wy = (fbm(SIZE, 2, 3) - 0.5) * 40
    c = warp(base, wx, wy)
    c = (c - c.min()) / (c.max() - c.min())
    # equalize parsial: campur dengan rank supaya histogram lebih rata
    rank = np.argsort(np.argsort(c.ravel())).reshape(c.shape) / (c.size - 1)
    c = 0.6 * c + 0.4 * rank
    path = os.path.join(OUT, 'clouds_noise.png')
    Image.fromarray((np.clip(c, 0, 1) * 255).round().astype(np.uint8), 'L').save(path, optimize=True)
    print(f'clouds_noise.png {SIZE}px mean {c.mean():.3f} {os.path.getsize(path) / 1024:.1f} KB')


if __name__ == '__main__':
    main()
