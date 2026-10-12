#!/usr/bin/env python3
"""Score and sound design for the Tuff v2.4.14 film.

Reads the cue list the scene writes (cues2.json / cues3.json: {T, cues}) and renders a 48 kHz stereo WAV.
120 BPM in D major, I–V–vi–IV. Everything is synthesised here and seeded, so a re-run is bit-identical.
Usage: python3 music.py cues2.json music.wav
"""
import json
import sys

import numpy as np
from scipy import signal
from scipy.io import wavfile
from scipy.ndimage import minimum_filter1d, uniform_filter1d

SR = 48000
cfg = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'cues2.json'))
OUT = sys.argv[2] if len(sys.argv) > 2 else 'music.wav'
T = cfg['T']
CUES = cfg['cues']
DUR = float(T['final'])
N = int(round(DUR * SR))
BEAT = 0.5
BAR = 2.0
S16 = BEAT / 4
rng = np.random.default_rng(20261011)


def sec(x):
    return int(round(x * SR))


def tt(dur):
    return np.arange(sec(dur)) / SR


def filt(x, kind, f, order=2):
    return signal.sosfilt(signal.butter(order, f, kind, fs=SR, output='sos'), x, axis=-1)


def midi(name):
    names = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}
    return 12 * (int(name[-1]) + 1) + names[name[:-1]]


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


class Bus:
    def __init__(self):
        self.x = np.zeros((2, N))

    def add(self, sig, t, gain=1.0, pan=0.0):
        i = sec(t)
        if sig.ndim == 1:
            a = (np.clip(pan, -1, 1) + 1) * np.pi / 4
            sig = np.vstack([sig * np.cos(a), sig * np.sin(a)]) * np.sqrt(2)
        if i < 0:
            sig = sig[:, -i:]
            i = 0
        n = min(sig.shape[1], N - i)
        if n > 0:
            self.x[:, i:i + n] += gain * sig[:, :n]


def ramp_edges(x, a=0.002, r=0.01):
    n = x.shape[-1]
    na, nr = min(sec(a), n), min(sec(r), n)
    if na:
        x[..., :na] *= np.linspace(0, 1, na)
    if nr:
        x[..., n - nr:] *= np.linspace(1, 0, nr)
    return x


# ---------------------------------------------------------------- oscillators & filters
def polyblep_saw(f, n, phase0):
    dt = f / SR
    ph = (phase0 + dt * np.arange(n)) % 1.0
    y = 2 * ph - 1
    m = ph < dt
    u = ph[m] / dt
    y[m] -= u + u - u * u - 1
    m = ph > 1 - dt
    u = (ph[m] - 1) / dt
    y[m] -= u * u + u + u + 1
    return y


def svf(x, fc, q=0.9, mode='bp'):
    """Time-varying TPT state-variable filter (used only for short SFX)."""
    g = np.tan(np.pi * np.clip(fc, 20, SR * 0.45) / SR)
    k = 1.0 / q
    ic1 = ic2 = 0.0
    y = np.empty_like(x)
    for i in range(len(x)):
        gi = g[i]
        a1 = 1 / (1 + gi * (gi + k))
        a2 = gi * a1
        a3 = gi * a2
        v3 = x[i] - ic2
        v1 = a1 * ic1 + a2 * v3
        v2 = ic2 + a2 * ic1 + a3 * v3
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        y[i] = v1 if mode == 'bp' else v2
    return y


# ---------------------------------------------------------------- drums
def make_kick(f_hi=150, f_lo=46, decay=0.2):
    t = tt(0.55)
    f = f_lo + (f_hi - f_lo) * np.exp(-t / 0.032)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / decay)
    click = filt(rng.standard_normal(len(t)) * np.exp(-t / 0.0025), 'lowpass', 5000) * 0.9
    x = np.tanh(2.2 * (body + click)) / np.tanh(2.2)
    return ramp_edges(x, 0.0008, 0.02)


def make_clap():
    t = tt(0.35)
    env = np.zeros(len(t))
    for off, g in ((0.0, 0.7), (0.012, 0.8), (0.024, 1.0)):
        u = np.clip(t - off, 0, None)
        env += g * (t >= off) * np.exp(-u / 0.005)
    env += 0.55 * (t >= 0.024) * np.exp(-np.clip(t - 0.024, 0, None) / 0.1)
    x = filt(rng.standard_normal(len(t)) * env, 'bandpass', [900, 5200])
    return ramp_edges(x / np.max(np.abs(x)))


