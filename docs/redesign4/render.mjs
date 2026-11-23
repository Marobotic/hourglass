// Renders manifest.json to PNG with one headless Chrome (throwaway profile under /tmp) and writes render-audit.json.
// nice -n 19 node render.mjs [filter...]
import { spawn } from 'node:child_process';
import { readFile, writeFile, rm, mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const profile = await mkdtemp(path.join(os.tmpdir(), 'hg-r4-'));
const port = 9300 + Math.floor(Math.random() * 400);
const chrome = spawn('google-chrome-stable', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--disable-extensions', '--disable-background-networking', '--disable-sync', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let socket, id = 0;
const pending = new Map();
const cdp = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); socket.send(JSON.stringify({ id: n, method, params })); });
async function evaluate(expression) { const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; }

// Text that runs past its box without a deliberate ellipsis, anything wider than the window, and leftover empty-state copy.
const CHECK = `(() => {
  const vw = innerWidth; // getBoundingClientRect is in window pixels even under html { zoom }
  const bad = [];
  for (const e of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || e.closest('svg')) continue;
    const r = e.getBoundingClientRect();
    if (!r.width) continue;
    const clipped = e.scrollWidth > e.clientWidth + 1 && cs.overflow !== 'visible' && cs.textOverflow !== 'ellipsis' && !e.matches('.page,.masonry-wrap,.note-scroll,.msgs,.week,.notes-wrap,.drive-split,.folders,.folder-strip,.note-bar,.dayaside-wrap,.month,.cell,.blk,.hero,.card,.side,.frame,.app,.main,.chat,.sheet,.layer,.dayview,.city-grid,.nc .p,.ver-split,.pv,.quick');
    const outside = r.right > vw + 1 && !e.closest('.folder-strip,.note-bar,.quick,.hacts');
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    const wrapped = own && cs.whiteSpace === 'nowrap' && e.scrollWidth > e.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && cs.overflow === 'visible' && !e.closest('.folder-strip,.note-bar');
    if (clipped || outside || wrapped) bad.push({ el: e.tagName.toLowerCase() + '.' + [...e.classList].join('.'), text: e.textContent.trim().slice(0, 40), why: clipped ? 'clipped' : outside ? 'outside' : 'spills' });
  }
  const text = document.body.innerText;
  return {
    fonts: document.fonts.check('14px Mono') && document.fonts.check('700 14px Mono') && document.fonts.check('14px Noto'),
    scroll: document.documentElement.scrollWidth > innerWidth + 1 || document.documentElement.scrollHeight > innerHeight + 1,
    empty: /no (notes|alarms|courses|contacts|files)|nothing (here|yet)|yet\\./i.test(text),
    bad: bad.slice(0, 12),
  };
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
  const list = want.length ? manifest.filter((x) => want.some((w) => x.out.includes(w) || x.file.includes(w))) : manifest;
  const audit = [];
  for (const x of list) {
    await cdp('Emulation.setDeviceMetricsOverride', { width: x.w, height: x.h, deviceScaleFactor: 1, mobile: false });
    const url = pathToFileURL(path.join(root, `${x.file}.html`)).href;
    await cdp('Page.navigate', { url });
    // Page.navigate returns before the new document commits; wait for it so the checks never run on the previous page.
    for (let n = 0; n < 200; n++) { if (await evaluate(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`)) break; await delay(25); }
    await evaluate("Promise.all([document.fonts.load('14px Mono'), document.fonts.load('700 14px Mono'), document.fonts.load('14px Noto'), document.fonts.load('700 14px Noto')]).then(() => document.fonts.ready)");
    await delay(60);
    if (x.sheet) {
      await evaluate('Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })))');
      const hgt = await evaluate('document.documentElement.scrollHeight');
      await cdp('Emulation.setDeviceMetricsOverride', { width: x.w, height: hgt, deviceScaleFactor: 0.5, mobile: false });
      await delay(100);
      const pic = await cdp('Page.captureScreenshot', { format: 'png' });
      await writeFile(path.join(root, x.out), Buffer.from(pic.data, 'base64'));
      continue;
    }
    const checks = await evaluate(CHECK);
    const pic = await cdp('Page.captureScreenshot', { format: 'png' });
    await mkdir(path.dirname(path.join(root, x.out)), { recursive: true });
    await writeFile(path.join(root, x.out), Buffer.from(pic.data, 'base64'));
    audit.push({ out: x.out, ...checks });
  }
  const prev = want.length ? JSON.parse(await readFile(path.join(root, 'render-audit.json'), 'utf8').catch(() => '[]')).filter((a) => !audit.some((b) => b.out === a.out)) : [];
  const all = [...prev, ...audit].sort((a, b) => a.out.localeCompare(b.out));
  await writeFile(path.join(root, 'render-audit.json'), JSON.stringify(all, null, 1));
  const fails = audit.filter((a) => !a.fonts || a.scroll || a.empty || a.bad.length);
  console.log(`${audit.length} rendered, ${fails.length} with findings`);
  for (const f of fails) console.log(f.out, JSON.stringify({ fonts: f.fonts, scroll: f.scroll, empty: f.empty, bad: f.bad }));
} finally {
  try { await cdp('Browser.close'); } catch {}
  socket?.close();
  await delay(300);
  chrome.kill('SIGKILL');
  await rm(profile, { recursive: true, force: true });
}
