// Hourglass round 5: writes the key screens (phone 390x844, PC 2560x1440), the comparison sheets and manifest.json.
// node build.mjs   then   nice -n 19 node render.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from './screens.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const SCREENS = ['now', 'schedule', 'attendance', 'notes', 'note', 'alarms', 'assistant'];
const page = (title, body, extra = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="../style.css">${extra}</head><body>${body}</body></html>`;

await mkdir(path.join(root, 'screens'), { recursive: true });
await mkdir(path.join(root, 'compare'), { recursive: true });
const manifest = [];
for (const s of SCREENS) {
  await writeFile(path.join(root, 'screens', `${s}-phone.html`), page(`${s} · phone`, S[s].phone()));
  await writeFile(path.join(root, 'screens', `${s}-pc.html`), page(`${s} · PC`, S[s].pc()));
  manifest.push({ file: `screens/${s}-phone`, out: `png/${s}-phone.png`, w: 390, h: 844, dsf: 2 });
  manifest.push({ file: `screens/${s}-pc`, out: `png/${s}-pc.png`, w: 2048, h: 1152, dsf: 1.25 });
}
for (const m of S.MOTIONS) manifest.push({ file: 'motion', query: `?strip=${m.id}`, out: `png/motion-${m.id}.png`, w: 1840, h: 560, dsf: 1, strip: m.id });
for (const s of SCREENS) {
  await writeFile(path.join(root, 'compare', `${s}.html`), S.compare(s));
  manifest.push({ file: `compare/${s}`, out: `png/compare-${s}.png`, w: 2040, h: 1960, dsf: 1 });
}
await writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(`${manifest.length} renders in manifest.json`);