def make_hat(open_=False):
    t = tt(0.3 if open_ else 0.07)
    x = filt(rng.standard_normal(len(t)), 'highpass', 7200, 4) * np.exp(-t / (0.09 if open_ else 0.013))
    return ramp_edges(x / np.max(np.abs(x)), 0.0005, 0.005)


def make_snare():
    t = tt(0.26)
    tone = np.sin(2 * np.pi * 195 * t) * np.exp(-t / 0.045) * 0.55
    noise = filt(rng.standard_normal(len(t)), 'bandpass', [1300, 8500]) * np.exp(-t / 0.075)
    x = tone + noise
    return ramp_edges(x / np.max(np.abs(x)), 0.0005)


def make_crash(dur=2.6, tau=0.75):
    t = tt(dur)
    x = filt(filt(rng.standard_normal((2, len(t))), 'highpass', 3200), 'lowpass', 13000)
    x *= np.exp(-t / tau)
    return ramp_edges(x / np.max(np.abs(x)), 0.001, 0.05)


KICK = make_kick()
KICK_BIG = make_kick(170, 40, 0.42)
CLAP = make_clap()
HAT = make_hat()
OHAT = make_hat(True)
SNARE = make_snare()
CRASH = make_crash()


# ---------------------------------------------------------------- tonal instruments
_pluck_cache = {}


def pluck(m, dur=0.7, bright=1.0):
    key = (m, dur, round(bright, 2))
    if key not in _pluck_cache:
        f = hz(m)
        t = tt(dur)
        x = np.zeros(len(t))
        for k in range(1, int(min(36, 0.45 * SR / f)) + 1):
            x += np.sin(2 * np.pi * k * f * t) * np.exp(-(5.5 + 2.8 * k / bright) * t) / k
        x /= np.max(np.abs(x))
        _pluck_cache[key] = ramp_edges(x, 0.0015, 0.04)
    return _pluck_cache[key]


def bell(m, dur=1.8, ratio=2.0, index=1.4, tau=0.7):
    f = hz(m)
    t = tt(dur)
    mod = index * np.exp(-t / 0.22) * np.sin(2 * np.pi * f * ratio * t)
    x = np.sin(2 * np.pi * f * t + mod) * np.exp(-t / tau)
    x += 0.25 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / (tau * 0.4))
    return ramp_edges(x / np.max(np.abs(x)), 0.001, 0.05)


def bass_note(m, dur, decay=0.32):
    f = hz(m)
    t = tt(dur)
    x = np.sin(2 * np.pi * f * t) + 0.42 * np.sin(2 * np.pi * 2 * f * t) + 0.18 * np.sin(2 * np.pi * 3 * f * t)
    x *= np.exp(-t / decay)
    return ramp_edges(x / 1.4, 0.004, 0.02)


def pad_chord(notes, dur, attack=0.12, release=0.35, cutoff=2400.0, level=1.0):
    n = sec(dur + release)
    t = np.arange(n) / SR
    out = np.zeros((2, n))
    for m in notes:
        for cents, pan in ((-11, -0.7), (0, 0.0), (11, 0.7)):
            s = polyblep_saw(hz(m) * 2 ** (cents / 1200), n, rng.random())
            a = (pan + 1) * np.pi / 4
            out[0] += s * np.cos(a)
            out[1] += s * np.sin(a)
    out = filt(filt(out, 'lowpass', cutoff), 'lowpass', cutoff * 1.4)
    env = np.minimum(1, t / attack) * np.clip((dur + release - t) / release, 0, 1)
    return out * env * level / (len(notes) * 2.2)


