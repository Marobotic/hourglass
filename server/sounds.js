// Ringtone audio: any file ffmpeg reads becomes a loud 30 s mono WAV taken
// from the loudest part of the track (usually the chorus). WAV because iOS
// alarms only play WAV/AIFF/CAF of at most 30 s; every other platform plays
// it too.
import { spawn } from "node:child_process";

const CLIP_S = 30;
const RATE = 8000; // analysis sample rate

function run(args, { collect = false } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-nostdin", "-v", "error", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    let err = "";
    p.stdout.on("data", (c) => collect && out.push(c));
    p.stderr.on("data", (c) => (err += c));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(err.trim().split("\n").pop() || `ffmpeg exited ${code}`))));
  });
}

// Per-second loudness of the first 15 minutes, then the 30 s window with the
// most energy.
async function loudestStart(input) {
  const pcm = await run(["-t", "900", "-i", input, "-vn", "-ac", "1", "-ar", String(RATE), "-f", "s16le", "-"], { collect: true });
  const secs = Math.floor(pcm.length / 2 / RATE);
  if (secs < 1) throw new Error("that file has no audio");
  const energy = [];
  for (let s = 0; s < secs; s++) {
    let sum = 0;
    for (let i = s * RATE; i < (s + 1) * RATE; i++) {
      const v = pcm.readInt16LE(i * 2);
      sum += v * v;
    }
    energy.push(sum / RATE);
  }
  if (secs <= CLIP_S) return { start: 0, total: secs };
  let win = energy.slice(0, CLIP_S).reduce((a, b) => a + b, 0);
  let best = win;
  let start = 0;
  for (let s = 1; s + CLIP_S <= secs; s++) {
    win += energy[s + CLIP_S - 1] - energy[s - 1];
    if (win > best) [best, start] = [win, s];
  }
  return { start, total: secs };
}

export async function makeClip(input, output) {
  const { start, total } = await loudestStart(input);
  const len = Math.min(CLIP_S, total - start);
  const fadeOut = Math.max(0, len - 1.5);
  await run([
    "-y", "-ss", String(start), "-t", String(len), "-i", input, "-vn",
    "-af", `loudnorm=I=-10:TP=-1:LRA=11,afade=t=in:d=0.3,afade=t=out:st=${fadeOut}:d=1.5`,
    "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", output,
  ]);
  return { duration_s: Math.round(len), start_s: start };
}
