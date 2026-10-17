"""Sintesis semua audio projek (M8). 100% buatan sendiri dari numpy, tidak ada sampel atau file igloo.

Pakai:  python tools/audio/synth.py [--no-spectro]
Butuh:  numpy, scipy, matplotlib (spektrogram), ffmpeg dengan libopus. ffmpeg dicari di PATH dulu,
        lalu di paket pip imageio-ffmpeg (di mesin ini tidak ada ffmpeg di PATH).

Output public/assets/audio/*.ogg (Ogg Opus 48 kHz):
  loop, panjang PERSIS sama (LOOP_SEC) supaya selalu sinkron saat diputar bersamaan:
    music.ogg   pad ambient stereo (4 akord bergiliran, partial detune kiri/kanan)
    wind.ogg    noise terfilter mono, 3 pita dengan hembusan pelan
    room.ogg    dengung ruang mono (drone rendah + noise AC halus)
  loop pendek (diputar loop, volumenya digerakkan progress):
    circles.ogg swell cincin portal, 8 s, partial inharmonik bergetar
    particles.ogg kilau granular ruang partikel, 6 s (volumenya dari bus 'audio_param' scene entry)
  one-shot:
    beeps.ogg beeps2.ogg beeps3.ogg click-project.ogg enter-project.ogg leave-project.ogg
    project-text.ogg logo.ogg ui-long.ogg ui-short.ogg

File loop diberi bantalan LOOP_PAD detik di kedua ujung (lihat konstanta), jadi panjang file = L + 2 x pad.

Trik loop mulus: semua sinus punya jumlah siklus bulat dalam panjang loop (frekuensi dibulatkan ke
kelipatan 1/L Hz), envelope dibangun dari deret periodik, noise difilter lewat FFT (sirkular), dan reverb
loop pakai konvolusi sirkular. Jadi sampel terakhir menyambung ke sampel pertama tanpa klik.

Spektrogram tiap file (hasil decode ulang .ogg, jadi yang diperiksa adalah file final) masuk ke
tools/verify/out/audio_spectro/ (di-ignore git).
"""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import wave

import numpy as np
from scipy import signal

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'audio')
SPECTRO = os.path.join(ROOT, 'tools', 'verify', 'out', 'audio_spectro')
SR = 48000
LOOP_SEC = 60  # tiga loop utama sama panjang persis (igloo: 115.06 s, kita lebih pendek demi budget)
CIRCLES_SEC = 8
# Bantalan sirkular di kedua ujung file loop. Encoder/decoder Opus membuat artefak kecil di awal dan akhir
# stream (terukur: lompatan sambungan 21x rata-rata di room.ogg tanpa bantalan). Jadi file loop berisi
# [ekor LOOP_PAD | loop L | kepala LOOP_PAD] dan Audio.js memutar loopStart = LOOP_PAD, loopEnd = LOOP_PAD + L.
# Nilai ini HARUS sama dengan LOOP_PAD di src/audio/Audio.js.
LOOP_PAD = 0.05
# Panjang crossfade penyembuh sambungan (sampel), sama dengan HEAL_SAMPLES di Audio.js. Tanpa ini sisa
# galat codec di dua ujung loop yang dikode terpisah masih memberi lompatan kecil (room: lebih besar dari
# semua langkah sampel di dalam file).
HEAL = 480
LOOPS = ('music', 'wind', 'room', 'circles', 'particles')
PARTICLES_SEC = 6

# bitrate Opus (kbps). Musik stereo paling mahal, sisanya mono.
BITRATE = {'music': 56, 'wind': 24, 'room': 20, 'circles': 32, 'particles': 32, 'oneshot': 40}


def find_ffmpeg():
    exe = shutil.which('ffmpeg')
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        sys.exit('ffmpeg tidak ketemu: pasang ffmpeg di PATH atau pip install imageio-ffmpeg')


# ---------- util ----------

def snap(freq, length):
    """Bulatkan frekuensi supaya jumlah siklus dalam `length` detik bulat (loop mulus)."""
    return max(1, round(freq * length)) / length


def periodic_smooth(n, length, rng, max_cycles=6, amp_decay=1.0):
    """Sinyal acak halus periodik (jumlah sinus dengan siklus bulat), rentang kira-kira -1..1."""
    t = np.arange(n) / SR
    out = np.zeros(n)
    for k in range(1, max_cycles + 1):
        out += rng.normal() / k ** amp_decay * np.sin(2 * np.pi * k * t / length + rng.uniform(0, 2 * np.pi))
    return out / (np.abs(out).max() + 1e-9)