# ---------------------------------------------------------------- arrangement
CH = {
    'D': dict(pad=['D4', 'F#4', 'A4'], arp=['D5', 'F#5', 'A5', 'D6'], bass='D2'),
    'A': dict(pad=['C#4', 'E4', 'A4'], arp=['C#5', 'E5', 'A5', 'C#6'], bass='A2'),
    'Bm': dict(pad=['D4', 'F#4', 'B4'], arp=['D5', 'F#5', 'B5', 'D6'], bass='B2'),
    'G': dict(pad=['D4', 'G4', 'B4'], arp=['D5', 'G5', 'B5', 'D6'], bass='G2'),
}
# Intro bar, I–V–vi–IV until the build, a turnaround that lands the build bar on V, then I under the end card.
END_BAR = int(round(T['end'] / BAR))
BUILD = END_BAR - 1                       # the bar that drives into the gap
CYCLES = (END_BAR - 3) // 4
TAIL = {2: ['D', 'A'], 3: ['D', 'G', 'A'], 4: ['D', 'A', 'G', 'A'], 5: ['D', 'A', 'Bm', 'G', 'A']}[END_BAR - 1 - 4 * CYCLES]
PROG = ['D'] + ['D', 'A', 'Bm', 'G'] * CYCLES + TAIL
PROG += ['D'] * int(np.ceil(DUR / BAR - len(PROG)))  # v2: 17 bars = 34 s; v3: 23 bars = 46 s
assert len(PROG) * BAR >= DUR and PROG[BUILD] == 'A' and len(PROG) == END_BAR + int(np.ceil(DUR / BAR - END_BAR))
ARP = [0, 2, 3, 2, 1, 2, 3, 2, 0, 2, 3, 2, 1, 2, 3, 1]
ACCENT = {0, 3, 6, 10, 13}

MEM0, MEM1 = T['yd'], T['flip']            # the "yesterday" bar: muffled, no drums
GAP0, GAP1 = T['moreOut'] + 0.35, T['end']  # one beat of silence before the end card
SCAN0, SCAN1 = T['scan'] - 0.05, T['scan'] + 0.85

# Two complete bus sets: material that starts before the gap is muted for good at the gap,
# so no tail (pad release, pluck ring, reverb) can leak under the end-card chord.
LAYERS = ('drums', 'bass', 'pad', 'arp', 'bells', 'rev', 'dly')
MAIN = {k: Bus() for k in LAYERS}
END = {k: Bus() for k in LAYERS}
kick_main, kick_end = [], []


class Router:
    def __init__(self, layer):
        self.layer = layer

    def add(self, sig, t, gain=1.0, pan=0.0):
        (END if t >= T['end'] - 1e-6 else MAIN)[self.layer].add(sig, t, gain, pan)


drums, bass, pad, arp, bells, sends_rev, sends_dly = (Router(k) for k in LAYERS)


def kick_at(t, big=False):
    drums.add(KICK_BIG if big else KICK, t, 0.85 if big else 0.5)
    (kick_end if t >= T['end'] - 1e-6 else kick_main).append(t)


def in_mem(t):
    return MEM0 - 0.02 <= t < MEM1


