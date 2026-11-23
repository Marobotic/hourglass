// Renders manifest.json to PNG with ONE headless Chrome (throwaway /tmp profile, deleted after) and audits each page.
// nice -n 19 node render.mjs [filter...]
import { spawn } from 'node:child_process';
import { readFile, writeFile, rm, mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const profile = await mkdtemp(path.join(os.tmpdir(), 'hg-r5-'));
const port = 9300 + Math.floor(Math.random() * 400);
const chrome = spawn('nice', ['-n', '19', 'google-chrome-stable', '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--disable-extensions', '--disable-background-networking', '--disable-sync', '--allow-file-access-from-files', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', detached: true });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let socket, id = 0;
const pending = new Map();
const cdp = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); socket.send(JSON.stringify({ id: n, method, params })); });
async function evaluate(expression) { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }

// Text cut off without a deliberate ellipsis or clamp, text that spills past its box, and anything wider than the window.
const CHECK = `(() => {
  const bad = [];
  for (const e of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || e.closest('svg')) continue;
    const r = e.getBoundingClientRect();
    if (!r.width) continue;
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own || e.closest('.hscroll')) continue;
    const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== 'none';
    const cut = e.scrollWidth > e.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && !clamp;
    const outside = r.right > innerWidth + 1;
    if (cut || outside) bad.push({ el: e.tagName.toLowerCase() + '.' + [...e.classList].join('.'), text: e.textContent.trim().slice(0, 40), why: cut ? 'cut' : 'outside' });
  }
  const ell = [...document.querySelectorAll('.ell')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim().slice(0, 40));
  return { fonts: document.fonts.check('14px Mono') && document.fonts.check('800 14px Mono') && document.fonts.check('14px Noto'), bad: bad.slice(0, 12), ellipsed: ell.slice(0, 12) };
})()`;

try {
  let target;
  for (let n = 0; n < 100 && !target; n++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {} if (!target) await delay(100); }
  if (!target) throw Error('Chrome did not start');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { socket.onopen = r; socket.onerror = j; });
  socket.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result); } };
  await cdp('Page.enable');
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  const want = process.argv.slice(2);
  const list = want.length ? manifest.filter((x) => want.some((w) => x.out.includes(w))) : manifest;
  const audit = [];
  for (const x of list) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: x.w, height: x.h, deviceScaleFactor: x.dsf, mobile: false });
    const url = pathToFileURL(path.join(root, `${x.file}.html`)).href + (x.query || '');
    await cdp('Page.navigate', { url });
    for (let n = 0; n < 200; n++) { if (await evaluate(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`)) break; await delay(25); }
    await evaluate("Promise.all([document.fonts.load('14px Mono'), document.fonts.load('800 14px Mono'), document.fonts.load('500 14px Mono'), document.fonts.load('700 14px Mono'), document.fonts.load('14px Noto'), document.fonts.load('700 14px Noto')]).then(() => document.fonts.ready)");
    await evaluate('Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })))');
    // Freeze every running animation at a fixed, flattering moment so stills are repeatable; strips set their own frames.
    await evaluate(x.strip ? 'window.__strip && window.__strip()' : 'document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 400; })');
    await delay(80);
    const checks = x.strip || x.file.startsWith('compare') ? null : await evaluate(CHECK);
    const pic = await cdp('Page.captureScreenshot', { format: 'png' });
    await mkdir(path.dirname(path.join(root, x.out)), { recursive: true });
    await writeFile(path.join(root, x.out), Buffer.from(pic.data, 'base64'));
    if (checks) audit.push({ out: x.out, ...checks });
  }
  await writeFile(path.join(root, 'render-audit.json'), JSON.stringify(audit, null, 1));
  const fails = audit.filter((a) => !a.fonts || a.bad.length);
  console.log(`${list.length} rendered, ${fails.length} with findings`);
  for (const f of fails) console.log(f.out, JSON.stringify({ fonts: f.fonts, bad: f.bad }));
  for (const a of audit) if (a.ellipsed.length) console.log('ellipsis', a.out, JSON.stringify(a.ellipsed));
} finally {
  try { await cdp('Browser.close'); } catch {}
  socket?.close();
  await delay(300);
  try { process.kill(-chrome.pid, 'SIGKILL'); } catch {}
  await rm(profile, { recursive: true, force: true });
}
