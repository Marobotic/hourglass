// The note editor: a word processor over the note's Markdown (RichNote.qml). What you see is the note: each line
// is a block (paragraph, heading, bullet, numbered, to-do, picture, file) of styled runs, read back into lines and
// written with noteformat.mjs, the reference every platform shares.
import * as NF from './noteformat.mjs';
import { h } from './dom.js';

export function createEditor({ onChange, onOpenFile, fileUrl, onToggleTodo }) {
  const root = h('div', { class: 'note-body selectable', contenteditable: 'true', spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true' });
  let loading = false;

  // ---- lines -> DOM ----
  function runEl(r) {
    let el = document.createTextNode(r.text);
    const wrap = (tag, props = {}) => { const w = h(tag, props); w.append(el); el = w; };
    if (r.code) wrap('code');
    if (r.s) wrap('s');
    if (r.u) wrap('u');
    if (r.i) wrap('i');
    if (r.b) wrap('b');
    if (r.font || r.size) {
      const style = {};
      if (r.font) style.fontFamily = `"${r.font}"`;
      if (r.size) style.fontSize = `${r.size}px`;
      const sp = h('span', { 'data-font': r.font || null, 'data-size': r.size ? String(r.size) : null, style });
      sp.append(el);
      el = sp;
    }
    if (r.href) wrap('a', { href: r.href });
    return el;
  }
  function lineEl(l) {
    if (l.kind === 'image' || l.kind === 'file') {
      const el = h('div', { class: 'ln media', contenteditable: 'false', 'data-k': l.kind, 'data-id': l.file.id || null, 'data-url': l.file.url || null, 'data-name': l.file.name || '' });
      if (l.kind === 'image') el.append(h('img', { src: l.file.id ? fileUrl(l.file.id) : l.file.url, alt: l.file.name, draggable: 'false', onerror: (e) => e.currentTarget.classList.add('broken') }));
      else el.append(h('span', { class: 'file-chip' }, h('i', { class: 'ic', text: '\u{f0c6}' }), l.file.name || 'File'));
      el.addEventListener('click', () => (l.file.id ? onOpenFile?.(l.file.id) : window.open(l.file.url)));
      return el;
    }
    const el = h('div', { class: 'ln', 'data-k': l.kind });
    if (l.h) el.dataset.h = String(l.h);
    if (l.indent) el.dataset.i = String(l.indent);
    if (l.kind === 'todo' && l.checked) el.dataset.c = '1';
    for (const r of l.runs || []) if (r.text) el.append(runEl(r));
    if (!el.childNodes.length) el.append(h('br'));
    return el;
  }

  // ---- DOM -> lines ----
  // Walks a block's nodes; every <br> (from typing or pasting) starts a new line of the same kind.
  function readBlock(block) {
    const out = [];
    const base = () => ({
      kind: block.dataset?.k || 'p',
      indent: Number(block.dataset?.i || 0),
      h: Number(block.dataset?.h || 0) || undefined,
      checked: block.dataset?.c === '1',
      runs: [],
    });
    let cur = base();
    const walk = (node, st) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue.replace(/​/g, '').replace(/\n/g, ' ');
        if (text) cur.runs.push({ text, ...st });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName;
      if (tag === 'BR') {
        if (node === block.lastChild || (node.nextSibling == null && node.parentNode.lastChild === node && node.parentNode !== block)) return;
        out.push(cur);
        cur = { ...base(), checked: false };
        return;
      }
      if (tag === 'DIV' || tag === 'P') {
        if (cur.runs.length) { out.push(cur); cur = { ...base(), checked: false }; }
        for (const c of node.childNodes) walk(c, st);
        return;
      }
      const s = { ...st };
      if (tag === 'B' || tag === 'STRONG') s.b = true;
      if (tag === 'I' || tag === 'EM') s.i = true;
      if (tag === 'U') s.u = true;
      if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') s.s = true;
      if (tag === 'CODE') s.code = true;
      if (tag === 'A' && node.getAttribute('href')) s.href = node.getAttribute('href');
      if (tag === 'FONT' && node.getAttribute('face')) s.font = node.getAttribute('face').replace(/["']/g, '');
      if (tag === 'SPAN' || tag === 'FONT') {
        if (node.dataset.font) s.font = node.dataset.font;
        if (node.dataset.size) s.size = Number(node.dataset.size);
        const st2 = node.style;
        if (st2?.fontWeight === 'bold' || Number(st2?.fontWeight) >= 600) s.b = true;
        if (st2?.fontStyle === 'italic') s.i = true;
        if (st2?.textDecorationLine?.includes('underline')) s.u = true;
        if (st2?.textDecorationLine?.includes('line-through')) s.s = true;
      }
      for (const c of node.childNodes) walk(c, s);
    };
    for (const c of block.childNodes) walk(c, {});
    out.push(cur);
    return out.map((l) => {
      for (const r of l.runs) {
        if (r.font === NF.FONTS[0]) delete r.font;
        if (r.size === NF.DEFAULT_SIZE) delete r.size;
      }
      return { ...l, runs: NF.mergeRuns(l.runs) };
    });
  }
  function readLines() {
    const lines = [];
    let loose = null; // text the browser left straight in the editor
    const flushLoose = () => { if (loose) { lines.push(...readBlock(loose)); loose = null; } };
    for (const node of root.childNodes) {
      if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('ln')) {
        flushLoose();
        if (node.classList.contains('media')) {
          lines.push({ kind: node.dataset.k, indent: 0, runs: [], file: { id: node.dataset.id || null, url: node.dataset.url || null, name: node.dataset.name || '' } });
        } else lines.push(...readBlock(node));
      } else if (node.nodeType === Node.ELEMENT_NODE && (node.tagName === 'DIV' || node.tagName === 'P')) {
        flushLoose();
        lines.push(...readBlock(node));
      } else {
        if (!loose) loose = document.createElement('div');
        loose.append(node.cloneNode(true));
      }
    }
    flushLoose();
    return NF.renumber(lines);
  }

  // Numbers for numbered lines (a blank line ends a list), shown by CSS from data-n.
  function paintNumbers() {
    const counters = [];
    for (const el of root.children) {
      const k = el.dataset.k, i = Number(el.dataset.i || 0);
      if (k === 'ol') { counters.length = i + 1; counters[i] = (counters[i] || 0) + 1; el.dataset.n = String(counters[i]); }
      else if (k === 'p' && !el.textContent.trim()) counters.length = 0;
      else if (k !== 'ul' && k !== 'todo') counters.length = 0;
      el.classList.toggle('empty', !el.classList.contains('media') && !el.textContent.length);
    }
    root.classList.toggle('blank', root.children.length <= 1 && !root.textContent.length);
  }

  // Anything the browser made that isn't a line becomes one.
  function normalize() {
    for (const node of [...root.childNodes]) {
      if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('ln')) continue;
      if (node.nodeType === Node.ELEMENT_NODE && (node.tagName === 'DIV' || node.tagName === 'P')) {
        node.className = 'ln';
        if (!node.dataset.k) node.dataset.k = 'p';
        continue;
      }
      if (node.nodeType === Node.TEXT_NODE && !node.nodeValue.trim() && !node.nodeValue.length) { node.remove(); continue; }
      const ln = h('div', { class: 'ln', 'data-k': 'p' });
      node.replaceWith(ln);
      ln.append(node);
    }
    // execCommand('fontSize') writes <font size="7">: make it our own span with the chosen px size.
    for (const f of root.querySelectorAll('font[size="7"]')) {
      const sp = h('span', { 'data-size': String(pendingSize), style: { fontSize: `${pendingSize}px` } });
      sp.append(...f.childNodes);
      f.replaceWith(sp);
    }
    for (const f of root.querySelectorAll('font[face]')) {
      const face = f.getAttribute('face').replace(/["']/g, '');
      const sp = h('span', { 'data-font': face, style: { fontFamily: `"${face}"` } });
      sp.append(...f.childNodes);
      f.replaceWith(sp);
    }
    if (!root.children.length) root.append(lineEl({ kind: 'p', runs: [] }));
  }

  // ---- selection helpers ----
  const sel = () => window.getSelection();
  const lineOf = (node) => { while (node && node !== root) { if (node.parentNode === root) return node; node = node.parentNode; } return null; };
  function touched() {
    const s = sel();
    if (!s.rangeCount || !root.contains(s.anchorNode)) return [];
    const r = s.getRangeAt(0);
    const a = lineOf(r.startContainer), b = lineOf(r.endContainer);
    if (!a) return [];
    const out = [];
    for (let el = a; el; el = el.nextElementSibling) { out.push(el); if (el === b || !b) break; }
    return out.filter((el) => !el.classList.contains('media'));
  }
  function caretAtStart(line) {
    const s = sel();
    if (!s.rangeCount || !s.isCollapsed) return false;
    const r = document.createRange();
    r.setStart(line, 0);
    r.setEnd(s.anchorNode, s.anchorOffset);
    return r.toString().length === 0;
  }
  function placeCaret(el, atEnd = false) {
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(!atEnd);
    const s = sel();
    s.removeAllRanges();
    s.addRange(r);
  }

  // ---- edits ----
  let changeTimer = 0;
  function changed() {
    if (loading) return;
    normalize();
    paintNumbers();
    clearTimeout(changeTimer);
    onChange?.();
  }

  function setList(kind) {
    const lines = touched();
    if (!lines.length) return;
    const all = lines.every((l) => l.dataset.k === kind);
    for (const l of lines) {
      l.dataset.k = all ? 'p' : kind;
      delete l.dataset.h;
      if (all) delete l.dataset.i;
      if (kind !== 'todo' || all) delete l.dataset.c;
    }
    changed();
  }
  function setHeading(level) {
    const lines = touched();
    const all = lines.every((l) => l.dataset.h === String(level));
    for (const l of lines) {
      l.dataset.k = 'p';
      delete l.dataset.i;
      delete l.dataset.c;
      if (all) delete l.dataset.h; else l.dataset.h = String(level);
    }
    changed();
  }
  function indent(by) {
    const lines = touched().filter((l) => l.dataset.k !== 'p');
    if (!lines.length) return false;
    for (const l of lines) {
      const n = Math.max(0, Math.min(6, Number(l.dataset.i || 0) + by));
      if (n) l.dataset.i = String(n); else delete l.dataset.i;
    }
    changed();
    return true;
  }
  function toggle(key) {
    root.focus();
    document.execCommand({ b: 'bold', i: 'italic', u: 'underline', s: 'strikeThrough' }[key]);
    changed();
  }
  let pendingSize = NF.DEFAULT_SIZE;
  function format({ font, size }) {
    root.focus();
    restoreRange();
    if (font) document.execCommand('fontName', false, font);
    if (size) { pendingSize = size; document.execCommand('fontSize', false, '7'); }
    changed();
  }
  // The toolbar's pickers take focus; the selection they act on is kept here.
  let savedRange = null;
  document.addEventListener('selectionchange', () => {
    const s = sel();
    if (s.rangeCount && root.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange();
  });
  function restoreRange() {
    if (!savedRange) return;
    const s = sel();
    s.removeAllRanges();
    s.addRange(savedRange);
  }

  // What the caret is in, for the toolbar.
  function here() {
    const s = sel();
    const st = { b: false, i: false, u: false, s: false, font: NF.FONTS[0], size: NF.DEFAULT_SIZE, kind: 'p', h: 0 };
    if (!s.rangeCount || !root.contains(s.anchorNode)) return st;
    st.b = document.queryCommandState('bold');
    st.i = document.queryCommandState('italic');
    st.u = document.queryCommandState('underline');
    st.s = document.queryCommandState('strikeThrough');
    let n = s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentNode;
    let gotFont = false, gotSize = false;
    while (n && n !== root) {
      if (!gotFont && n.dataset?.font) { st.font = n.dataset.font; gotFont = true; }
      if (!gotSize && n.dataset?.size) { st.size = Number(n.dataset.size); gotSize = true; }
      if (n.parentNode === root) { st.kind = n.dataset.k || 'p'; st.h = Number(n.dataset.h || 0); }
      n = n.parentNode;
    }
    return st;
  }

  // Enter: split the line; a list goes on (an empty item ends it). Shift+Enter does the same: notes are lines.
  function onEnter() {
    const s = sel();
    if (!s.rangeCount) return;
    const line = lineOf(s.anchorNode);
    if (!line || line.classList.contains('media')) return;
    const k = line.dataset.k || 'p';
    if (k !== 'p' && !line.textContent.trim()) {
      line.dataset.k = 'p';
      delete line.dataset.i;
      delete line.dataset.c;
      changed();
      return;
    }
    const r = s.getRangeAt(0);
    r.deleteContents();
    const tail = document.createRange();
    tail.setStart(r.endContainer, r.endOffset);
    tail.setEnd(line, line.childNodes.length);
    const frag = tail.extractContents();
    const next = h('div', { class: 'ln', 'data-k': k });
    if (line.dataset.i) next.dataset.i = line.dataset.i;
    next.append(frag);
    // Stray empty wrappers from the split hold no text.
    for (const el of [...next.querySelectorAll('b,i,u,s,span,code,a')]) if (!el.textContent) el.remove();
    if (!next.textContent) next.replaceChildren(h('br'));
    if (!line.textContent && !line.querySelector('br')) line.append(h('br'));
    line.after(next);
    placeCaret(next);
    changed();
    next.scrollIntoView({ block: 'nearest' });
  }

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); onEnter(); return; }
    if (e.key === 'Tab') { if (indent(e.shiftKey ? -1 : 1)) e.preventDefault(); else if (!e.shiftKey) { e.preventDefault(); document.execCommand('insertText', false, '    '); } return; }
    if (e.key === 'Backspace') {
      const s = sel();
      const line = s.rangeCount ? lineOf(s.anchorNode) : null;
      // Backspace at the start of a list line takes the marker off first; then it joins as usual.
      if (line && line.dataset.k !== 'p' && !line.classList.contains('media') && caretAtStart(line)) {
        e.preventDefault();
        if (Number(line.dataset.i || 0) > 0) { line.dataset.i = String(Number(line.dataset.i) - 1); if (line.dataset.i === '0') delete line.dataset.i; }
        else { line.dataset.k = 'p'; delete line.dataset.c; }
        changed();
        return;
      }
      // Backspace right after a picture or file removes it.
      const prev = line?.previousElementSibling;
      if (line && prev?.classList.contains('media') && caretAtStart(line)) { e.preventDefault(); prev.remove(); changed(); }
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.shiftKey && ['b', 'i', 'u'].includes(e.key.toLowerCase())) { e.preventDefault(); toggle(e.key.toLowerCase()); }
  });
  root.addEventListener('input', changed);
  // Pasted text comes in as plain lines of Markdown, never as someone else's HTML.
  root.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain');
    if (text == null || e.clipboardData.files?.length) return;
    e.preventDefault();
    const parts = text.replace(/\r/g, '').split('\n');
    if (parts.length === 1) { document.execCommand('insertText', false, text); return; }
    const s = sel();
    if (!s.rangeCount) return;
    s.getRangeAt(0).deleteContents();
    const line = lineOf(s.anchorNode);
    document.execCommand('insertText', false, parts[0]);
    // The rest of the current line goes after the pasted lines.
    const r = sel().getRangeAt(0);
    const tail = document.createRange();
    tail.setStart(r.endContainer, r.endOffset);
    tail.setEnd(line, line.childNodes.length);
    const rest = tail.extractContents();
    let at = line;
    const added = NF.parse(parts.slice(1).join('\n')).map(lineEl);
    for (const el of added) { at.after(el); at = el; }
    if (rest.textContent) { if (at.querySelector(':scope > br:only-child')) at.replaceChildren(); at.append(rest); }
    placeCaret(at, true);
    changed();
  });
  // A click on a to-do's box ticks it (and saves at once).
  root.addEventListener('mousedown', (e) => {
    const line = e.target.closest?.('.ln[data-k="todo"]');
    if (!line || line.parentNode !== root) return;
    const box = line.getBoundingClientRect();
    const left = box.left + Number(line.dataset.i || 0) * 24;
    if (e.clientX >= left && e.clientX <= left + 26) {
      e.preventDefault();
      if (line.dataset.c === '1') delete line.dataset.c; else line.dataset.c = '1';
      changed();
      onToggleTodo?.();
    }
  });
  root.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (a && (e.ctrlKey || e.metaKey || !root.isContentEditable)) e.preventDefault();
  });

  return {
    el: root,
    load(md) {
      loading = true;
      root.replaceChildren(...NF.parse(md || '').map(lineEl));
      normalize();
      paintNumbers();
      loading = false;
    },
    markdown() { return NF.serialize(readLines()); },
    focus(atEnd = true) { root.focus(); const last = root.lastElementChild; if (last) placeCaret(last, atEnd); },
    // A picture or file goes on its own line after the caret's line.
    insertFile(f) {
      const img = /^image\//.test(f.mime || '');
      const el = lineEl({ kind: img ? 'image' : 'file', indent: 0, runs: [], file: { id: f.id, name: f.name } });
      const s = sel();
      const line = s.rangeCount && root.contains(s.anchorNode) ? lineOf(s.anchorNode) : root.lastElementChild;
      if (line) line.after(el); else root.append(el);
      if (!el.nextElementSibling) el.after(lineEl({ kind: 'p', runs: [] }));
      changed();
    },
    setList, setHeading, toggle, format, here, indent,
  };
}

export const FONTS = NF.FONTS;
export const SIZES = NF.SIZES;