def fft_band(noise, lo, hi, order=2):
    """Filter band sirkular di domain frekuensi (hasilnya tetap periodik)."""
    n = len(noise)
    f = np.fft.rfftfreq(n, 1 / SR)
    spec = np.fft.rfft(noise)
    # respons butterworth magnitudo (tanpa fase), cukup buat noise
    h = np.ones_like(f)
    if lo:
        h *= 1 / np.sqrt(1 + (lo / np.maximum(f, 1e-3)) ** (2 * order))
    if hi:
        h *= 1 / np.sqrt(1 + (f / hi) ** (2 * order))
    return np.fft.irfft(spec * h, n)


def reverb_ir(sec, decay, rng, lowpass=6000, stereo=False):
    n = int(sec * SR)
    t = np.arange(n) / SR
    ch = []
    for _ in range(2 if stereo else 1):
        ir = rng.normal(size=n) * np.exp(-t / decay)
        b, a = signal.butter(2, lowpass / (SR / 2))
        ir = signal.lfilter(b, a, ir)
        ir[0] = 0
        # ekor IR dipudar 30% terakhir, kalau tidak reverb berhenti mendadak (garis tegak di spektrogram)
        k = int(n * 0.3)
        ir[-k:] *= np.linspace(1, 0, k) ** 2
        ch.append(ir / np.sqrt(np.sum(ir ** 2)))
    return np.stack(ch) if stereo else ch[0]


def circular_convolve(x, ir):
    """Konvolusi sirkular: ekor reverb melipat ke awal, loop tetap mulus."""
    n = len(x)
    if len(ir) > n:
        ir = ir[:n]
    return np.fft.irfft(np.fft.rfft(x) * np.fft.rfft(ir, n), n)


def normalize(x, peak_db=-3.0):
    p = np.abs(x).max()
    return x * (10 ** (peak_db / 20) / p) if p > 0 else x


def adsr(n, a, d, s, r, sustain_level=0.6):
    """Envelope a/d/r dalam detik, s = sisa (dihitung otomatis dari n).
    Dibangun dari dua ujung (attack dari depan, release dari belakang), jadi kalau n lebih pendek dari
    a + d + r envelope tetap turun ke 0 di sampel terakhir (versi lama terpotong = klik di tiap blip)."""
    t = np.arange(n) / SR
    T = n / SR
    attack = np.clip(t / max(a, 1e-6), 0, 1) ** 2
    decay = 1 - (1 - sustain_level) * np.clip((t - a) / max(d, 1e-6), 0, 1)
    release = np.clip((T - t) / max(r, 1e-6), 0, 1) ** 1.5
    return attack * decay * release


# ---------- loop ----------

def make_music(rng):
    """Pad stereo: 4 akord (D minor modal, lembut), tiap akord 15 s dengan jendela cosinus periodik."""
    L = LOOP_SEC
    n = L * SR
    t = np.arange(n) / SR
    midi = lambda m: 440 * 2 ** ((m - 69) / 12)
    chords = [
        [38, 50, 57, 60, 64, 69],  # Dm9 (D2 D3 A3 C4 E4 A4)
        [34, 46, 53, 57, 62, 65],  # Bbmaj7
        [41, 48, 55, 60, 64, 67],  # Fmaj9
        [36, 48, 55, 62, 64, 69],  # C6/9
    ]
    out = np.zeros((2, n))
    k = len(chords)
    for ci, notes in enumerate(chords):
        # jendela periodik: puncak di tengah slot akord, overlap lebar supaya transisi lambat
        phase = 2 * np.pi * (t / L - (ci + 0.5) / k)
        w = (0.5 + 0.5 * np.cos(phase)) ** 3
        for m in notes:
            f0 = midi(m)
            for side in (0, 1):
                det = (1 if side else -1) * rng.uniform(0.08, 0.25)
                for h in range(1, 6):
                    f = snap(f0 * h + det * h, L)
                    if f > 4000:
                        continue
                    amp = 1 / h ** 1.6 * (0.6 if m < 45 else 1.0)
                    # tremolo sangat pelan per partial (siklus bulat)
                    trem = 1 + 0.25 * np.sin(2 * np.pi * snap(rng.uniform(0.05, 0.2), L) * t + rng.uniform(0, 6.28))
                    out[side] += w * amp * trem * np.sin(2 * np.pi * f * t + rng.uniform(0, 2 * np.pi))
    # kilau oktaf atas yang muncul-hilang pelan
    for side in (0, 1):
        sh = np.zeros(n)
        for m in (81, 84, 86, 88):
            f = snap(midi(m) * (1 + rng.uniform(-0.002, 0.002)), L)
            env = np.maximum(0, periodic_smooth(n, L, rng, 5)) ** 2
            sh += env * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28))
        out[side] += sh * 0.12
        # udara: noise lembut pita tinggi
        out[side] += fft_band(rng.normal(size=n), 3000, 9000) * 0.01
    # redam terang: lowpass sirkular
    for side in (0, 1):
        out[side] = fft_band(out[side], 0, 2500, order=1)
    ir = reverb_ir(3.5, 1.4, rng, lowpass=5000, stereo=True)
    wet = np.stack([circular_convolve(out[s], ir[s]) for s in (0, 1)])
    mix = out * 0.55 + wet * 0.9
    return normalize(mix, -4.0)


