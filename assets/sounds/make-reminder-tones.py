#!/usr/bin/env python3
# Generates the reminder tones: short (under 2 s), soft, played once. Nothing
# like the alarms on purpose. Writes remind_<name>.wav here; copy them to
# android/app/src/main/res/raw (same names) after changing them.
import math, struct, wave
from pathlib import Path

RATE = 22050
OUT = Path(__file__).parent

def write(name, samples):
    peak = max(1e-9, max(abs(x) for x in samples))
    with wave.open(str(OUT / f"remind_{name}.wav"), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, x / peak * 0.8)) * 32767)) for x in samples))

def note(freq, dur, decay, partials=((1, 1.0), (2, 0.35), (3, 0.12)), attack=0.006):
    n = int(dur * RATE)
    return [sum(math.sin(2 * math.pi * freq * k * i / RATE) * a for k, a in partials) * min(1, i / (attack * RATE)) * math.exp(-decay * i / RATE) for i in range(n)]

def mix(parts, total):
    out = [0.0] * int(total * RATE)
    for start, samples in parts:
        s = int(start * RATE)
        for i, v in enumerate(samples):
            if s + i < len(out): out[s + i] += v
    return out

# Chime: two notes up, like a doorbell's "ding-dong" reversed.
write("chime", mix([(0, note(784, 1.2, 3.5)), (0.18, note(1175, 1.4, 3.0))], 1.6))
# Ding: one bright bell.
write("ding", mix([(0, note(1320, 1.3, 3.2, ((1, 1.0), (2.76, 0.4), (5.4, 0.15))))], 1.4))
# Pop: two quick soft plucks.
write("pop", mix([(0, note(660, 0.25, 18, ((1, 1.0), (2, 0.2)))), (0.14, note(990, 0.3, 16, ((1, 1.0), (2, 0.2))))], 0.5))
# Harp: a quick rising arpeggio.
write("harp", mix([(i * 0.09, note(f, 1.2, 4.0, ((1, 1.0), (2, 0.25), (4, 0.06)))) for i, f in enumerate((523, 659, 784, 1047))], 1.6))
print("ok")
