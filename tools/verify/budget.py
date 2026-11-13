"""Cek budget ukuran aset (blueprint 8.4). Gagal (exit 1) kalau melewati batas keras.

Pakai:  python tools/verify/budget.py [--limit-mb 12] [--include-audio]

Menghitung public/assets per jenis (folder + ekstensi). Batas keras blueprint 8.4 = 12 MB untuk
MUATAN AWAL TANPA AUDIO (audio baru diunduh setelah loader hilang). Audio dicek terpisah terhadap
budget audio (1.5 MB). --include-audio memasukkan audio ke batas 12 MB juga (mode ketat).
public/draco (decoder wasm) ikut dihitung di muatan awal karena wajib sebelum geometri bisa dibaca.
PNG lama yang sudah diganti WebP lossless (ada <nama>.webp di sebelahnya dan <nama>.png tidak disebut lagi di src/)
masih disimpan di disk tapi tidak pernah diunduh, jadi dilaporkan terpisah dan tidak masuk hitungan.
"""
import argparse
import os
import sys
from collections import defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ASSETS = os.path.join(ROOT, 'public', 'assets')
DRACO = os.path.join(ROOT, 'public', 'draco')
MB = 1024 * 1024
AUDIO_LIMIT_MB = 1.5


def walk(base):
    for d, _, files in os.walk(base):
        for f in files:
            p = os.path.join(d, f)
            yield p, os.path.getsize(p)


def superseded(path, src_text):
    """PNG yang sudah diganti WebP lossless dan tidak dirujuk kode lagi (tidak pernah diunduh)."""
    stem, ext = os.path.splitext(path)
    name = os.path.basename(path)
    return ext.lower() == '.png' and os.path.exists(stem + '.webp') and name not in src_text


def read_src():
    parts = []
    for base in (os.path.join(ROOT, 'src'), ):
        for p, _ in walk(base):
            if p.endswith(('.js', '.json', '.glsl', '.frag', '.vert')):
                with open(p, encoding='utf-8', errors='ignore') as f:
                    parts.append(f.read())
    for f in ('index.html', 'quick.html'):
        p = os.path.join(ROOT, f)
        if os.path.exists(p):
            with open(p, encoding='utf-8', errors='ignore') as fh:
                parts.append(fh.read())
    return '\n'.join(parts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit-mb', type=float, default=12.0)
    ap.add_argument('--include-audio', action='store_true')
    args = ap.parse_args()

    by_type = defaultdict(lambda: [0, 0])  # (folder, ext) -> [jumlah file, byte]
    audio = initial = 0
    src_text = read_src()
    skipped = []
    for p, size in walk(ASSETS):
        rel = os.path.relpath(p, ASSETS)
        if superseded(p, src_text):
            skipped.append((rel, size))
            continue
        folder = rel.split(os.sep)[0] if os.sep in rel else '.'
        ext = os.path.splitext(p)[1].lower() or '(tanpa)'
        by_type[(folder, ext)][0] += 1
        by_type[(folder, ext)][1] += size
        if folder == 'audio':
            audio += size
        else:
            initial += size
    for p, size in walk(DRACO):
        ext = os.path.splitext(p)[1].lower()
        by_type[('../draco', ext)][0] += 1
        by_type[('../draco', ext)][1] += size
        initial += size

    print(f'{"folder":12s} {"ext":8s} {"file":>5s} {"MB":>8s}')
    for (folder, ext), (n, size) in sorted(by_type.items(), key=lambda kv: -kv[1][1]):
        print(f'{folder:12s} {ext:8s} {n:5d} {size / MB:8.3f}')
    total = initial + audio
    print('-' * 36)
    for rel, size in skipped:
        print(f'tidak dimuat (diganti .webp): {rel} {size / MB:.3f} MB')
    print(f'muatan awal (tanpa audio, + draco): {initial / MB:7.3f} MB')
    print(f'audio (setelah loader):             {audio / MB:7.3f} MB  (budget {AUDIO_LIMIT_MB} MB)')
    print(f'total public/assets + draco:        {total / MB:7.3f} MB')

    checked = total if args.include_audio else initial
    label = 'total termasuk audio' if args.include_audio else 'muatan awal'
    fails = []
    if checked > args.limit_mb * MB:
        fails.append(f'{label} {checked / MB:.3f} MB > batas {args.limit_mb} MB')
    if audio > AUDIO_LIMIT_MB * MB:
        fails.append(f'audio {audio / MB:.3f} MB > budget {AUDIO_LIMIT_MB} MB')
    if fails:
        print('GAGAL: ' + '; '.join(fails))
        sys.exit(1)
    print(f'LOLOS: {label} {checked / MB:.3f} MB <= {args.limit_mb} MB, audio <= {AUDIO_LIMIT_MB} MB')


if __name__ == '__main__':
    main()