def make_wind(rng):
    """Angin mono: 3 pita noise (gemuruh, siul, desis), gain tiap pita = hembusan acak periodik."""
    L = LOOP_SEC
    n = L * SR
    gust = 0.5 + 0.5 * periodic_smooth(n, L, rng, 14, amp_decay=0.7)
    gust2 = 0.5 + 0.5 * periodic_smooth(n, L, rng, 20, amp_decay=0.6)
    low = fft_band(rng.normal(size=n), 60, 320) * (0.5 + 0.6 * gust)
    mid = fft_band(rng.normal(size=n), 500, 900, order=4) * (gust2 ** 2) * 0.8
    high = fft_band(rng.normal(size=n), 2500, 7000) * (0.15 + 0.5 * gust ** 3) * 0.6
    # desis dijinakkan: lowpass sirkular 4.5 kHz (versi pertama nyaris putih sampai 12 kHz)
    x = fft_band(low + mid + high * 0.5, 0, 4500, order=2)
    return normalize(x, -5.0)


def make_room(rng):
    """Dengung ruang mono: drone 55 Hz + harmonik ganjil, beating pelan, noise AC lembut."""
    L = LOOP_SEC
    n = L * SR
    t = np.arange(n) / SR
    x = np.zeros(n)
    for h, a in ((1, 1.0), (2, 0.35), (3, 0.5), (5, 0.18), (7, 0.08)):
        for det in (-0.1, 0.1):
            f = snap(55 * h + det * h, L)
            x += a * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28))
    x *= 1 + 0.2 * periodic_smooth(n, L, rng, 4)
    x += fft_band(rng.normal(size=n), 120, 900) * 0.35 * (1 + 0.3 * periodic_smooth(n, L, rng, 8))
    return normalize(x, -6.0)


def make_circles(rng):
    """Swell cincin portal (loop 8 s): partial inharmonik seperti logam ditiup, bergetar."""
    L = CIRCLES_SEC
    n = L * SR
    t = np.arange(n) / SR
    x = np.zeros(n)
    base = 196.0
    for ratio, a in ((1.0, 1.0), (2.76, 0.6), (5.40, 0.35), (8.93, 0.2), (13.34, 0.12)):
        f = snap(base * ratio, L)
        lfo = snap(rng.uniform(3, 7), L)
        trem = 1 + 0.35 * np.sin(2 * np.pi * lfo * t + rng.uniform(0, 6.28))
        x += a * trem * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28))
    x += fft_band(rng.normal(size=n), 800, 3000, order=3) * 0.25
    x *= 0.8 + 0.2 * periodic_smooth(n, L, rng, 3)
    x = circular_convolve(x, reverb_ir(2.5, 0.9, rng, lowpass=7000)) * 0.8 + x * 0.4
    return normalize(x, -4.0)