for b, name in enumerate(PROG):
    t0 = b * BAR
    c = CH[name]
    final = t0 >= T['end']
    # pad
    notes = [midi(x) for x in c['pad']]
    if b == 0:
        p = pad_chord(notes, BAR, attack=1.6, cutoff=1300, level=0.8)
    elif t0 == T['end']:
        p = pad_chord(notes + [midi('D3')], DUR - t0, attack=0.015, release=0.01, cutoff=3200, level=1.25)
    elif final:
        p = None
    elif b == BUILD:
        p = pad_chord(notes, GAP0 - t0, release=0.02, cutoff=3400)
    else:
        p = pad_chord(notes, BAR)
    if p is not None:
        pad.add(p, t0, 0.75)
        sends_rev.add(p, t0, 0.35)
    # arp
    for s in range(16):
        t = t0 + s * S16
        if GAP0 <= t < GAP1 or t >= T['end'] + BAR:
            continue
        vel = 1.0 if s in ACCENT else 0.62
        if b == 0:
            g, br = 0.22 + 0.25 * (s / 16), 0.45
        elif in_mem(t):
            g, br = 0.5, 0.6
        elif b == BUILD:
            g, br = 0.85 + 0.35 * (s / 16), 1.0 + 0.8 * (s / 16)
        elif final:
            g, br = 0.55 * (1 - s / 16), 0.9
        else:
            g, br = 0.8, 1.0
        if SCAN0 <= t < SCAN1:
            g *= 0.45
        m = midi(c['arp'][ARP[s]])
        x = pluck(m, 0.6, br)
        pan = 0.25 if s % 2 else -0.25
        arp.add(x, t, 0.62 * g * vel, pan)
        sends_dly.add(x, t, 0.62 * g * vel * 0.5)
        sends_rev.add(x, t, 0.62 * g * vel * 0.22)
    # bass
    if b >= 1 and not final:
        if t0 == MEM0:
            bass.add(bass_note(midi(c['bass']), BAR, decay=0.9), t0, 0.5)
        else:
            for beat in range(4):
                t = t0 + beat * BEAT
                if b == BUILD:  # driving straight eighths into the gap
                    for off in (0.0, 0.25):
                        if t + off < GAP0:
                            bass.add(bass_note(midi(c['bass']), 0.22), t + off, 0.5)
                elif t + 0.25 < GAP0:
                    bass.add(bass_note(midi(c['bass']), 0.22), t + 0.25, 0.62)
    # drums
    if b >= 1 and not final and not in_mem(t0):
        for beat in range(4):
            t = t0 + beat * BEAT
            if t < GAP0:
                kick_at(t)
            if b >= 2 and t + 0.25 < GAP0:
                drums.add(HAT, t + 0.25, 0.16, 0.25)
            if b >= 7 and b != BUILD:
                for off in (0.125, 0.375):
                    drums.add(HAT, t + off, 0.06, -0.3)
            if b >= 3 and b != BUILD and beat in (1, 3):
                drums.add(CLAP, t, 0.3, 0.05)
                sends_rev.add(CLAP, t, 0.12)
        if b % 4 == 0 and 0 < b < BUILD and t0 + 1.75 < GAP0:
            drums.add(OHAT, t0 + 1.75, 0.12, 0.3)

# memory bar: a music-box line over the muffled bed, rising back into "today"
for t, n in ((MEM0 + 0.0, 'A5'), (MEM0 + 0.5, 'F#5'), (MEM0 + 1.0, 'D6'), (MEM0 + 1.25, 'C#6'), (MEM0 + 1.5, 'A5')):
    x = bell(midi(n), 1.6, ratio=3.0, index=0.9, tau=0.55)
    bells.add(x, t, 0.2, 0.15)
    sends_rev.add(x, t, 0.25)
# snare fill into "today", then the room comes back with a crash
for i, off in enumerate((0.0, 0.125, 0.25, 0.3125, 0.375, 0.4375)):
    drums.add(SNARE, MEM1 - 0.5 + off, 0.16 + 0.07 * i)
drums.add(CRASH, MEM1, 0.32)
drums.add(CRASH, T['cbIn'], 0.18)
if cfg.get('version', 2) >= 3:  # v3: the finale opens a new section
    drums.add(CRASH, T['more'], 0.2)
    sends_rev.add(CRASH, T['more'], 0.08)
sends_rev.add(CRASH, MEM1, 0.1)

# build: snare roll that tightens to 32nds, plus a riser, all cut by the gap
B_BUILD = BUILD * BAR
roll = [B_BUILD + i * 0.25 for i in range(4)] + [B_BUILD + 1.0 + i * 0.125 for i in range(4)] + [B_BUILD + 1.5 + i * 0.0625 for i in range(4)]
for i, t in enumerate(roll):
    if t < GAP0:
        drums.add(SNARE, t, 0.12 + 0.3 * (i / len(roll)) ** 1.4, 0.0)

# impact on the end card
kick_at(T['end'], big=True)
drums.add(CRASH, T['end'], 0.5)
sends_rev.add(CRASH, T['end'], 0.18)
tt_sub = tt(2.2)
sub = np.sin(2 * np.pi * np.cumsum(34 + 50 * np.exp(-tt_sub / 0.25)) / SR) * np.exp(-tt_sub / 0.9)
bass.add(ramp_edges(sub, 0.002, 0.2), T['end'], 0.55)
for i, n in enumerate(('D6', 'F#6', 'A6', 'D7')):
    x = bell(midi(n), 2.6, ratio=2.0, index=1.1, tau=1.1)
    bells.add(x, T['end'] + 0.06 * i, 0.16, -0.45 + 0.3 * i)
    sends_rev.add(x, T['end'] + 0.06 * i, 0.3)
