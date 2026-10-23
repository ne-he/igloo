"""Path SVG -> SDF 2D, dipakai build_volumes.py untuk logo resmi (GitHub mark, WhatsApp).

Parser sendiri (tanpa dependensi baru): perintah M L H V C S Q T A Z (huruf besar = absolut, kecil = relatif),
kurva dipecah jadi poligon, tiap subpath diisi ke kanvas biner lalu digabung even-odd (XOR), sama dengan aturan
isi yang dipakai ikon simple-icons. SDF 2D = distance transform Euclid (scipy) di dalam dan di luar bentuk.
"""
import math
import re

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

_TOKEN = re.compile(r'[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?')
_ARGS = {'M': 2, 'L': 2, 'H': 1, 'V': 1, 'C': 6, 'S': 4, 'Q': 4, 'T': 2, 'A': 7, 'Z': 0}


def _tokens(d):
    """Token perintah dan angka. Flag busur (0/1 tanpa pemisah, misal '0 01-5.031') dipecah per karakter."""
    out = []
    i = 0
    cmd = None
    argi = 0
    while i < len(d):
        c = d[i]
        if c in ' ,\t\n':
            i += 1
            continue
        if c.isalpha():
            cmd = c.upper()
            out.append(c)
            argi = 0
            i += 1
            continue
        # argumen ke-4 dan ke-5 busur = flag satu digit
        if cmd == 'A' and argi % 7 in (3, 4) and c in '01':
            out.append(float(c))
            argi += 1
            i += 1
            continue
        m = _TOKEN.match(d, i)
        if not m or m.group(0).isalpha():
            raise ValueError(f'path rusak di {i}: {d[i:i + 20]!r}')
        out.append(float(m.group(0)))
        argi += 1
        i = m.end()
    return out


