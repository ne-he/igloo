"""Bangkitkan tekstur aliran untuk sim mouse frost kristal (M5b). Buatan sendiri, tileable.

Pakai:  python tools/textures/crystals_advect.py
Output: public/assets/textures/crystals_advect.png  256x256 RGB
  R, G = medan aliran curl dari fbm (bebas divergensi), 0.5 = diam. Sim menggeser UV sebesar
         (rg * 2 - 1) texel per langkah, jadi tepi frost yang tumbuh berbelok mengikuti aliran ini.
  B    = fbm mentah (cadangan, tidak dipakai shader saat ini).
"""
import os

import numpy as np
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'textures')
rng = np.random.default_rng(5150)


def value_noise(size, cells):
    g = rng.random((cells, cells))
    t = np.linspace(0, cells, size, endpoint=False)
    i0 = np.floor(t).astype(int)
    f = t - i0
    f = f * f * (3 - 2 * f)
    i1 = (i0 + 1) % cells
    rows = g[i0][:, i0] * (1 - f) + g[i0][:, i1] * f
    rows1 = g[i1][:, i0] * (1 - f) + g[i1][:, i1] * f
    return rows * (1 - f)[:, None] + rows1 * f[:, None]


def fbm(size, base, octaves):
    out = np.zeros((size, size))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        out += value_noise(size, base * 2 ** o) * amp
        tot += amp
        amp *= 0.5
    return out / tot


def main(size=256):
    n = fbm(size, 4, 4)
    # curl 2D dari potensial skalar: (dn/dy, -dn/dx), selisih pusat dengan wrap (tetap tileable)
    dy = (np.roll(n, -1, 0) - np.roll(n, 1, 0)) * 0.5
    dx = (np.roll(n, -1, 1) - np.roll(n, 1, 1)) * 0.5
    vx, vy = dy, -dx
    m = np.percentile(np.hypot(vx, vy), 99)
    vx = np.clip(vx / m, -1, 1)
    vy = np.clip(vy / m, -1, 1)
    nn = (n - n.min()) / (n.max() - n.min())
    rgb = np.stack([vx * 0.5 + 0.5, vy * 0.5 + 0.5, nn], -1)
    path = os.path.join(OUT, 'crystals_advect.png')
    Image.fromarray((rgb * 255).round().astype(np.uint8), 'RGB').save(path, optimize=True)
    print('crystals_advect.png', rgb.shape, 'rata2 aliran %.3f' % np.hypot(vx, vy).mean(), '%.1f KB' % (os.path.getsize(path) / 1024))


if __name__ == '__main__':
    main()