for n in ('D3', 'A3', 'D4', 'F#4', 'A4'):
    x = pluck(midi(n), 2.0, 1.3)
    arp.add(x, T['end'], 0.13)
    sends_rev.add(x, T['end'], 0.12)

# ---------------------------------------------------------------- sidechain, delay, reverb
def duck(depth, kicks, rel=0.13):
    env = np.ones(N)
    seg = np.arange(sec(0.6)) / SR
    shape = 1 - depth * np.exp(-seg / rel) * np.minimum(1, seg / 0.004 + 0.25)
    for k in kicks:
        i = sec(k)
        n = min(len(shape), N - i)
        env[i:i + n] = np.minimum(env[i:i + n], shape[:n])
    return env


def pingpong(x, delay=0.375, fb=0.42, taps=6):
    m = x.mean(axis=0)
    out = np.zeros((2, N))
    d = sec(delay)
    s = m
    for k in range(1, taps + 1):
        s = filt(s, 'lowpass', 4200, 1) * fb
        ch = 1 if k % 2 else 0
        out[ch, k * d:] += s[:N - k * d]
    return out


def reverb(x, rt60=2.3, dur=3.0, pre=0.022):
    n = sec(dur)
    t = np.arange(n) / SR
    ir = rng.standard_normal((2, n)) * np.exp(-6.91 * t / rt60)
    dark = filt(ir, 'lowpass', 1600, 1)
    w = np.minimum(1, t / 0.9)
    ir = filt(ir, 'lowpass', 7000, 1) * (1 - w) + dark * w
    ir[:, :sec(pre)] = 0
    ir /= np.sqrt(np.sum(ir ** 2, axis=1, keepdims=True))
    return np.vstack([signal.fftconvolve(x[c], ir[c])[:N] for c in range(2)])


IR_SEED = rng.integers(1 << 31)


def render(B, kicks):
    B['bass'].x *= duck(0.6, kicks)
    B['pad'].x *= duck(0.5, kicks)
    B['arp'].x *= duck(0.3, kicks)
    dly = pingpong(B['dly'].x) * duck(0.35, kicks)
    out = B['drums'].x + B['bass'].x + B['pad'].x + B['arp'].x + B['bells'].x + 0.55 * dly
    out = filt(out, 'highpass', 28, 2)
    global rng
    keep, rng = rng, np.random.default_rng(IR_SEED)  # same room for both halves
    out += 0.42 * filt(reverb(B['rev'].x + 0.4 * dly), 'highpass', 180, 2)
    rng = keep
    return out


music = render(MAIN, kick_main)
music_end = render(END, kick_end)
if '--stems' in sys.argv:
    def kw(x):
        b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
        y = signal.lfilter([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621], signal.lfilter(b1, a1, x, axis=1), axis=1)
        y = y[:, sec(12.0):sec(20.0)]
        return -0.691 + 10 * np.log10(np.sum(np.mean(y ** 2, axis=1)) + 1e-12)
    for k in LAYERS:
        print(f'{k:6s} {kw(MAIN[k].x):6.1f}')
    print(f'music  {kw(music):6.1f}')


# ---------------------------------------------------------------- music-bus moves
def tape_stop(x, t0, t1):
    i0, i1 = sec(t0), sec(t1)
    n = i1 - i0
    speed = (1 - np.arange(n) / n) ** 1.6
    pos = i0 + np.cumsum(speed)
    idx = np.arange(x.shape[1])
    for c in range(2):
        x[c, i0:i1] = np.interp(pos, idx, x[c])
    x[:, i1 - sec(0.04):i1] *= np.linspace(1, 0, sec(0.04))
    x[:, i1:sec(MEM0)] = 0


def smoothstep(a, b, t):
    u = np.clip((t - a) / (b - a), 0, 1)
    return u * u * (3 - 2 * u)