def _cubic(p0, p1, p2, p3, n=16):
    t = np.linspace(0, 1, n + 1)[1:, None]
    return ((1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3).tolist()


def _quad(p0, p1, p2, n=12):
    t = np.linspace(0, 1, n + 1)[1:, None]
    return ((1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t ** 2 * p2).tolist()


def _arc(p0, rx, ry, phi_deg, large, sweep, p1, n_per_rad=10):
    """Busur endpoint -> titik (spesifikasi SVG, konversi ke parameter pusat)."""
    x1, y1 = p0
    x2, y2 = p1
    if rx == 0 or ry == 0:
        return [[x2, y2]]
    rx, ry = abs(rx), abs(ry)
    phi = math.radians(phi_deg)
    cp, sp = math.cos(phi), math.sin(phi)
    dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
    x1p = cp * dx + sp * dy
    y1p = -sp * dx + cp * dy
    lam = (x1p / rx) ** 2 + (y1p / ry) ** 2
    if lam > 1:
        rx *= math.sqrt(lam)
        ry *= math.sqrt(lam)
    num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
    den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
    k = math.sqrt(max(0.0, num / den)) if den > 0 else 0.0
    if large == sweep:
        k = -k
    cxp = k * rx * y1p / ry
    cyp = -k * ry * x1p / rx
    cx = cp * cxp - sp * cyp + (x1 + x2) / 2
    cy = sp * cxp + cp * cyp + (y1 + y2) / 2

    def ang(ux, uy, vx, vy):
        a = math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
        return a

    t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
    if not sweep and dt > 0:
        dt -= 2 * math.pi
    elif sweep and dt < 0:
        dt += 2 * math.pi
    n = max(4, int(abs(dt) * n_per_rad))
    pts = []
    for i in range(1, n + 1):
        t = t1 + dt * i / n
        ex, ey = rx * math.cos(t), ry * math.sin(t)
        pts.append([cp * ex - sp * ey + cx, sp * ex + cp * ey + cy])
    return pts


def parse(d):
    """Path SVG -> daftar subpath, tiap subpath = array (n, 2) koordinat viewBox."""
    tok = _tokens(d)
    subs = []
    cur = None
    pos = np.zeros(2)
    start = np.zeros(2)
    last_ctrl = None  # untuk S/T
    last_cmd = ''
    i = 0
    cmd = None
    while i < len(tok):
        if isinstance(tok[i], str):
            cmd = tok[i]
            i += 1
            if cmd in 'Zz':
                if cur:
                    subs.append(np.array(cur))
                cur = None
                pos = start.copy()
                last_ctrl = None
                last_cmd = 'Z'
                continue
        up = cmd.upper()
        rel = cmd.islower()
        n = _ARGS[up]
        a = tok[i:i + n]
        i += n
        base = pos if rel else np.zeros(2)
        if up == 'M':
            if cur:
                subs.append(np.array(cur))
            pos = base + a
            start = pos.copy()
            cur = [pos.tolist()]
            cmd = 'l' if rel else 'L'  # pasangan berikutnya = lineto implisit
            last_ctrl = None
        elif up == 'L':
            pos = base + a
            cur.append(pos.tolist())
            last_ctrl = None
        elif up == 'H':
            pos = np.array([(pos[0] if rel else 0) + a[0], pos[1]])
            cur.append(pos.tolist())
            last_ctrl = None
        elif up == 'V':
            pos = np.array([pos[0], (pos[1] if rel else 0) + a[0]])
            cur.append(pos.tolist())
            last_ctrl = None
        elif up == 'C':
            p1, p2, p3 = base + a[0:2], base + a[2:4], base + a[4:6]
            cur += _cubic(pos, p1, p2, p3)
            last_ctrl, pos = p2, p3
        elif up == 'S':
            p1 = 2 * pos - last_ctrl if last_ctrl is not None and last_cmd in 'CS' else pos.copy()
            p2, p3 = base + a[0:2], base + a[2:4]
            cur += _cubic(pos, p1, p2, p3)
            last_ctrl, pos = p2, p3
        elif up == 'Q':
            p1, p2 = base + a[0:2], base + a[2:4]
            cur += _quad(pos, p1, p2)
            last_ctrl, pos = p1, p2
        elif up == 'T':
            p1 = 2 * pos - last_ctrl if last_ctrl is not None and last_cmd in 'QT' else pos.copy()
            p2 = base + a[0:2]
            cur += _quad(pos, p1, p2)
            last_ctrl, pos = p1, p2
        elif up == 'A':
            p1 = base + a[5:7]
            cur += _arc(pos.tolist(), a[0], a[1], a[2], int(a[3]), int(a[4]), p1.tolist())
            pos = p1
            last_ctrl = None
        last_cmd = up
    if cur:
        subs.append(np.array(cur))
    return subs


def rasterize(subs, view, size, res):
    """Isi even-odd ke grid res x res. view = (x0, y0, w, h) viewBox, size = lebar bentuk di ruang hasil
    (bentuk dipusatkan, sisi terpanjang = size, domain grid = -0.5..0.5). Return mask bool [y][x], y ke atas."""
    x0, y0, w, h = view
    s = size / max(w, h) * res  # piksel per unit viewBox
    ox = res / 2 - (x0 + w / 2) * s
    oy = res / 2 - (y0 + h / 2) * s
    mask = np.zeros((res, res), bool)
    for sub in subs:
        img = Image.new('L', (res, res), 0)
        pts = [(x * s + ox, y * s + oy) for x, y in sub]
        ImageDraw.Draw(img).polygon(pts, fill=255)
        mask ^= np.asarray(img) > 127
    return np.flipud(mask)  # baris 0 = bawah (y ke atas seperti ruang volume)


def sdf2d(mask):
    """SDF 2D bertanda dari mask (piksel), negatif di dalam. Setengah piksel dikoreksi supaya tepi di antara piksel."""
    out = ndimage.distance_transform_edt(~mask)
    inn = ndimage.distance_transform_edt(mask)
    return np.where(mask, -(inn - 0.5), out - 0.5)


class Field2D:
    """SDF 2D di domain -0.5..0.5 (satuan uvw), dibaca bilinear di titik sembarang."""

    def __init__(self, d_px, res):
        self.d = d_px / res  # piksel -> uvw
        self.res = res

    def __call__(self, x, y):
        # koordinat piksel: pusat piksel i di (i + 0.5) / res - 0.5
        px = (x + 0.5) * self.res - 0.5
        py = (y + 0.5) * self.res - 0.5
        coords = np.stack([py.ravel(), px.ravel()])
        v = ndimage.map_coordinates(self.d, coords, order=1, mode='nearest')
        # di luar grid: jarak ke tepi grid ditambahkan (bentuk selalu di dalam domain)
        ex = np.maximum(np.abs(x) - 0.5, 0) + np.maximum(np.abs(y) - 0.5, 0)
        return v.reshape(x.shape) + ex


def field_from_path(d, view, size, res=1024, subpaths=None):
    """SDF 2D dari path. subpaths = indeks subpath yang dipakai (None = semua), supaya bagian logo bisa
    ditebalkan berbeda (misal cincin gelembung WhatsApp vs gagang telepon) dengan tata letak yang sama."""
    subs = parse(d)
    if subpaths is not None:
        subs = [subs[i] for i in subpaths]
    return Field2D(sdf2d(rasterize(subs, view, size, res)), res)
