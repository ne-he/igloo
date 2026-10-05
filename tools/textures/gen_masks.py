"""Bangkitkan tekstur data untuk compositor transisi (M1). Buatan sendiri, bukan aset igloo.

Pakai:  python tools/textures/gen_masks.py
Output (lossless PNG, JANGAN dikompres ETC1S, ini data):
  public/assets/textures/transition_mask.png  1024x1024 RGB, tileable
      R = grunge retak es bergaris (tepi "ice cut")
      G = persegi acak berbagai tingkat abu (blok glitch / tech displacement)
      B = noise halus buram frekuensi rendah (gerigi garis depan)
  public/assets/textures/blue_noise_128.png   128x128 RGB, 3 kanal blue noise independen (void-and-cluster)
"""
import os

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'textures')
rng = np.random.default_rng(20261005)


def tile_noise(size, cells, rng):
    """Value noise tileable: grid acak diinterpolasi kubik dengan wrap."""
    g = rng.random((cells, cells))
    x = np.linspace(0, cells, size, endpoint=False)
    i0 = np.floor(x).astype(int)
    f = x - i0
    f = f * f * (3 - 2 * f)
    i1 = (i0 + 1) % cells
    a = g[i0][:, i0]
    b = g[i0][:, i1]
    c = g[i1][:, i0]
    d = g[i1][:, i1]
    fx = f[None, :]
    fy = f[:, None]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def fbm(size, base, octaves, rng, aniso=(1, 1)):
    out = np.zeros((size, size))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        cy = max(1, int(base * aniso[0] * 2 ** o))
        cx = max(1, int(base * aniso[1] * 2 ** o))
        g = rng.random((cy, cx))
        y = np.linspace(0, cy, size, endpoint=False)
        x = np.linspace(0, cx, size, endpoint=False)
        y0 = np.floor(y).astype(int); x0 = np.floor(x).astype(int)
        fy = y - y0; fx = x - x0
        fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
        y1 = (y0 + 1) % cy; x1 = (x0 + 1) % cx
        n = (g[y0][:, x0] * (1 - fx) + g[y0][:, x1] * fx) * (1 - fy)[:, None] + \
            (g[y1][:, x0] * (1 - fx) + g[y1][:, x1] * fx) * fy[:, None]
        out += n * amp
        total += amp
        amp *= 0.5
    return out / total


def voronoi_edges(size, points, rng):
    """Jarak ke tepi sel Voronoi (F2 - F1), tileable lewat wrap koordinat."""
    pts = rng.random((points, 2)) * size
    yy, xx = np.mgrid[0:size, 0:size].astype(float)
    f1 = np.full((size, size), 1e9)
    f2 = np.full((size, size), 1e9)
    for px, py in pts:
        dx = np.abs(xx - px); dx = np.minimum(dx, size - dx)
        dy = np.abs(yy - py); dy = np.minimum(dy, size - dy)
        d = np.sqrt(dx * dx + dy * dy)
        f2 = np.where(d < f1, f1, np.minimum(f2, d))
        f1 = np.minimum(f1, d)
    return f2 - f1


def norm(a):
    a = a - a.min()
    return a / max(a.max(), 1e-9)


def channel_ice(size):
    # retak kristal (tepi Voronoi tajam) + goresan memanjang horizontal
    edges = voronoi_edges(size, 90, rng)
    cracks = 1 - np.clip(edges / 18.0, 0, 1)
    streaks = fbm(size, 2, 6, rng, aniso=(6, 1))
    grain = fbm(size, 16, 3, rng)
    r = norm(0.55 * streaks + 0.3 * grain + 0.35 * cracks * streaks)
    return r


def channel_blocks(size):
    # persegi panjang acak, sebagian besar melebar horizontal, tiap persegi nilai abu sendiri
    g = np.zeros((size, size))
    for _ in range(420):
        w = int(rng.integers(8, size // 3))
        h = int(rng.integers(2, max(3, w // 4)))
        x = int(rng.integers(0, size)); y = int(rng.integers(0, size))
        v = rng.random()
        ys = (np.arange(y, y + h) % size)
        xs = (np.arange(x, x + w) % size)
        g[np.ix_(ys, xs)] = v
    return g


def channel_soft(size):
    return norm(fbm(size, 3, 4, rng))


def void_and_cluster(size, rng, sigma=1.9):
    """Blue noise ala void-and-cluster (Ulichney). Energi = konvolusi Gaussian toroidal."""
    n = size * size
    k = np.arange(size); k = np.minimum(k, size - k)
    kern = np.exp(-(k[:, None] ** 2 + k[None, :] ** 2) / (2 * sigma * sigma))
    kf = np.fft.rfft2(kern)

    def energy(mask):
        return np.fft.irfft2(np.fft.rfft2(mask) * kf, s=(size, size))

    def add_energy(e, idx, sign):
        y, x = divmod(idx, size)
        e += sign * np.roll(np.roll(kern, y, 0), x, 1)

    # pola awal: 10% titik acak, lalu relaksasi (pindah cluster terpadat ke void terbesar)
    mask = np.zeros((size, size))
    init = rng.choice(n, n // 10, replace=False)
    mask.flat[init] = 1
    e = energy(mask)
    while True:
        cluster = np.argmax(np.where(mask > 0, e, -np.inf))
        mask.flat[cluster] = 0; add_energy(e, cluster, -1)
        void = np.argmin(np.where(mask == 0, e, np.inf))
        if void == cluster:
            mask.flat[cluster] = 1; add_energy(e, cluster, 1)
            break
        mask.flat[void] = 1; add_energy(e, void, 1)
    rank = np.zeros(n)
    ones = int(mask.sum())
    # fase 1: buang titik dari cluster terpadat
    m1 = mask.copy(); e1 = e.copy()
    for r in range(ones - 1, -1, -1):
        c = np.argmax(np.where(m1 > 0, e1, -np.inf))
        m1.flat[c] = 0; add_energy(e1, c, -1); rank[c] = r
    # fase 2 dan 3: isi void terbesar
    m2 = mask.copy(); e2 = e.copy()
    for r in range(ones, n):
        v = np.argmin(np.where(m2 == 0, e2, np.inf))
        m2.flat[v] = 1; add_energy(e2, v, 1); rank[v] = r
    return (rank.reshape(size, size) + 0.5) / n


def main():
    os.makedirs(OUT, exist_ok=True)
    size = 1024
    r, g, b = channel_ice(size), channel_blocks(size), channel_soft(size)
    img = np.stack([r, g, b], -1)
    Image.fromarray((img * 255).round().astype(np.uint8), 'RGB').save(os.path.join(OUT, 'transition_mask.png'), optimize=True)
    print('transition_mask.png', img.shape, 'mean', img.reshape(-1, 3).mean(0).round(3))

    bn = np.stack([void_and_cluster(128, np.random.default_rng(s)) for s in (1, 2, 3)], -1)
    Image.fromarray((bn * 255).round().astype(np.uint8), 'RGB').save(os.path.join(OUT, 'blue_noise_128.png'), optimize=True)
    print('blue_noise_128.png', bn.shape, 'mean', bn.reshape(-1, 3).mean(0).round(3))


if __name__ == '__main__':
    main()