tape_stop(music, MEM0 - 0.42, MEM0 - 0.04)
tn = np.arange(N) / SR
muffled = filt(filt(music, 'lowpass', 620, 2), 'lowpass', 900, 1) * 1.35
w = smoothstep(MEM0 - 0.04, MEM0 + 0.08, tn) * (1 - smoothstep(MEM1 - 0.55, MEM1 - 0.01, tn))
music = music * (1 - w) + muffled * w
music *= 1 - smoothstep(GAP0 - 0.03, GAP0, tn)
music += music_end
gate = 1 - smoothstep(GAP0 - 0.03, GAP0, tn) * (1 - smoothstep(GAP1 - 0.004, GAP1, tn))


# ---------------------------------------------------------------- sound effects from the scene's cues
sfx, sfx_rev = Bus(), Bus()


def noise(n):
    return rng.standard_normal(n)


def fx_key(n=1, big=False):
    out = np.zeros(sec(0.2))
    for j in range(n):
        t = tt(0.12)
        click = filt(noise(len(t)), 'bandpass', [1700, 6800]) * np.exp(-t / 0.0045)
        f = 150 + 140 * np.exp(-t / 0.01)
        thock = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (0.035 if big else 0.024))
        x = 0.9 * click / np.max(np.abs(click)) + (0.85 if big else 0.5) * thock
        i = sec(0.022 * j)
        out[i:i + len(x)] += x
    return ramp_edges(out, 0.0003, 0.01)


def fx_type():
    t = tt(0.06)
    f0 = rng.uniform(2600, 3600)
    click = filt(noise(len(t)), 'bandpass', [f0 * 0.6, f0 * 2.0]) * np.exp(-t / 0.0035)
    thock = np.sin(2 * np.pi * rng.uniform(230, 290) * t) * np.exp(-t / 0.012) * 0.35
    x = click / np.max(np.abs(click)) + thock
    return ramp_edges(x * rng.uniform(0.8, 1.1), 0.0003, 0.008)


def fx_pop(f0=1250, f1=560):
    t = tt(0.14)
    f = f1 + (f0 - f1) * np.exp(-t / 0.016)
    return ramp_edges(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.05), 0.0008, 0.02)


def fx_whoosh(dur, direction=0.0, soft=False):
    n = sec(dur)
    u = np.linspace(0, 1, n)
    peak = 0.42
    env = np.where(u < peak, (u / peak) ** 2.2, ((1 - u) / (1 - peak)) ** 1.6)
    fc = 350 + 2600 * np.sin(np.pi * np.clip(u / (peak * 2), 0, 1)) ** 1.3 + 500 * u
    left = svf(noise(n), fc, 1.1, 'bp')
    right = svf(noise(n), fc * 1.07, 1.1, 'bp')
    air = filt(noise(n), 'highpass', 5000) * 0.18
    x = np.vstack([left + air, right + air]) * env
    x /= np.max(np.abs(x))
    if direction:  # the camera moves content toward `direction`; the sound travels with it
        pan = -direction * 0.85 * (1 - 2 * u)
        a = (pan + 1) * np.pi / 4
        x = np.vstack([x.mean(axis=0) * np.cos(a), x.mean(axis=0) * np.sin(a)]) * np.sqrt(2) * 0.7 + x * 0.3
    return ramp_edges(x * (0.6 if soft else 1.0), 0.002, 0.03)


def fx_open():
    n = sec(0.45)
    u = np.linspace(0, 1, n)
    env = np.where(u < 0.6, (u / 0.6) ** 2.5, ((1 - u) / 0.4) ** 1.2)
    x = svf(noise(n), 200 + 1500 * u ** 1.5, 0.8, 'lp') * env
    t = tt(0.45)
    thump = np.sin(2 * np.pi * 70 * t) * np.exp(-np.clip(t - 0.27, 0, None) / 0.08) * (t > 0.27)
    x = x / np.max(np.abs(x)) + 0.5 * thump
    return ramp_edges(x, 0.01, 0.02)


def fx_flip():
    out = np.zeros(sec(0.2))
    for j, (f, g) in enumerate(((2400, 1.0), (1700, 0.8))):
        t = tt(0.05)
        x = filt(noise(len(t)), 'bandpass', [f * 0.7, f * 1.6]) * np.exp(-t / 0.004)
        x = x / np.max(np.abs(x)) + 0.4 * np.sin(2 * np.pi * 950 * t) * np.exp(-t / 0.012)
        i = sec(0.07 * j)
        out[i:i + len(x)] += g * x
    return ramp_edges(out, 0.0003, 0.01)


