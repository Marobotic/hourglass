// Dev harness: runs the real service on its own port with a throwaway data folder and the demo week, and serves the
// window so it can be opened or screenshotted in a plain browser. Never touches the real Hourglass data: the data,
// config, courses folder and HOME all live in a temp folder, the keyring is never read and sync points nowhere.
//   node ui/dev/serve.mjs                         -> prints the URL to open
//   node ui/dev/serve.mjs --shot out.png --page now --size 1440x900 [--dsf 1.25] [--query "x=1"] [--eval "js"] [--now 07:22]
//   node ui/dev/serve.mjs --batch shots.json      -> [{ out, page, size, dsf?, query?, eval?, wait?, now? }, ...]
// --now HH:MM fakes the page's clock to that time today (local), still ticking; the service keeps the real time.
// It serves dist/ when it has been built (node build.mjs), else ui/ itself (plain ES modules; --src forces that).
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, extname, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ROOT = resolve(import.meta.dirname, '../../..');
const DIST = resolve(import.meta.dirname, '../../dist');
const SRC = resolve(import.meta.dirname, '..');
const WEBROOT = !args.includes('--src') && existsSync(join(DIST, 'app.js')) ? DIST : SRC;
const VERSION = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../package.json'), 'utf8')).version;
const PORT = Number(opt('--port', 8941));
const WEB = Number(opt('--web', 5179));
const dir = resolve(opt('--data') || mkdtempSync(join(tmpdir(), 'hg-dev-')));
const fresh = !opt('--data');

// The real data lives in ~/.local/share/hourglass, ~/.config/hourglass (Windows: %LOCALAPPDATA%, %APPDATA%).
const real = [join(homedir(), '.local/share/hourglass'), join(homedir(), '.config/hourglass'), process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Hourglass'), process.env.APPDATA && join(process.env.APPDATA, 'Hourglass')].filter(Boolean);
if (real.some((r) => dir === r || dir.startsWith(r + sep))) { console.error(`refusing to run on the real Hourglass data (${dir})`); process.exit(1); }

const home = join(dir, 'home');
mkdirSync(home, { recursive: true });
const env = {
  ...process.env, HOME: home, USERPROFILE: home,
  HOURGLASS_PORT: String(PORT), HOURGLASS_DATA: join(dir, 'data'), HOURGLASS_CONFIG: join(dir, 'config'), HOURGLASS_COURSES_DIR: join(dir, 'courses'),
  HOURGLASS_SILENT: '1', HOURGLASS_UPDATE_FEED: 'off', HOURGLASS_TEST_WINDOW: '1',
  // No keyring (the signed-in session lives there) and no sync server: this copy stays on this computer.
  HOURGLASS_TEST_KEYRING_DELAY_MS: '1', HOURGLASS_SERVER: 'http://127.0.0.1:9', HOURGLASS_PROVISION: '',
};
delete env.DBUS_SESSION_BUS_ADDRESS;
const svc = spawn(process.execPath, [join(ROOT, 'windows/sidecar/hourglassd.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
svc.stdout.on('data', (d) => process.env.DEBUG && process.stdout.write(d));
svc.stderr.on('data', (d) => process.stderr.write(d));
const stop = () => { try { svc.kill(); } catch {} if (fresh && !args.includes('--keep')) try { rmSync(dir, { recursive: true, force: true }); } catch {} };
process.on('exit', stop);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

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

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = join(WEBROOT, p === '/' ? 'index.html' : p);
  if (!f.startsWith(WEBROOT) || !existsSync(f) || statSync(f).isDirectory()) f = join(WEBROOT, 'index.html');
  let body = readFileSync(f);
  // Unbundled, the version esbuild would define comes from package.json.
  if (WEBROOT === SRC && f.endsWith('index.html')) body = String(body).replace('<head>', `<head><script>globalThis.HOURGLASS_VERSION = ${JSON.stringify(VERSION)};</script>`);
  res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(body);
}).listen(WEB, '127.0.0.1');

const url = (page, extra = '') => `http://127.0.0.1:${WEB}/?port=${PORT}&token=${token}&nologin&page=${page}${extra ? '&' + extra : ''}`;

// Headless Chrome (or Edge) over the DevTools protocol: exact viewport and scale, then optional script, then a PNG.
async function browser() {
  const exes = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  const exe = exes.find((b) => existsSync(b));
  const prof = mkdtempSync(join(tmpdir(), 'hg-shot-'));
  const b = spawn(exe, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--disable-extensions', `--user-data-dir=${prof}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' });
  let port = 0;
  for (let i = 0; i < 100 && !port; i++) { await wait(100); try { port = Number(readFileSync(join(prof, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch {} }
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  return {
    send,
    close() { try { ws.close(); } catch {} try { b.kill('SIGKILL'); } catch {} setTimeout(() => { try { rmSync(prof, { recursive: true, force: true }); } catch {} }, 300); },
  };
}

async function shoot(br, s) {
  const [w, ht] = String(s.size || '1440x900').split('x').map(Number);
  await br.send('Emulation.setDeviceMetricsOverride', { width: Math.round(w / (s.dsf || 1)), height: Math.round(ht / (s.dsf || 1)), deviceScaleFactor: s.dsf || 1, mobile: false });
  await br.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: s.reduce ? 'reduce' : 'no-preference' }] });
  await br.send('Page.bringToFront');
  await br.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await br.send('Page.enable');
  if (br.fake) { await br.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: br.fake }); br.fake = null; }
  if (s.now) {
    const [hh, mm] = String(s.now).split(':').map(Number);
    const at = new Date(); at.setHours(hh, mm || 0, 0, 0);
    const r = await br.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const off = ${at.getTime()} - Date.now(), R = Date, now = () => R.now() + off;
      globalThis.Date = class extends R { constructor(...a) { super(...(a.length ? a : [now()])); } static now() { return now(); } };
    })();` });
    br.fake = r.result?.identifier;
  }
  await br.send('Page.navigate', { url: url(s.page || 'now', s.query || '') });
  await wait(s.wait || 2600);
  if (s.eval) {
    const r = await br.send('Runtime.evaluate', { expression: `(async () => { ${s.eval} })()`, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) console.error('eval failed:', r.result.exceptionDetails.exception?.description);
    else if (r.result?.result?.value !== undefined) console.log('eval:', JSON.stringify(r.result.result.value));
    await wait(s.after || 900);
  }
  const png = await br.send('Page.captureScreenshot', { format: 'png' });
  const { writeFileSync } = await import('node:fs');
  writeFileSync(resolve(s.out), Buffer.from(png.result.data, 'base64'));
  console.log('wrote', s.out);
}

const shot = opt('--shot'), batch = opt('--batch');
if (!shot && !batch) {
  console.log(`service on ${PORT} (data ${dir})\nopen ${url(opt('--page', 'now'))}`);
} else {
  const list = batch ? JSON.parse(readFileSync(batch, 'utf8'))
    : opt('--page', 'now').split(',').map((page, _, all) => ({ out: all.length > 1 ? shot.replace(/\.png$/, `-${page}.png`) : shot, page, size: opt('--size', '1440x900'), dsf: Number(opt('--dsf', 1)), query: opt('--query', ''), eval: opt('--eval'), now: opt('--now') }));
  const br = await browser();
  try { for (const s of list) await shoot(br, s); } finally { br.close(); }
  await wait(400);
  process.exit(0);
}
