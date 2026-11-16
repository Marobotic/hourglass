// Dev harness: runs the real Windows service on its own port with a throwaway data folder and the demo week,
// and serves the built window (dist/) so it can be opened or screenshotted in a plain browser.
//   node ui/dev/serve.mjs            -> prints the URL to open
//   node ui/dev/serve.mjs --shot out.png --page now --size 1440x900 [--query "x=1"]
// Never touches the real Hourglass data.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ROOT = resolve(import.meta.dirname, '../../..');
const DIST = resolve(import.meta.dirname, '../../dist');
const PORT = Number(opt('--port', 8941));
const WEB = Number(opt('--web', 5179));
const dir = opt('--data') || mkdtempSync(join(tmpdir(), 'hg-dev-'));
const fresh = !opt('--data');

const env = { ...process.env, HOURGLASS_PORT: String(PORT), HOURGLASS_DATA: join(dir, 'data'), HOURGLASS_CONFIG: join(dir, 'config'), HOURGLASS_UPDATE_FEED: 'off', HOURGLASS_TEST_WINDOW: '1' };
const svc = spawn(process.execPath, [join(ROOT, 'windows/sidecar/hourglassd.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
svc.stdout.on('data', (d) => process.env.DEBUG && process.stdout.write(d));
svc.stderr.on('data', (d) => process.stderr.write(d));
const stop = () => { try { svc.kill(); } catch {} if (fresh && !args.includes('--keep')) try { rmSync(dir, { recursive: true, force: true }); } catch {} };
process.on('exit', stop);
process.on('SIGINT', () => process.exit(0));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let token = '';
for (let i = 0; i < 100; i++) {
  await wait(150);
  const f = join(dir, 'config', 'token');
  if (existsSync(f)) token = readFileSync(f, 'utf8').trim();
  if (!token) continue;
  try { if ((await fetch(`http://127.0.0.1:${PORT}/api/app`, { headers: { authorization: `Bearer ${token}` } })).ok) break; } catch {}
}
if (!token) { console.error('the service did not start'); process.exit(1); }
if (fresh) {
  const seed = spawn(process.execPath, [join(ROOT, 'windows/tools/demo-seed.mjs'), `http://127.0.0.1:${PORT}`, token], { stdio: 'inherit' });
  await new Promise((r) => seed.on('exit', r));
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = join(DIST, p === '/' ? 'index.html' : p);
  if (!f.startsWith(DIST) || !existsSync(f) || statSync(f).isDirectory()) f = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
}).listen(WEB, '127.0.0.1');

const url = (page, extra = '') => `http://127.0.0.1:${WEB}/?port=${PORT}&token=${token}&nologin&page=${page}${extra ? '&' + extra : ''}`;
const shot = opt('--shot');
if (!shot) {
  console.log(`service on ${PORT} (data ${dir})\nopen ${url(opt('--page', 'now'))}`);
} else {
  // Headless Edge (or Chrome) renders the page after the data has loaded.
  const browsers = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'];
  const exe = browsers.find((b) => existsSync(b));
  const pages = opt('--page', 'now').split(',');
  for (const page of pages) {
    const out = pages.length > 1 ? shot.replace(/\.png$/, `-${page}.png`) : shot;
    const [w, ht] = opt('--size', '1440x900').split('x');
    const prof = mkdtempSync(join(tmpdir(), 'hg-shot-'));
    const b = spawn(exe, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--user-data-dir=${prof}`, `--window-size=${w},${ht}`, '--virtual-time-budget=6000', `--screenshot=${resolve(out)}`, url(page, opt('--query', ''))], { stdio: 'ignore' });
    await new Promise((r) => b.on('exit', r));
    try { rmSync(prof, { recursive: true, force: true }); } catch {}
    console.log('wrote', out);
  }
  process.exit(0);
}