def make_particles(rng):
    """Kilau granular (loop 6 s): ratusan butir sinus pendek bernada tinggi, ditaruh melingkar
    (butir yang lewat ujung dilipat ke awal) supaya loop mulus, plus desis lembut."""
    L = PARTICLES_SEC
    n = L * SR
    x = np.zeros(n)
    for _ in range(420):
        dur = rng.uniform(0.015, 0.06)
        m = int(dur * SR)
        tt = np.arange(m) / SR
        f = rng.choice([1568, 1760, 2093, 2349, 2637, 3136, 3520, 4186]) * rng.uniform(0.995, 1.005)
        grain = np.sin(2 * np.pi * f * tt) * np.hanning(m) * rng.uniform(0.2, 1.0)
        idx = (int(rng.uniform(0, n)) + np.arange(m)) % n
        x[idx] += grain
    x += fft_band(rng.normal(size=n), 4000, 9000) * 0.08
    x = circular_convolve(x, reverb_ir(1.2, 0.35, rng, lowpass=8000)) * 0.7 + x * 0.5
    return normalize(x, -6.0)


# ---------- one-shot ----------

def tone(f, sec, a=0.004, r=0.04, shape='sine'):
    n = int(sec * SR)
    t = np.arange(n) / SR
    y = np.sin(2 * np.pi * f * t)
    if shape == 'tri':
        y = signal.sawtooth(2 * np.pi * f * t, 0.5)
    return y * adsr(n, a, 0.01, 0, r, 0.8)


def place(buf, x, at):
    i = int(at * SR)
    end = min(len(buf), i + len(x))
    buf[i:end] += x[:end - i]


def with_tail(x, rng, sec=0.6, decay=0.25, wet=0.35):
    ir = reverb_ir(sec, decay, rng, lowpass=7000)
    y = np.concatenate([x, np.zeros(len(ir))])
    return y * (1 - wet) + signal.fftconvolve(y, ir)[:len(y)] * wet


def make_beeps(rng, variant):
    total = 1.0
    buf = np.zeros(int(total * SR))
    if variant == 1:  # 3 blip cepat nada sama
        for i in range(3):
            place(buf, tone(2400, 0.05) * 0.8, 0.02 + i * 0.09)
    elif variant == 2:  # dua nada naik
        place(buf, tone(1800, 0.07), 0.02)
        place(buf, tone(2700, 0.09), 0.13)
    else:  # 5 blip turun cepat
        for i, f in enumerate((3200, 2900, 2600, 2300, 2000)):
            place(buf, tone(f, 0.035) * 0.7, 0.02 + i * 0.055)
    y = with_tail(buf, rng, 0.5, 0.15, 0.25)
    return normalize(y[: int(0.8 * SR)], -6.0)


def make_click(rng):
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    sweep = np.sin(2 * np.pi * np.cumsum(900 * np.exp(-t * 18) + 120) / SR) * np.exp(-t * 22)
    burst = fft_band(rng.normal(size=n), 1500, 8000) * np.exp(-t * 90) * 0.6
    y = with_tail(sweep + burst, rng, 0.4, 0.12, 0.2)
    return normalize(y, -3.0)


def make_whoosh(rng, rising):
    sec = 1.6 if rising else 1.3
    n = int(sec * SR)
    t = np.arange(n) / SR
    u = t / sec
    noise = rng.normal(size=n)
    # filter bandpass bergerak: bank 24 pita, bobot bergeser mengikuti waktu
    centers = np.geomspace(200, 6000, 24)
    pos = (u if rising else 1 - u) * (len(centers) - 1)
    y = np.zeros(n)
    for i, c in enumerate(centers):
        b, a = signal.butter(2, [c / 1.25 / (SR / 2), min(0.99, c * 1.25 / (SR / 2))], btype='band')
        band = signal.lfilter(b, a, noise)
        y += band * np.exp(-0.5 * ((pos - i) / 2.2) ** 2)
    env = np.sin(np.pi * u) ** (1.5 if rising else 1.0)
    if not rising:
        env = np.exp(-u * 2.5) * np.minimum(1, u * 30)
    f = 220 * (2 ** (u * 1.0)) if rising else 330 * 2 ** (-u)
    ton = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.25 + np.sin(2 * np.pi * np.cumsum(f * 1.5) / SR) * 0.12
    y = (y * 0.8 + ton) * env
    return normalize(with_tail(y, rng, 1.2, 0.4, 0.4), -4.0)


