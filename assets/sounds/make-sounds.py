#!/usr/bin/env python3
# Generates the alarm ringtones (loud, mono 22.05 kHz WAV, ~8 s, loopable).
# Synthesised here, so there are no licensing questions. Run to regenerate.
import math, random, struct, wave
from pathlib import Path

RATE = 22050
OUT = Path(__file__).parent

def write(name, samples):
    peak = max(1e-9, max(abs(x) for x in samples))
    with wave.open(str(OUT / f"{name}.wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, x / peak * 0.95)) * 32767)) for x in samples))

def tone(freq, dur, shape="square", vol=1.0):
    n = int(dur * RATE); out = []
    for i in range(n):
        ph = (i * freq / RATE) % 1.0
        v = (1 if ph < 0.5 else -1) if shape == "square" else (2 * ph - 1) if shape == "saw" else math.sin(2 * math.pi * ph)
        env = min(1, i / (0.004 * RATE), (n - i) / (0.004 * RATE))  # 4 ms fades, no clicks
        out.append(v * vol * env)
    return out

def silence(dur): return [0.0] * int(dur * RATE)

def loop(pattern, total=8.0):
    out = []
    while len(out) < total * RATE: out += pattern
    return out[: int(total * RATE)]

write("classic", loop(tone(880, 0.12) + silence(0.08) + tone(880, 0.12) + silence(0.5)))
write("klaxon", loop(tone(620, 0.35, "saw") + tone(780, 0.35, "saw")))
ph = 0.0; siren = []
for i in range(int(8 * RATE)):
    f = 600 + 900 * (0.5 - 0.5 * math.cos(2 * math.pi * i / (1.2 * RATE)))
    ph += f / RATE
    siren.append(1 if (ph % 1) < 0.5 else -1)
write("siren", siren)
write("digital", loop(sum([tone(2000, 0.06) + silence(0.05) for _ in range(4)], []) + silence(0.6)))
rising = []
for k in range(6):
    rising += tone(500 + k * 150, 0.18) + silence(0.07)
write("rising", loop(rising + silence(0.3)))
bell = []
for _ in range(4):
    n = int(1.9 * RATE)
    bell += [sum(math.sin(2 * math.pi * f * i / RATE) * a for f, a in ((660, 1), (1320, .5), (1980, .3), (2640, .2))) * math.exp(-2.2 * i / RATE) for i in range(n)]
write("bell", loop(bell))
write("silent", silence(1.0))
print("ok")