def fx_scan(dur):
    n = sec(dur)
    u = np.linspace(0, 1, n)
    t = np.arange(n) / SR
    f = 700 + 1300 * u
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * (0.6 + 0.4 * np.sin(2 * np.pi * 22 * t))
    hiss = svf(noise(n), 1800 + 5000 * u, 1.6, 'bp')
    env = np.minimum(1, u / 0.12) * np.minimum(1, (1 - u) / 0.15)
    x = (0.35 * tone + hiss / np.max(np.abs(hiss))) * env
    pan = -0.9 + 1.8 * u
    a = (pan + 1) * np.pi / 4
    return ramp_edges(np.vstack([x * np.cos(a), x * np.sin(a)]) * np.sqrt(2), 0.005, 0.02)


def fx_rewind():
    n = sec(0.5)
    u = np.linspace(0, 1, n)
    t = np.arange(n) / SR
    fc = 900 + 2600 * u + 700 * np.sin(2 * np.pi * 17 * t)
    x = svf(noise(n), fc, 3.0, 'bp')
    return ramp_edges(x / np.max(np.abs(x)) * u ** 1.8, 0.01, 0.03)


def place(kind, c):
    t = c['t']
    pan = c.get('pan', 0.0)
    if kind == 'key':
        x = fx_key(c.get('n', 1), c.get('big', False))
        sfx.add(x, t, 0.7 if c.get('big') else 1.1, 0.05)
        sfx_rev.add(x, t, 0.12 if c.get('big') else 0.04)
    elif kind == 'type':
        sfx.add(fx_type(), t, 0.3, rng.uniform(-0.15, 0.15))
    elif kind == 'pop':
        x = fx_pop()
        sfx.add(x, t, 0.7, pan)
        sfx_rev.add(x, t, 0.12)
    elif kind == 'whoosh':
        x = fx_whoosh(c.get('dur', 0.6), pan, c.get('soft', False))
        sfx.add(x, t - 0.1, 0.95)
        sfx_rev.add(x, t - 0.1, 0.2)
    elif kind == 'swish':
        sfx.add(fx_whoosh(0.4, -0.6, True), t - 0.03, 0.8)
    elif kind == 'open':
        sfx.add(fx_open(), t - 0.27, 0.7)
    elif kind == 'flip':
        sfx.add(fx_flip(), t, 1.6)
    elif kind == 'rewind':
        sfx.add(fx_rewind(), t - 0.45, 0.55)
    elif kind == 'sparkle':
        for i, n in enumerate(('A6', 'D7', 'F#7')):
            x = bell(midi(n), 1.2, ratio=2.0, index=0.8, tau=0.45)
            sfx.add(x, t + 0.055 * i, 0.09, -0.2 + 0.2 * i)
            sfx_rev.add(x, t + 0.055 * i, 0.12)
    elif kind == 'scan':
        sfx.add(fx_scan(c.get('dur', 0.8)), t, 0.15)
    elif kind == 'ping':
        order = sorted(x['t'] for x in CUES if x['kind'] == 'ping').index(t)
        x = bell(midi(('E6', 'A6', 'C#7')[order % 3]), 1.6, ratio=2.0, index=1.2, tau=0.6)
        sfx.add(x, t, 0.17, pan * 0.8)
        sfx_rev.add(x, t, 0.2)
    elif kind == 'chime':
        for i, n in enumerate(('A5', 'D6')):
            x = bell(midi(n), 1.6, ratio=2.0, index=1.0, tau=0.6)
            sfx.add(x, t + 0.085 * i, 0.2)
            sfx_rev.add(x, t + 0.085 * i, 0.2)
    elif kind == 'cascade':
        scale = ['D5', 'E5', 'F#5', 'A5', 'B5', 'D6', 'E6', 'F#6', 'A6', 'B6', 'D7', 'E7']
        n_ = c.get('n', 12)
        for i in range(n_):
            x = pluck(midi(scale[i % len(scale)]), 0.5, 1.2)
            sfx.add(x, t + i * c.get('step', 0.04), 0.22, -0.7 + 1.4 * i / max(1, n_ - 1))
            sfx_rev.add(x, t + i * c.get('step', 0.04), 0.06)
    else:
        raise SystemExit(f'unknown cue kind {kind}')