def make_project_text(rng):
    total = 0.9
    buf = np.zeros(int(total * SR))
    n_tick = int(0.012 * SR)
    tt = np.arange(n_tick) / SR
    for i in range(26):
        at = 0.02 + i * 0.026 + rng.uniform(-0.006, 0.006)
        f = rng.choice([1400, 1900, 2600, 3300])
        tick = np.sin(2 * np.pi * f * tt) * np.exp(-tt * 380) * rng.uniform(0.3, 0.8)
        place(buf, tick, at)
    t = np.arange(len(buf)) / SR
    buf += np.sin(2 * np.pi * 660 * t) * adsr(len(buf), 0.05, 0.1, 0, 0.4, 0.5) * 0.06
    return normalize(with_tail(buf, rng, 0.5, 0.15, 0.25)[: int(1.2 * SR)], -6.0)


def make_logo(rng):
    sec = 1.8
    n = int(sec * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    # lonceng kecil: partial inharmonik, peluruhan beda per partial
    for ratio, a, d in ((1.0, 1.0, 1.1), (2.32, 0.5, 0.7), (4.25, 0.3, 0.45), (6.63, 0.15, 0.3)):
        y += a * np.sin(2 * np.pi * 880 * ratio * t) * np.exp(-t / d)
    y += np.sin(2 * np.pi * 1320 * t) * np.exp(-t / 0.9) * 0.4 * np.clip((t - 0.08) / 0.01, 0, 1)
    y *= np.clip((sec - t) / 0.4, 0, 1)  # pudar sebelum buffer kering habis, ekor diambil alih reverb
    y *= np.minimum(1, t / 0.003)
    return normalize(with_tail(y, rng, 1.0, 0.35, 0.3), -5.0)


def make_ui_long(rng):
    total = 0.7
    buf = np.zeros(int(total * SR))
    for i, f in enumerate((1047, 1319, 1568, 2093, 1568, 2637)):
        place(buf, tone(f, 0.06, r=0.03) * (0.9 - i * 0.08), 0.01 + i * 0.045)
    t = np.arange(len(buf)) / SR
    buf *= 1 + 0.4 * np.sin(2 * np.pi * 32 * t)
    return normalize(with_tail(buf, rng, 0.5, 0.15, 0.3)[: int(0.9 * SR)], -6.0)


def make_ui_short(rng):
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    y = np.sin(2 * np.pi * 2200 * t) * np.exp(-t * 70) * np.clip(t / 0.002, 0, 1) + fft_band(rng.normal(size=n), 3000, 9000) * np.exp(-t * 300) * 0.3
    return normalize(with_tail(y, rng, 0.25, 0.06, 0.2)[: int(0.25 * SR)], -6.0)


# ---------- tulis dan encode ----------

def write_wav(path, x):
    x = np.atleast_2d(x)
    data = (np.clip(x.T, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(x.shape[0])
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


def encode(ffmpeg, wav, ogg, kbps):
    subprocess.run([ffmpeg, '-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libopus', '-b:a', f'{kbps}k',
                    '-vbr', 'on', '-compression_level', '10', '-application', 'audio', '-map_metadata', '-1', ogg],
                   check=True)


def decode(ffmpeg, ogg):
    """Decode ulang .ogg ke float (mono = rata-rata kanal) untuk spektrogram dan cek panjang."""
    raw = subprocess.run([ffmpeg, '-loglevel', 'error', '-i', ogg, '-f', 'f32le', '-ac', '1', '-ar', str(SR), '-'],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype='<f4')


def spectrogram(name, x, path):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(2, 1, figsize=(10, 5), gridspec_kw={'height_ratios': [1, 3]}, constrained_layout=True)
    t = np.arange(len(x)) / SR
    step = max(1, len(x) // 4000)
    ax[0].plot(t[::step], x[::step], lw=0.5, color='#334')
    ax[0].set_xlim(0, t[-1])
    ax[0].set_ylim(-1, 1)
    ax[0].set_title(f'{name}  {len(x) / SR:.3f} s  peak {np.abs(x).max():.2f}  rms {np.sqrt(np.mean(x ** 2)):.3f}')
    nfft = 2048 if len(x) > SR * 2 else 512
    f, tt, S = signal.spectrogram(x, SR, nperseg=nfft, noverlap=nfft * 3 // 4)
    ax[1].pcolormesh(tt, f, 10 * np.log10(S + 1e-12), shading='auto', cmap='magma', vmin=-120, vmax=-30)
    ax[1].set_ylim(0, 12000)
    ax[1].set_ylabel('Hz')
    ax[1].set_xlabel('s')
    fig.savefig(path, dpi=80)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--no-spectro', action='store_true')
    args = ap.parse_args()
    ffmpeg = find_ffmpeg()
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(SPECTRO, exist_ok=True)
    rng = np.random.default_rng(20261015)

    jobs = [
        ('music', lambda: make_music(rng), BITRATE['music']),
        ('wind', lambda: make_wind(rng), BITRATE['wind']),
        ('room', lambda: make_room(rng), BITRATE['room']),
        ('circles', lambda: make_circles(rng), BITRATE['circles']),
        ('particles', lambda: make_particles(rng), BITRATE['particles']),
        ('beeps', lambda: make_beeps(rng, 1), BITRATE['oneshot']),
        ('beeps2', lambda: make_beeps(rng, 2), BITRATE['oneshot']),
        ('beeps3', lambda: make_beeps(rng, 3), BITRATE['oneshot']),
        ('click-project', lambda: make_click(rng), BITRATE['oneshot']),
        ('enter-project', lambda: make_whoosh(rng, True), BITRATE['oneshot']),
        ('leave-project', lambda: make_whoosh(rng, False), BITRATE['oneshot']),
        ('project-text', lambda: make_project_text(rng), BITRATE['oneshot']),
        ('logo', lambda: make_logo(rng), BITRATE['oneshot']),
        ('ui-long', lambda: make_ui_long(rng), BITRATE['oneshot']),
        ('ui-short', lambda: make_ui_short(rng), BITRATE['oneshot']),
    ]
    total = 0
    with tempfile.TemporaryDirectory() as tmp:
        for name, fn, kbps in jobs:
            x = fn()
            is_loop = name in LOOPS
            if not is_loop:
                # one-shot: masuk 1 ms, keluar 30 ms, supaya potongan panjang file tidak berbunyi klik
                i = np.arange(x.shape[-1]) / SR
                x = x * np.clip(i / 0.001, 0, 1) * np.clip((i[-1] - i) / 0.03, 0, 1)
            if is_loop:
                pad = int(LOOP_PAD * SR)
                x = np.concatenate([x[..., -pad:], x, x[..., :pad]], axis=-1)
            wav = os.path.join(tmp, name + '.wav')
            ogg = os.path.join(OUT, name + '.ogg')
            write_wav(wav, x)
            encode(ffmpeg, wav, ogg, kbps)
            size = os.path.getsize(ogg)
            total += size
            ch = 2 if np.ndim(x) == 2 else 1
            src_len = x.shape[-1]
            dec = decode(ffmpeg, ogg)
            # sambungan loop: lompatan sampel terakhir -> pertama dibanding lompatan rata-rata
            # (hanya bermakna untuk loop, dihitung di titik loopStart/loopEnd yang dipakai Audio.js)
            seam_txt = ''
            if is_loop:
                pad = int(LOOP_PAD * SR)
                core_len = len(dec) - 2 * pad
                steps = np.abs(np.diff(dec[pad:-pad]))
                raw = abs(float(dec[pad] - dec[pad + core_len - 1]))
                # Audio.js menyembuhkan sambungan: HEAL sampel awal loop di-crossfade dari salinan kepala di
                # bantalan belakang (kode Opus yang sama-sama kontinu dengan sampel terakhir loop).
                healed = dec.copy()
                i = np.arange(HEAL)
                healed[pad + i] = dec[pad + core_len + i] * (1 - i / HEAL) + dec[pad + i] * (i / HEAL)
                fixed = abs(float(healed[pad] - healed[pad + core_len - 1]))
                pct = lambda v: 100 * np.mean(steps < v)
                seam_txt = (f'  sambungan mentah {raw:.4f} (persentil {pct(raw):5.1f}), '
                            f'sesudah heal {fixed:.4f} (persentil {pct(fixed):5.1f})')
            print(f'{name:15s} {ch}ch {src_len / SR:7.3f}s -> decode {len(dec) / SR:7.3f}s  {kbps:3d}k  '
                  f'{size / 1024:7.1f} KB{seam_txt}')
            if not args.no_spectro:
                spectrogram(name, dec, os.path.join(SPECTRO, name + '.png'))
    print(f'TOTAL {total / 1024:.1f} KB ({total / 1e6:.3f} MB) di {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    main()
