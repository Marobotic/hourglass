// Run on marolaptop, against an isolated Hourglass WebView2 launched with
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9347.
// node tools/notes-editor-webview.mjs [port] [--keep]
// Uses the real editor module and stylesheet in the real Windows editing engine.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { inflateSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const port = Number(process.argv[2]) || 9347;
const pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = pages.find(p => p.type === 'page' && p.url.includes('tauri.localhost'));
assert.ok(target, 'Run this in the Hourglass WebView2, not a browser tab');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let next = 0;
const pending = new Map();
ws.onmessage = e => {
  const msg = JSON.parse(e.data);
  if (!msg.id) return;
  const p = pending.get(msg.id); pending.delete(msg.id);
  msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params }));
});
async function js(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function key(key, modifiers = 0) {
  const code = { Enter: 13, Backspace: 8, Delete: 46, Tab: 9, ArrowLeft: 37, ArrowRight: 39 }[key] || key.toUpperCase().charCodeAt(0);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, windowsVirtualKeyCode: code, modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, windowsVirtualKeyCode: code, modifiers });
}
const type = text => send('Input.insertText', { text });
const md = () => js('ed.markdown()');
async function waitFor(expression, expected, timeout = 5000) {
  const until = Date.now() + timeout;
  let value;
  do { value = await js(expression); if (value === expected) return; await new Promise(r => setTimeout(r,30)); } while (Date.now() < until);
  assert.equal(value, expected, expression);
}
const select = (line, offset, endLine = line, endOffset = offset) => js(`pick(${line},${offset},${endLine},${endOffset})`);
const fixture = text => js(`ed.load(${JSON.stringify(text)}); ed.focus(false); changes = 0; document.querySelector('.note-page').scrollTop=0`);
const paste = (text, html = '') => js(`(() => { const d=new DataTransfer(); d.setData('text/plain',${JSON.stringify(text)}); d.setData('text/html',${JSON.stringify(html)}); ed.el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:d,bubbles:true,cancelable:true})); })()`);
const moduleCache = new Map();
function moduleUrl(path) {
  path = resolve(path);
  if (moduleCache.has(path)) return moduleCache.get(path);
  const source = readFileSync(path, 'utf8').replace(/(from\s*|import\s*)['"](\.[^'"]+)['"]/g, (_, pre, dep) => `${pre}'${moduleUrl(resolve(dirname(path), dep))}'`);
  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  moduleCache.set(path, url); return url;
}
// Screen pixels: the 8-bit RGB/RGBA, non-interlaced PNGs Chromium captures, decoded to RGBA.
function decodePng(buf) {
  let at = 8, w = 0, ht = 0, type = 0;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at), kind = buf.toString('ascii', at + 4, at + 8), data = buf.subarray(at + 8, at + 8 + len);
    if (kind === 'IHDR') { w = data.readUInt32BE(0); ht = data.readUInt32BE(4); type = data[9]; assert.equal(data[8], 8); assert.equal(data[12], 0); }
    if (kind === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3, stride = w * bpp, raw = inflateSync(Buffer.concat(idat)), px = Buffer.alloc(w * ht * bpp);
  for (let y = 0; y < ht; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0, b = y ? px[(y - 1) * stride + x] : 0, c = x >= bpp && y ? px[(y - 1) * stride + x - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      px[y * stride + x] = (line[x] + [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f]) & 255;
    }
  }
  const rgba = Buffer.alloc(w * ht * 4, 255);
  for (let i = 0; i < w * ht; i++) px.copy(rgba, i * 4, i * bpp, i * bpp + 3);
  return { w, h: ht, px: rgba };
}
async function shot(clip) {
  const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 }, captureBeyondViewport: false });
  return decodePng(Buffer.from(r.data, 'base64'));
}
const rgb = css => css.match(/[\d.]+/g).slice(0, 3).map(v => css.startsWith('color(') ? Math.round(v * 255) : Number(v)); // rgb() or color(srgb 0..1)
const near = (p, c, tol) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) < tol;
const mix = (a, b, t) => a.map((v, j) => v + (b[j] - v) * t);
// A to-do's box at line i on screen: geometry, the share of its centre in each colour, its ring (the median along
// the middle of its left edge), its corner pixel, and where its white tick sits. Colours come from the theme (read
// once: a probe element changes layout, and Chromium then replays the real cursor as a mousemove) and from the
// empty end of the line.
async function boxPixels(i) {
  const b = await js(`(() => { const l=ed.el.children[${i}], r=l.getBoundingClientRect(), s=getComputedStyle(l,'::before');
    const col = v => (window.themeColours ??= {})[v] ??= (() => { const d=document.createElement('i'); d.style.color=v; ed.el.append(d); const c=getComputedStyle(d).color; d.remove(); return c; })();
    return { x:r.left+parseFloat(s.left), y:r.top+parseFloat(s.top), width:parseFloat(s.width), height:parseFloat(s.height), radius:s.borderTopLeftRadius,
      ring:s.boxShadow, top:parseFloat(s.top), cursor:getComputedStyle(l).cursor, left:parseFloat(s.left), ind:Number(l.dataset.i||0), end:[r.right-3, r.top+parseFloat(s.top)+8],
      accent:col('var(--accent)'), muted:col('var(--muted)'), teal:col('var(--teal)'), orange:col('var(--orange)') }; })()`);
  const img = await shot({ x: b.x, y: b.y, width: b.width, height: b.height });
  const ref = await shot({ x: b.end[0], y: b.end[1], width: 1, height: 1 });
  const k = img.w / b.width, at = (x, y) => [...img.px.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 3)];
  const bg = [...ref.px.subarray(0, 3)], white = [255, 255, 255];
  const colours = { accent: rgb(b.accent), muted: rgb(b.muted), teal: rgb(b.teal), orange: rgb(b.orange) };
  colours.accentHi = mix(colours.accent, white, 0.12); colours.hoverFill = mix(bg, colours.accent, 0.14);
  const share = { accent: 0, accentHi: 0, white: 0, bg: 0, hoverFill: 0, teal: 0, orange: 0 }, inset = Math.ceil(3 * k);
  let total = 0;
  const counts = new Map(), centre = [];
  for (let y = inset; y < img.h - inset; y++) for (let x = inset; x < img.w - inset; x++) {
    const p = at(x, y); total++; centre.push(p);
    if (near(p, colours.accent, 24)) share.accent++;
    else if (near(p, colours.accentHi, 12)) share.accentHi++;
    else if (near(p, white, 40)) share.white++;
    else if (near(p, colours.hoverFill, 8)) share.hoverFill++;
    else if (near(p, bg, 6)) share.bg++;
    if (near(p, colours.teal, 30)) share.teal++;
    if (near(p, colours.orange, 30)) share.orange++;
    const q = p.map(v => v >> 4).join(); counts.set(q, (counts.get(q) || 0) + 1);
  }
  for (const c in share) share[c] /= total;
  // Any look: the box's own fill is the most common colour in its centre; the tick is what clearly differs from it.
  const mode = [...counts].sort((p, q) => q[1] - p[1])[0][0].split(',').map(v => v * 16 + 8);
  const contrast = centre.filter(p => !near(p, mode, 80)).length / centre.length;
  // The tick's ink: the extent of near-white pixels, in css px from the box's top-left.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (near(at(x, y), white, 90)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const tick = x1 < 0 ? null : { cx: (x0 + x1 + 1) / 2 / k, cy: (y0 + y1 + 1) / 2 / k, w: (x1 - x0 + 1) / k, h: (y1 - y0 + 1) / k };
  const edge = []; for (let y = Math.round(5 * k); y < Math.round(11 * k); y++) edge.push(at(Math.floor(0.75 * k), y));
  edge.sort((p, q) => p[0] + p[1] + p[2] - q[0] - q[1] - q[2]);
  return { ...b, share, contrast, tick, corner: at(0, 0), edge: edge[edge.length >> 1], bg, colours };
}
// Hover: the editor's hit test (box plus --hit, 5px) is checked with mousemoves read back at once; the hovered look is then
// pinned by the data-hot hook itself, because Chromium replays the laptop's real cursor as a mousemove after any
// restyle, which would clear a hover made by a CDP mouse move.
const hover = async i => {
  const hit = await js(`(() => { const l=ed.el.children[${i}], r=l.getBoundingClientRect(), s=getComputedStyle(l,'::before');
    const at = (dx, dy) => { l.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: r.left+parseFloat(s.left)+dx, clientY: r.top+parseFloat(s.top)+dy })); return l.hasAttribute('data-hot'); };
    const res = [at(19, 8), at(-2.5, -2.5), at(8, 8), at(20.5, 8), at(22.5, 8), at(8, 22.5)]; // constructed events round clientX/Y to whole px
    ed.el.dispatchEvent(new MouseEvent('mouseleave'));
    l.dataset.hot = '';
    return res; })()`);
  assert.deepEqual(hit, [true, true, true, true, false, false], 'the box answers the pointer over itself plus 5px, not beyond');
  await js(`Promise.all(ed.el.getAnimations({ subtree: true }).map(a => a.finished.catch(() => {})))`);
};
const unhover = async () => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
  await js(`(() => { ed.el.dispatchEvent(new MouseEvent('mouseleave')); ed.el.querySelectorAll('[data-hot]').forEach(l => delete l.dataset.hot); })()`);
};
// The one rule for to-dos: the box, the tick, the strike-through, the dimming and the saved Markdown agree, and
// what is on screen is exactly what reloading the saved Markdown draws.
async function agree(label = '') {
  await unhover();
  const bad = await js(`(async () => {
    while (ed.el.querySelector('.ticking')) await new Promise(r => setTimeout(r, 50));
    await Promise.all(ed.el.getAnimations({ subtree: true }).map(a => a.finished.catch(() => {})));
    const md = ed.markdown().split('\\n').filter(l => /^\\s*- \\[[ x]\\] /.test(l)).map(l => /\\[x\\]/.test(l));
    const lines = [...ed.el.children].filter(l => l.dataset.k === 'todo');
    const plain = getComputedStyle(ed.el).color, out = [];
    // How an open and a done box draw in this look: fresh lines, off screen, no transitions.
    const sig = l => { const b = getComputedStyle(l, '::before'); return b.boxShadow + '|' + b.backgroundColor; };
    const probe = document.createElement('div'); probe.className = 'note-body'; probe.style.cssText = 'position:fixed;left:-9999px;top:0';
    probe.innerHTML = '<div class="ln" data-k="todo">a</div><div class="ln" data-k="todo" data-c="1">a</div>'; document.body.append(probe);
    const ref = [sig(probe.children[0]), sig(probe.children[1])]; probe.remove();
    if (md.length !== lines.length) out.push('to-do count ' + lines.length + ' on screen, ' + md.length + ' saved');
    lines.forEach((l, i) => {
      const c = l.dataset.c === '1', s = getComputedStyle(l), b = getComputedStyle(l, '::before'), a = getComputedStyle(l, '::after');
      const drawn = sig(l);
      if (md[i] !== c) out.push(i + ': saved ' + (md[i] ? '[x]' : '[ ]') + ' but line data-c=' + (l.dataset.c || ''));
      if (drawn !== ref[c ? 1 : 0]) out.push(i + ': box drawn ' + (drawn === ref[1] ? 'done' : drawn === ref[0] ? 'open' : drawn) + ' but data-c=' + (l.dataset.c || ''));
      if ((a.content !== 'none' && /svg/.test(a.backgroundImage + a.maskImage)) !== c) out.push(i + ': tick ' + a.content + ' for data-c=' + (l.dataset.c || ''));
      if (s.textDecorationLine.includes('line-through') !== c) out.push(i + ': strike ' + s.textDecorationLine);
      if ((s.color !== plain) !== c) out.push(i + ': line colour ' + s.color);
      for (const el of l.querySelectorAll('*')) {
        const st = el.getAttribute('style') || '';
        if (/color|text-decoration/.test(st) || el.hasAttribute('color')) out.push(i + ': inline ' + el.outerHTML);
      }
      const w = document.createTreeWalker(l, NodeFilter.SHOW_TEXT);
      for (let t; (t = w.nextNode());) if (getComputedStyle(t.parentElement).color !== s.color) out.push(i + ': text "' + t.nodeValue + '" coloured ' + getComputedStyle(t.parentElement).color);
    });
    return out;
  })()`);
  assert.deepEqual(bad, [], label);
  // Pixels: this editor, then a fresh editor loaded from its Markdown in the same place.
  const clip = await js(`(() => { ed.el.blur(); ed.el.querySelectorAll('[data-hot]').forEach(l => delete l.dataset.hot); const r=ed.el.getBoundingClientRect(); return { x:r.left, y:r.top, width:r.width, height:Math.min(r.height, 300) }; })()`);
  const now = await shot(clip);
  await js(`(() => { window.ed2=createEditor({}); ed2.load(ed.markdown()); ed.el.style.display='none'; ed.el.after(ed2.el); })()`);
  const fresh = await shot(clip);
  await js(`(() => { ed2.el.remove(); ed2.destroy(); ed.el.style.display=''; ed.el.focus({preventScroll:true}); })()`);
  let diff = 0;
  for (let i = 0; i < now.px.length; i += 4) if (Math.abs(now.px[i] - fresh.px[i]) + Math.abs(now.px[i + 1] - fresh.px[i + 1]) + Math.abs(now.px[i + 2] - fresh.px[i + 2]) > 24) diff++;
  assert.equal(diff, 0, `${label}: ${diff} pixels differ from the same note reloaded from its Markdown`);
}
const clickBox = async i => {
  const [x, y] = await js(`(() => { const l=ed.el.children[${i}], r=l.getBoundingClientRect(), s=getComputedStyle(l,'::before'); return [r.left+parseFloat(s.left)+7, r.top+parseFloat(s.top)+7]; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
};
let passes = 0, failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); passes++; }
  catch (e) { console.error(`FAIL ${name}: ${e.stack}`); failures++; }
}
try {
  await send('Page.bringToFront');
  await js(`(async () => {
    if (!window.__TAURI__) throw new Error('Tauri required');
    const { createEditor } = await import(${JSON.stringify(moduleUrl(resolve(root, 'desktop/ui/editor.js')))});
    document.querySelectorAll('link[href*="notes.css"]').forEach(l => l.disabled = true); // only this tree's stylesheet
    const style = document.createElement('style'); style.textContent=${JSON.stringify(readFileSync(resolve(root,'desktop/ui/css/notes.css'),'utf8'))}; document.head.append(style);
    window.changes=0; window.createEditor=createEditor;
    window.ed=createEditor({onChange:()=>changes++,onOpenFile:id=>window.lastOpened=id,fileUrl:id=>'http://127.0.0.1:1/'+id});
    document.querySelector('.note-body').replaceWith(ed.el);
    window.pick=(a,x,b=a,y=x)=>{
      const point=(i,off)=>{const l=ed.el.children[i];const w=document.createTreeWalker(l,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){if(off<=n.length)return[n,off];off-=n.length;}return[l,0];};
      ed.el.focus();getSelection().setBaseAndExtent(...point(a,x),...point(b,y));
    };
  })()`);
  await test('blank lines stay normal blocks; placeholder does not move the caret', async () => {
    await fixture('one\n\ntwo');
    assert.equal(await js("getComputedStyle(ed.el.children[1]).display"), 'block');
    assert.ok(await js('ed.el.children[1].getBoundingClientRect().height < 35'));
    await select(1,0); await type('middle'); assert.equal(await md(),'one\nmiddle\ntwo');
    await key('z',2); assert.equal(await md(),'one\n\ntwo');
    await key('y',2); assert.equal(await md(),'one\nmiddle\ntwo');
    await fixture(''); assert.equal(await js("getComputedStyle(ed.el.firstElementChild,'::after').position"),'absolute');
  });
  await test('Enter and Ctrl+Z/Y restore text, heading, and selection', async () => {
    await fixture('# Grading'); await select(0,4); await key('Enter');
    assert.equal(await md(),'# Grad\n# ing');
    await key('z',2); assert.equal(await md(),'# Grading');
    await key('y',2); assert.equal(await md(),'# Grad\n# ing');
    await type('X'); assert.equal(await md(),'# Grad\n# Xing');
  });
  await test('Enter replaces forward and backward multi-line selections', async () => {
    for (const backward of [false,true]) {
      await fixture('abcd\nefgh\nijkl');
      if(backward) await select(2,2,0,2); else await select(0,2,2,2);
      await key('Enter'); assert.equal(await md(),'ab\nkl');
      await key('z',2); assert.equal(await md(),'abcd\nefgh\nijkl');
    }
  });
  await test('list, indent, to-do tick, Backspace and typing share one undo history', async () => {
    await fixture('task'); await select(0,4);
    await js("ed.setList('todo')"); await key('Tab'); await key('Enter'); await type('next');
    assert.equal(await md(),'  - [ ] task\n  - [ ] next');
    await key('z',2); assert.equal(await md(),'  - [ ] task\n  - [ ] ');
    await key('z',2); assert.equal(await md(),'  - [ ] task');
    await key('z',2); assert.equal(await md(),'- [ ] task');
    await key('z',2); assert.equal(await md(),'task');
    await key('y',2); await select(0,0); await key('Backspace'); assert.equal(await md(),'task');
    await key('z',2); assert.equal(await md(),'- [ ] task');
    await js(`(() => { const r=ed.el.firstChild.getBoundingClientRect();ed.el.firstChild.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:r.left+5,clientY:r.top+10})); })()`);
    assert.equal(await md(),'- [x] task'); await key('z',2); assert.equal(await md(),'- [ ] task');
  });
  await test('a done box shows a visible tick; an open box is empty (any look)', async () => {
    await fixture('- [x] done\n- [ ] open\n  - [x] nested\n- [x] <span style="font-size: 24px">big</span>');
    await unhover();
    for (const i of [0, 2, 3]) {
      const p = await boxPixels(i);
      assert.ok(p.contrast >= 0.10, `line ${i}: only ${(p.contrast * 100).toFixed(1)}% of the box contrasts with its fill: no visible tick`);
      assert.ok(p.contrast <= 0.7, `line ${i}: no box fill around the tick`);
    }
    const open = await boxPixels(1);
    assert.ok(open.share.bg >= 0.98, `open box centre is not empty: ${JSON.stringify(open.share)}`);
  });
  // Pins Maro's chosen look (2026-11-20, notes.css "to-do look" block). Change LOOK with that block, only with his OK.
  const LOOK = { size: 16, radius: '5px', ring: /1.5px inset|inset.*1.5px/, top: Math.round((25.5 - 16) / 2), left: 2 };
  await test("the to-do look is Maro's: red rounded square, centred white tick, muted empty ring when open", async () => {
    await fixture('- [x] done\n- [ ] open\n  - [x] nested\n- [x] <span style="font-size: 24px">big</span>');
    await unhover();
    for (const i of [0, 1, 2, 3]) {
      const p = await boxPixels(i);
      assert.equal(p.width, LOOK.size); assert.equal(p.height, LOOK.size); assert.equal(p.radius, LOOK.radius);
      assert.equal(p.top, LOOK.top, `line ${i}: box top ${p.top}, on whole px, centred on the first row`);
      assert.equal(p.left, p.ind * 24 + LOOK.left, `line ${i}: box at the item's indent`);
      assert.ok(near(p.corner, p.bg, 12), `line ${i}: corner ${p.corner} is not rounded`);
      assert.equal(p.share.teal + p.share.orange, 0, `line ${i}: teal or orange in the box`);
    }
    for (const i of [0, 2, 3]) {
      const p = await boxPixels(i);
      assert.match(p.ring, /8px inset|inset.*8px/, `line ${i}: done ring ${p.ring}`);
      assert.ok(p.share.accent >= 0.45, `line ${i}: red fill ${(p.share.accent * 100).toFixed(1)}%`);
      assert.ok(p.share.white >= 0.12, `line ${i}: white tick ${(p.share.white * 100).toFixed(1)}%`);
      assert.ok(near(p.edge, p.colours.accent, 24), `line ${i}: edge ${p.edge}`);
      assert.ok(p.tick && Math.abs(p.tick.cx - 8) <= 1 && Math.abs(p.tick.cy - 8) <= 1, `line ${i}: tick not centred: ${JSON.stringify(p.tick)}`);
    }
    const open = await boxPixels(1);
    assert.match(open.ring, LOOK.ring);
    assert.ok(near(open.edge, open.colours.muted, 30), `open ring ${open.edge}, want muted ${open.colours.muted}`);
    assert.ok(open.share.bg >= 0.98 && !open.tick, `open centre is not transparent: ${JSON.stringify(open.share)}`);
    await hover(1);
    const hot = await boxPixels(1);
    assert.ok(near(hot.edge, hot.colours.accent, 30), `hovered ring ${hot.edge}`);
    assert.ok(hot.share.hoverFill >= 0.98, `hovered fill is red at 14%: ${JSON.stringify(hot.share)}`);
    assert.equal(hot.cursor, 'pointer');
    await hover(0);
    const hotDone = await boxPixels(0);
    assert.ok(hotDone.share.accentHi >= 0.45 && hotDone.share.white >= 0.12, `hovered done box is lighter red: ${JSON.stringify(hotDone.share)}`);
    await unhover();
    assert.equal(await js('ed.el.querySelector("[data-hot]")'), null);
    await agree('fixture');
  });
  await test('only a user tick draws the tick in; untick, load, undo and redo show the final state at once', async () => {
    await fixture('- [ ] dfsadfsad'); await select(0, 9);
    const clip = await js(`(() => { const l=ed.el.firstChild, r=l.getBoundingClientRect(), s=getComputedStyle(l,'::before'); return { x:r.left+parseFloat(s.left), y:r.top+parseFloat(s.top), width:16, height:16 }; })()`);
    const whites = async () => { const img = await shot(clip); let n = 0; for (let i = 0; i < img.px.length; i += 4) if (near([img.px[i], img.px[i + 1], img.px[i + 2]], [255, 255, 255], 90)) n++; return n; };
    await clickBox(0);
    const early = await whites(); // well inside the 170ms delay
    assert.equal(await js("ed.el.firstChild.classList.contains('ticking')"), true);
    assert.equal(await md(), '- [x] dfsadfsad');
    await new Promise(r => setTimeout(r, 450));
    const done = await whites();
    assert.equal(await js("ed.el.firstChild.classList.contains('ticking')"), false);
    assert.ok(early === 0 && done > 20, `tick drawn in: ${early} white px at the start, ${done} at the end`);
    await clickBox(0); assert.equal(await whites(), 0, 'untick hides the tick at once');
    await key('z', 2); assert.ok(await whites() > 20, 'undo shows the tick at once');
    assert.equal(await js("ed.el.querySelector('.ticking, [data-hot]')"), null, 'undo restored view state');
    await key('y', 2); assert.equal(await whites(), 0, 'redo of the untick');
    await key('z', 2); assert.ok(await whites() > 20, 'undo again');
    await fixture('- [x] loaded'); assert.equal(await js("ed.el.querySelector('.ticking')"), null);
    assert.ok(await whites() > 20, 'a loaded done to-do shows its tick at once');
    await agree('after ticking');
  });
  await test('tick and untick: box, tick, strike, dimming and Markdown agree', async () => {
    await fixture('- [ ] dfsadfsad\n- [ ] other');
    await clickBox(0); assert.equal(await md(), '- [x] dfsadfsad\n- [ ] other'); await agree('ticked');
    await clickBox(0); assert.equal(await md(), '- [ ] dfsadfsad\n- [ ] other'); await agree('unticked');
    await clickBox(1); await clickBox(0); assert.equal(await md(), '- [x] dfsadfsad\n- [x] other'); await agree('both');
  });
  await test('Enter after a checked to-do starts an unchecked one and keeps the checked one', async () => {
    await fixture('- [x] dfsadfsad'); await select(0, 9); await key('Enter'); await type('next');
    assert.equal(await md(), '- [x] dfsadfsad\n- [ ] next'); await agree('end');
    await select(0, 4); await key('Enter'); await agree('middle');
    await key('z', 2); await key('z', 2); await key('z', 2); assert.equal(await md(), '- [x] dfsadfsad'); await agree('undone');
  });
  await test('typing into a checked to-do, and joining lines into one, never leaves plain text in a checked line', async () => {
    const cases = [
      ['type at the end', '- [x] dfsadfsad', async () => { await select(0, 9); await type('x'); }, '- [x] dfsadfsadx'],
      ['type in the middle', '- [x] dfsadfsad', async () => { await select(0, 4); await type('x'); }, '- [x] dfsaxdfsad'],
      ['replace all of it', '- [x] dfsadfsad', async () => { await select(0, 0, 0, 9); await type('new'); }, '- [x] new'],
      ['delete all of it, retype', '- [x] dfsadfsad', async () => { await select(0, 9); for (let i = 0; i < 9; i++) await key('Backspace'); await type('dfsadfsad'); }, '- [x] dfsadfsad'],
      ['Backspace joins a line into an empty checked to-do', '- [x] \ndfsadfsad', async () => { await select(1, 0); await key('Backspace'); }, '- [x] dfsadfsad'],
      ['Backspace joins a line into a checked to-do', '- [x] dfsad\nfsad', async () => { await select(1, 0); await key('Backspace'); }, '- [x] dfsadfsad'],
      ['Delete at the end of a checked to-do', '- [x] dfsad\nfsad', async () => { await select(0, 5); await key('Delete'); }, '- [x] dfsadfsad'],
      ['typing over a selection across lines', '- [x] dfsa\nother dfsad', async () => { await select(0, 4, 1, 6); await type('X'); }, '- [x] dfsaXdfsad'],
      ['a checked to-do joined into a paragraph', 'plain\n- [x] dfsadfsad', async () => { await select(1, 0); await key('Backspace'); await key('Backspace'); }, 'plaindfsadfsad'],
    ];
    for (const [label, start, edit, want] of cases) {
      await fixture(start); await edit();
      assert.equal(await md(), want, label);
      await agree(label);
      await type('!'); await agree(label + ', then typing');
    }
  });
  await test('undo and redo a tick restore the box, the tick and the line together', async () => {
    await fixture('- [ ] dfsadfsad'); await select(0, 9);
    await clickBox(0); await select(0, 9); await type('x');
    assert.equal(await md(), '- [x] dfsadfsadx');
    await key('z', 2); assert.equal(await md(), '- [x] dfsadfsad'); await agree('undo typing');
    await key('z', 2); assert.equal(await md(), '- [ ] dfsadfsad'); await agree('undo tick');
    await key('y', 2); assert.equal(await md(), '- [x] dfsadfsad'); await agree('redo tick');
    await key('y', 2); assert.equal(await md(), '- [x] dfsadfsadx'); await agree('redo typing');
  });
  await test('selection ending at the next line start formats only the selected line', async () => {
    await fixture('one\ntwo'); await select(0,0,1,0); await js("ed.setList('ul')");
    assert.equal(await md(),'- one\ntwo');
  });
  await test('plain paste preserves literal Markdown, suffix, caret and undo', async () => {
    await fixture('abcd'); await select(0,2); await paste('X\n**Y**');
    assert.equal(await md(),'abX\n\\*\\*Y\\*\\*cd');
    await type('!'); assert.equal(await md(),'abX\n\\*\\*Y\\*\\*!cd');
    await key('z',2); await key('z',2); assert.equal(await md(),'abcd');
    await fixture('abcd\nefgh\nijkl'); await select(0,2,2,2); await paste('X\nY'); assert.equal(await md(),'abX\nYkl');
  });
  await test('rich paste keeps safe formatting, headings, lists, fonts and sizes', async () => {
    await fixture('');
    await paste('Bold italic\nHeading\nitem', '<p><b>Bold</b> <i>italic</i></p><h2>Heading</h2><ul><li><span style="font-family:Lora;font-size:24px">item</span></li></ul>');
    assert.equal(await md(),'**Bold** *italic*\n## Heading\n- <span style="font-family: Lora; font-size: 24px">item</span>');
    await key('z',2); assert.equal(await md(),'');
    await paste('safe','<p><a href="javascript:alert(1)">safe</a><script>bad()</script></p>'); assert.equal(await md(),'safe');
  });
  await test('font and size changes preserve selection and toolbar state through undo', async () => {
    await fixture('hello world'); await select(0,0,0,5); await js("ed.format({font:'Lora',size:24})");
    assert.equal(await md(),'<span style="font-family: Lora; font-size: 24px">hello</span> world');
    assert.equal(await js('getSelection().toString()'),'hello');
    assert.equal(await js('ed.here().size'),24);
    await key('z',2); assert.equal(await md(),'hello world');
    await key('y',2); assert.equal(await js('getSelection().toString()'),'hello');
    await js("ed.toggle('b')"); assert.ok((await md()).includes('**hello**'));
  });
  await test('typing format at an empty caret and select-all replacement preserve the caret', async () => {
    await fixture(''); await js("ed.format({font:'Lora',size:24})");
    assert.equal(await js('ed.here().font'),'Lora'); assert.equal(await js('ed.here().size'),24);
    await type('styled');
    assert.equal(await md(),'<span style="font-family: Lora; font-size: 24px">styled</span>');
    await fixture('old\ntext'); await key('a',2); await type('new'); await type('er');
    assert.equal(await md(),'newer');
    await key('z',2); assert.equal(await md(),'old\ntext');
  });
  await test('copy and paste through the real clipboard preserves inline formatting', async () => {
    await fixture('**bold** and *italic*'); await select(0,0,0,15);
    await key('c',2);
    await fixture(''); await js("ed.el.addEventListener('paste',e=>window.clipHtml=e.clipboardData.getData('text/html'),{once:true})"); await key('v',2);
    await new Promise(r=>setTimeout(r,100));
    assert.equal(await md(),'**bold** and *italic*',await js('window.clipHtml'));
  });
  await test('native clipboard round-trip preserves headings, lists and checked to-dos', async () => {
    const text='# Heading\n- bullet\n- [x] done';
    await fixture(text); await key('a',2); await key('c',2);
    await fixture(''); await key('v',2); await new Promise(r=>setTimeout(r,100));
    assert.equal(await md(),text); await agree('pasted');
  });
  await test('media insertion/removal and Enter at a media boundary are undoable', async () => {
    await fixture('before'); await select(0,6);
    await js("ed.insertFile({id:'11111111-2222-3333-4444-555555555555',name:'outline.pdf',mime:'application/pdf'})");
    assert.ok((await md()).includes('[outline.pdf](hgfile:'));
    await select(2,0); await key('Backspace'); assert.equal(await md(),'before\n');
    await key('z',2); assert.ok((await md()).includes('[outline.pdf](hgfile:'));
    await js("ed.el.querySelector('.file-chip').click()");
    assert.equal(await js('window.lastOpened'),'11111111-2222-3333-4444-555555555555');
    await js('ed.el.focus();getSelection().setBaseAndExtent(ed.el,1,ed.el,1)'); await key('Enter');
    assert.equal(await js('getSelection().anchorNode.closest?.(".media") || getSelection().anchorNode.parentElement?.closest(".media")'),null);
  });
  await test('IME stays intact until commit and commits as one undo entry', async () => {
    await fixture('');
    await send('Input.imeSetComposition',{text:'に',selectionStart:1,selectionEnd:1});
    assert.equal(await js('changes'),0);
    await send('Input.imeSetComposition',{text:'日本',selectionStart:2,selectionEnd:2});
    assert.equal(await js('changes'),0);
    await type('日本'); assert.equal(await md(),'日本');
    await key('z',2); assert.equal(await md(),'');
    await key('y',2); assert.equal(await md(),'日本');
  });
  await test('typing at the bottom follows the caret below the sticky toolbar', async () => {
    await fixture(Array.from({length:60},(_,i)=>'Line '+i).join('\n')); await select(59,7); await type(' bottom');
    await new Promise(r=>setTimeout(r,80));
    assert.ok(await js('document.querySelector(".note-page").scrollTop>500'));
    assert.ok(await js('getSelection().getRangeAt(0).getBoundingClientRect().bottom <= document.querySelector(".note-page").getBoundingClientRect().bottom'));
  });
  await test('late Drive info preserves selection/history; failed saves retry and writes stay ordered', async () => {
    await js(`(async()=>{
      ed.destroy();
      const page = (await import(${JSON.stringify(moduleUrl(resolve(root,'desktop/ui/pages/note.js')))})).default;
      const kit = await import(${JSON.stringify(moduleUrl(resolve(root,'desktop/ui/kit.js')))});
      const U = await import(${JSON.stringify(moduleUrl(resolve(root,'desktop/ui/util.js')))});
      const {h} = await import(${JSON.stringify(moduleUrl(resolve(root,'desktop/ui/dom.js')))});
      window.writes=[]; window.failNext=true; window.concurrent=0; window.maxConcurrent=0;
      const api={
        get:path=>path==='/api/drive/info'?new Promise(r=>window.driveReady=r):Promise.resolve({id:'quality-note',title:'Review',body:'hello'}),
        put:async(path,patch)=>{writes.push(patch);maxConcurrent=Math.max(maxConcurrent,++concurrent);await new Promise(r=>setTimeout(r,40));concurrent--;if(failNext){failNext=false;throw Error('offline');}return patch;},
      };
      const host=document.querySelector('.view'); host.replaceChildren();
      window.notePage=page.mount(host,{api,state:{clock:Date.now()},U,kit,courseById:()=>null,courseOptions:()=>[],head:args=>h('div',{class:'head'},args.acts),go:()=>{}},{id:'quality-note',title:'Review',body:'hello'});
      const body=host.querySelector('.note-body');body.focus();getSelection().setBaseAndExtent(body.firstChild.firstChild,5,body.firstChild.firstChild,5);
    })()`);
    await type('!');
    await js("driveReady({file_base:'http://127.0.0.1:1/files/',key:'isolated'})");
    await key('z',2); assert.equal(await js("document.querySelector('.note-body').textContent"),'hello');
    await key('y',2);
    await key('s',2); await waitFor("document.querySelector('.note-status').textContent",'Not saved');
    assert.equal(await js("document.querySelector('.note-status').textContent"),'Not saved');
    await key('s',2); await waitFor("document.querySelector('.note-status').textContent",'Saved');
    assert.equal(await js('writes.length'),2); assert.equal(await js('writes[1].body'),'hello!');
    assert.equal(await js("document.querySelector('.note-status').textContent"),'Saved');
    await type('a'); await key('s',2); await type('b'); await key('s',2);
    await waitFor('writes.at(-1).body','hello!ab'); await waitFor("document.querySelector('.note-status').textContent",'Saved');
    assert.equal(await js('maxConcurrent'),1); assert.equal(await js('writes.at(-1).body'),'hello!ab');
    await js('notePage.unmount()');
  });
  await test('saved, reopened and server-reloaded to-dos agree, also after the assistant edits the note', async () => {
    await js(`(async()=>{
      const page = (await import(${JSON.stringify(moduleUrl(resolve(root,'desktop/ui/pages/note.js')))})).default;
      const kit = await import(${JSON.stringify(moduleUrl(resolve(root,'desktop/ui/kit.js')))});
      const U = await import(${JSON.stringify(moduleUrl(resolve(root,'desktop/ui/util.js')))});
      const {h} = await import(${JSON.stringify(moduleUrl(resolve(root,'desktop/ui/dom.js')))});
      // The server already has the assistant's tick; the page is opened with the list's older copy.
      window.server={id:'todo-note',title:'Ticks',body:'- [x] dfsadfsad\\n- [ ] other'};
      const api={get:async path=>path==='/api/notes/todo-note'?{...server}:null,put:async(path,patch)=>{await new Promise(r=>setTimeout(r,20));Object.assign(server,patch);return {...server};}};
      window.ed0=window.ed0||ed;
      window.mountNote=note=>{
        const host=document.querySelector('.view'); host.replaceChildren();
        window.notePage=page.mount(host,{api,state:{clock:Date.now()},U,kit,courseById:()=>null,courseOptions:()=>[],head:a=>h('div',{class:'head'},a.acts),go:()=>{}},note);
        window.ed={el:host.querySelector('.note-body'),markdown:()=>server.body,destroy(){}};
      };
      mountNote({id:'todo-note',title:'Ticks',body:'- [ ] dfsadfsad\\n- [ ] other'});
    })()`);
    try {
      await waitFor("ed.el.firstChild.dataset.c||''", '1'); await agree('opened from a stale list');
      await clickBox(0); await waitFor('server.body', '- [ ] dfsadfsad\n- [ ] other'); await agree('unticked and saved');
      await clickBox(1); await waitFor('server.body', '- [ ] dfsadfsad\n- [x] other'); await agree('ticked and saved');
      await js('notePage.unmount()'); await js('mountNote({...server})'); await agree('reopened');
      await js(`server.body='- [x] dfsadfsad\\n- [x] other\\n- [ ] from the assistant'; notePage.update('data')`);
      await waitFor('ed.el.children.length', 3); await agree('assistant edit while open');
      // Unsaved typing is never replaced by a server copy; it is saved over it.
      await select(2, 18); await type('!');
      await js(`server.body='- [ ] dfsadfsad'; notePage.update('data')`);
      await waitFor('server.body', '- [x] dfsadfsad\n- [x] other\n- [ ] from the assistant!'); await agree('typing kept');
      await js('notePage.unmount()');
    } finally { await js('window.ed=ed0'); }
  });
} finally {
  if (!process.argv.includes('--keep')) await js('ed.destroy(); location.reload()').catch(()=>{});
  ws.close();
}
console.log(`${passes} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