for c in sorted(CUES, key=lambda c: c['t']):
    place(c['kind'], c)

# riser into the gap (sound design, not a cue)
n = sec(GAP0 - B_BUILD)
u = np.linspace(0, 1, n)
riser = svf(noise(n), 400 + 7600 * u ** 2, 1.4, 'bp') * u ** 2.2
riser += 0.25 * np.sin(2 * np.pi * np.cumsum(220 + 660 * u ** 2) / SR) * u ** 2
sfx.add(ramp_edges(riser / np.max(np.abs(riser)), 0.01, 0.006), B_BUILD, 0.2)

fx = sfx.x + 0.4 * filt(reverb(sfx_rev.x, rt60=1.1, dur=1.6, pre=0.01), 'highpass', 250, 2)
mix = music + fx * gate
mix = filt(mix, 'highpass', 18, 1)
if '--stems' in sys.argv:
    print(f'sfx    {kw(fx):6.1f}')

    def mom(x, t):  # momentary loudness, 400 ms window centred just after t
        b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
        seg = x[:, max(0, sec(t - 0.05)):sec(t + 0.35)]
        y = signal.lfilter([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621], signal.lfilter(b1, a1, seg, axis=1), axis=1)
        return -0.691 + 10 * np.log10(np.sum(np.mean(y ** 2, axis=1)) + 1e-12)
    seen = set()
    for c in sorted(CUES, key=lambda c: c['t']):
        if c['kind'] in seen and c['kind'] == 'type':
            continue
        seen.add(c['kind'])
        print(f"{c['t']:6.2f} {c['kind']:8s} sfx {mom(fx, c['t']):6.1f}  music {mom(music, c['t']):6.1f}")

# fade out the tail, keep the very first sample clean
mix *= 1 - smoothstep(DUR - 1.6, DUR - 0.02, tn)
mix[:, :sec(0.004)] *= np.linspace(0, 1, sec(0.004))


# ---------------------------------------------------------------- loudness: BS.1770 integrated, true-peak limiter
def lufs(x):
    b1, a1 = [1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585]
    b2, a2 = [1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621]
    y = signal.lfilter(b2, a2, signal.lfilter(b1, a1, x, axis=1), axis=1)
    blk, hop = sec(0.4), sec(0.1)
    ms = np.array([np.sum(np.mean(y[:, i:i + blk] ** 2, axis=1)) for i in range(0, y.shape[1] - blk, hop)])
    lk = -0.691 + 10 * np.log10(ms + 1e-12)
    ms = ms[lk > -70]
    rel = -0.691 + 10 * np.log10(np.mean(ms)) - 10
    ms = ms[(-0.691 + 10 * np.log10(ms)) > rel]
    return -0.691 + 10 * np.log10(np.mean(ms))


def true_peak(x):
    return np.max(np.abs(signal.resample_poly(x, 4, 1, axis=1)))


def limit(x, ceil_db=-1.6, look=0.004, rel=0.09):
    ceil = 10 ** (ceil_db / 20)
    os4 = np.abs(signal.resample_poly(x, 4, 1, axis=1)).max(axis=0)
    pk = os4[:x.shape[1] * 4].reshape(-1, 4).max(axis=1)
    need = np.minimum(1.0, ceil / np.maximum(pk, 1e-9))
    L = sec(look)
    g = uniform_filter1d(minimum_filter1d(need, size=2 * L + 1), size=L)
    a = np.exp(-1 / (rel * SR))
    out = np.empty_like(g)
    cur = 1.0
    for i in range(len(g)):
        gi = g[i]
        cur = gi if gi < cur else gi + (cur - gi) * a
        out[i] = cur
    return x * out


target = -14.0
gain = 10 ** ((target - lufs(mix)) / 20)
for _ in range(4):
    y = limit(mix * gain)
    err = target - lufs(y)
    if abs(err) < 0.05:
        break
    gain *= 10 ** (err / 20)
print(f'integrated {lufs(y):.2f} LUFS, true peak {20 * np.log10(true_peak(y)):.2f} dBTP, gain {20 * np.log10(gain):.1f} dB')
wavfile.write(OUT, SR, y.T.astype(np.float32))
