// The note editor: a word processor over the note's Markdown (RichNote.qml). What you see is the note: each line
// is a block (paragraph, heading, bullet, numbered, to-do, picture, file) of styled runs, read back into lines and
// written with noteformat.mjs, the reference every platform shares.
import * as NF from './noteformat.mjs';
import { h, icon } from './dom.js';

export function createEditor({ onChange, onOpenFile, fileUrl, onToggleTodo }) {
  const root = h('div', { class: 'note-body selectable', contenteditable: 'true', spellcheck: 'true', role: 'textbox', 'aria-multiline': 'true' });
  let loading = false;
  let composing = false;
  let editing = false;

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
      if (l.kind === 'image') el.append(h('img', { src: l.file.id ? fileUrl(l.file.id) : l.file.url, alt: l.file.name, draggable: 'false' }));
      else el.append(h('span', { class: 'file-chip' }, icon('clip'), l.file.name || 'File'));
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
        const text = node.nodeValue.replace(/\u00a0/g, ' ').replace(/\n/g, ' ');
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
      const s = { ...st };
      if (tag === 'B' || tag === 'STRONG') s.b = true;
      if (tag === 'I' || tag === 'EM') s.i = true;
      if (tag === 'U') s.u = true;
      if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') s.s = true;
      if (tag === 'CODE') s.code = true;
      if (tag === 'A' && node.getAttribute('href')) s.href = node.getAttribute('href');
      if (tag === 'FONT' && node.getAttribute('face')) s.font = node.getAttribute('face').replace(/["']/g, '');
      {
        if (node.dataset.font) s.font = node.dataset.font;
        if (node.dataset.size) s.size = Number(node.dataset.size);
        const st2 = node.style;
        if (!node.dataset.font && st2?.fontFamily) s.font = st2.fontFamily.split(',')[0].trim().replace(/["']/g, '');
        if (!node.dataset.size && /px$|pt$/.test(st2?.fontSize || '')) s.size = Math.round(parseFloat(st2.fontSize) * (st2.fontSize.endsWith('pt') ? 4 / 3 : 1));
        if (st2?.fontWeight === 'bold' || Number(st2?.fontWeight) >= 600) s.b = true;
        if (st2?.fontStyle === 'italic') s.i = true;
        if (st2?.textDecorationLine?.includes('underline')) s.u = true;
        if (st2?.textDecorationLine?.includes('line-through')) s.s = true;
      }
      if ((tag === 'DIV' || tag === 'P') && node !== block && cur.runs.length) { out.push(cur); cur = { ...base(), checked: false }; }
      for (const c of node.childNodes) walk(c, s);
    };
    walk(block, {});
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
    }
    root.classList.toggle('blank', root.children.length === 1 && !root.firstElementChild.classList.contains('media') && !root.textContent.length);
  }

  // Chromium keeps the look of text it moves between lines (Backspace or Delete joining lines, typing over several
  // lines, copying a checked to-do) by writing inline color and text-decoration. Notes have no text colour, and a
  // to-do's strike and dimming belong to its line (data-c), so these never stay: text joined into a checked to-do
  // otherwise showed plain and unstruck beside a ticked box.
  const LINE_STATE = ['color', 'background-color', 'text-decoration', '-webkit-text-fill-color'];
  function dropLineState(el) {
    for (const n of [el, ...el.querySelectorAll('[style], font[color]')]) {
      n.removeAttribute('color');
      for (const p of LINE_STATE) n.style.removeProperty(p);
      if (!n.style.length) n.removeAttribute('style');
    }
  }

  // Anything the browser made that isn't a line becomes one.
  function normalize() {
    const keep = bookmark();
    const before = root.innerHTML;
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
    for (const ln of root.children) if (!ln.classList.contains('media')) dropLineState(ln);
    for (const w of root.querySelectorAll('.ln:not(.media) span:not([style]):not([data-font]):not([data-size]), .ln:not(.media) font:not([face]):not([size])')) {
      const line = lineOf(w);
      w.replaceWith(...w.childNodes);
      line.normalize(); // one text node again, shaped like the same text after a reload
    }
    // execCommand('fontSize') writes <font size="7">: make it our own span with the chosen px size.
    for (const f of root.querySelectorAll('font[size="7"]')) {
      const sp = h('span', { 'data-size': String(pendingSize), style: { fontSize: `${pendingSize}px` } });
      if (f.hasAttribute('face')) {
        const face = f.getAttribute('face').replace(/["']/g, '');
        sp.dataset.font = face; sp.style.fontFamily = `"${face}"`;
      }
      sp.append(...f.childNodes);
      f.replaceWith(sp);
    }
    for (const f of root.querySelectorAll('font[face]')) {
      const face = f.getAttribute('face').replace(/["']/g, '');
      const sp = h('span', { 'data-font': face, style: { fontFamily: `"${face}"` } });
      sp.append(...f.childNodes);
      f.replaceWith(sp);
    }
    if (!root.children.length || root.lastElementChild.classList.contains('media')) root.append(lineEl({ kind: 'p', runs: [] }));
    // Resetting even an unchanged selection discards Chromium's pending typing format.
    if (root.innerHTML !== before) restoreBookmark(keep);
  }

  // ---- selection helpers ----
  const sel = () => window.getSelection();
  const lineOf = (node) => { while (node && node !== root) { if (node.parentNode === root) return node; node = node.parentNode; } return null; };
  function touched() {
    const s = sel();
    if (!s.rangeCount || !root.contains(s.anchorNode)) return [];
    const r = s.getRangeAt(0);
    const a = lineAt(r.startContainer, r.startOffset), b = lineAt(r.endContainer, r.endOffset);
    if (!a) return [];
    const out = [];
    for (let el = a; el; el = el.nextElementSibling) {
      // A selection ending at the next line's start does not include that line.
      if (el === b && el !== a && r.endOffset === 0 && (r.endContainer === b || !textBefore(b, r.endContainer, r.endOffset))) break;
      out.push(el); if (el === b || !b) break;
    }
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

  function lineAt(node, offset) {
    return node === root ? root.children[Math.min(offset, root.children.length - 1)] : lineOf(node);
  }
  function textBefore(line, node, offset) {
    const r = document.createRange(); r.setStart(line, 0); r.setEnd(node, offset);
    return r.toString().length;
  }
  // Character positions survive replacing a font wrapper, and preserve backward selections.
  function bookmark() {
    const s = sel();
    if (!s.rangeCount || !root.contains(s.anchorNode) || !root.contains(s.focusNode)) return null;
    const point = (node, offset) => {
      if (node === root) return { boundary: offset };
      const line = lineOf(node);
      return { line: [...root.children].indexOf(line), offset: textBefore(line, node, offset) };
    };
    return { anchor: point(s.anchorNode, s.anchorOffset), focus: point(s.focusNode, s.focusOffset) };
  }
  function restoreBookmark(mark) {
    if (!mark) return;
    const point = (p) => {
      if (p.boundary !== undefined) return [root, Math.min(p.boundary, root.childNodes.length)];
      const line = root.children[Math.min(p.line, root.children.length - 1)];
      if (!line) return [root, 0];
      let left = p.offset;
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) { if (left <= node.length) return [node, left]; left -= node.length; }
      return [line, left ? line.childNodes.length : 0];
    };
    const a = point(mark.anchor), b = point(mark.focus);
    sel().setBaseAndExtent(...a, ...b);
  }

  // Native undo cannot see Range edits, dataset changes, or attachment insertion. Keep one
  // history for native input AND these transactions, including the selection on either side.
  const undoStack = [], redoStack = [];
  let inputBefore = null, compositionBefore = null, lastEdit = 0;
  const snapshot = () => {
    // Hover and the tick animation are view state, not part of the note: never kept in undo.
    const was = hot, anim = [...root.querySelectorAll('.ticking')];
    setHot(null); anim.forEach(l => l.classList.remove('ticking'));
    const html = root.innerHTML;
    setHot(was); anim.forEach(l => l.classList.add('ticking'));
    return { html, selection: bookmark() };
  };
  function record(before, type = '') {
    const after = snapshot();
    if (!before || before.html === after.html) return;
    const last = undoStack.at(-1), now = Date.now();
    if (type && ['insertText', 'deleteContentBackward', 'deleteContentForward'].includes(type) && last?.type === type && now - lastEdit < 750 && last.after.html === before.html && JSON.stringify(last.after.selection) === JSON.stringify(before.selection)) last.after = after;
    else { undoStack.push({ before, after, type }); if (undoStack.length > 200) undoStack.shift(); }
    lastEdit = now;
    redoStack.length = 0;
  }
  function transaction(fn) {
    if (composing) return;
    const before = snapshot();
    editing = true;
    try { fn(); } finally { editing = false; }
    changed(); record(before);
  }
  function history(redo = false) {
    const from = redo ? redoStack : undoStack, to = redo ? undoStack : redoStack;
    const entry = from.pop();
    if (!entry) return;
    to.push(entry);
    const state = redo ? entry.after : entry.before;
    hot = null;
    root.innerHTML = state.html;
    root.focus({ preventScroll: true });
    restoreBookmark(state.selection);
    savedRange = null;
    typingFormat = typingAt = null;
    lastEdit = 0;
    changed();
    followCaret();
  }

  function followCaret() {
    requestAnimationFrame(() => {
      if (composing || document.activeElement !== root || !sel().rangeCount || !root.contains(sel().focusNode)) return;
      const range = sel().getRangeAt(0).cloneRange(); range.collapse(false);
      let box = range.getClientRects()[0];
      if (!box?.height) box = lineAt(sel().focusNode, sel().focusOffset)?.getBoundingClientRect();
      const scroller = root.closest('.page');
      if (!box || !scroller) return;
      const viewport = scroller.getBoundingClientRect();
      const toolbar = scroller.querySelector('.note-tools')?.getBoundingClientRect();
      const top = Math.max(viewport.top, toolbar?.bottom || viewport.top) + 8;
      const bottom = viewport.bottom - 24;
      if (box.bottom > bottom) scroller.scrollTo({ top: scroller.scrollTop + box.bottom - bottom, behavior: 'instant' });
      else if (box.top < top) scroller.scrollTo({ top: scroller.scrollTop - (top - box.top), behavior: 'instant' });
    });
  }

  // ---- edits ----
  function changed() {
    if (loading || composing || editing) return;
    normalize();
    paintNumbers();
    onChange?.();
    root.dispatchEvent(new Event('editorstatechange'));
    followCaret();
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
    restoreRange();
    document.execCommand({ b: 'bold', i: 'italic', u: 'underline', s: 'strikeThrough' }[key]);
    changed();
  }
  let pendingSize = NF.DEFAULT_SIZE;
  let typingFormat = null, typingAt = null;
  function format({ font, size }) {
    root.focus();
    restoreRange();
    if (font) document.execCommand('fontName', false, font);
    if (size) { pendingSize = size; document.execCommand('fontSize', false, '7'); }
    if (sel().isCollapsed) { typingFormat = { ...typingFormat, ...(font ? { font } : {}), ...(size ? { size } : {}) }; typingAt = JSON.stringify(bookmark()); }
    changed();
  }
  // The toolbar's pickers take focus; the selection they act on is kept here.
  let savedRange = null;
  const selectionChanged = () => {
    const s = sel();
    if (typingAt && typingAt !== JSON.stringify(bookmark())) typingFormat = typingAt = null;
    if (s.rangeCount && root.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange();
  };
  document.addEventListener('selectionchange', selectionChanged);
  function restoreRange() {
    if (!savedRange || !root.contains(savedRange.startContainer) || !root.contains(savedRange.endContainer)) return;
    if (root.contains(sel().anchorNode) && document.activeElement === root) return;
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
    const computed = getComputedStyle(n);
    st.font = computed.fontFamily.split(',')[0].trim().replace(/["']/g, '');
    st.size = Math.round(parseFloat(computed.fontSize));
    let gotFont = false, gotSize = false;
    while (n && n !== root) {
      if (!gotFont && n.dataset?.font) { st.font = n.dataset.font; gotFont = true; }
      if (!gotSize && n.dataset?.size) { st.size = Number(n.dataset.size); gotSize = true; }
      if (n.parentNode === root) { st.kind = n.dataset.k || 'p'; st.h = Number(n.dataset.h || 0); }
      n = n.parentNode;
    }
    if (typingFormat && JSON.stringify(bookmark()) === typingAt) Object.assign(st, typingFormat);
    return st;
  }

  // Enter: split the line; a list goes on (an empty item ends it). Shift+Enter does the same: notes are lines.
  function onEnter() {
    const s = sel();
    if (!s.rangeCount) return;
    if (!s.isCollapsed) { document.execCommand('delete'); normalize(); }
    let line = lineAt(s.anchorNode, s.anchorOffset);
    if (!line) return;
    if (line.classList.contains('media')) {
      const next = lineEl({ kind: 'p', runs: [] }); line.after(next); placeCaret(next); return;
    }
    if (s.anchorNode === root) placeCaret(line);
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
    if (line.dataset.h && frag.textContent) next.dataset.h = line.dataset.h;
    next.append(frag);
    // Stray empty wrappers from the split hold no text.
    for (const el of [...next.querySelectorAll('b,i,u,s,span,code,a')]) if (!el.textContent) el.remove();
    if (!next.textContent) next.replaceChildren(h('br'));
    if (!line.textContent && !line.querySelector('br')) line.append(h('br'));
    line.after(next);
    placeCaret(next);
    changed();
  }

  root.addEventListener('keydown', (e) => {
    if (e.isComposing || composing || e.keyCode === 229) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && ['z', 'y'].includes(e.key.toLowerCase())) { e.preventDefault(); history(e.key.toLowerCase() === 'y' || e.shiftKey); return; }
    if (e.key === 'Enter') { e.preventDefault(); transaction(onEnter); return; }
    if (e.key === 'Tab') {
      if (touched().some(l => l.dataset.k !== 'p') || !e.shiftKey) {
        e.preventDefault(); transaction(() => { if (!indent(e.shiftKey ? -1 : 1)) document.execCommand('insertText', false, '    '); });
      }
      return;
    }
    if (e.key === 'Backspace') {
      const s = sel();
      const line = s.rangeCount ? lineOf(s.anchorNode) : null;
      // Backspace at the start of a list line takes the marker off first; then it joins as usual.
      if (line && line.dataset.k !== 'p' && !line.classList.contains('media') && caretAtStart(line)) {
        e.preventDefault();
        transaction(() => {
          if (Number(line.dataset.i || 0) > 0) { line.dataset.i = String(Number(line.dataset.i) - 1); if (line.dataset.i === '0') delete line.dataset.i; }
          else { line.dataset.k = 'p'; delete line.dataset.c; }
        });
        return;
      }
      // Backspace right after a picture or file removes it.
      const prev = line?.previousElementSibling;
      if (line && prev?.classList.contains('media') && caretAtStart(line)) { e.preventDefault(); transaction(() => prev.remove()); }
      return;
    }
    if (mod && !e.shiftKey && ['b', 'i', 'u'].includes(e.key.toLowerCase())) { e.preventDefault(); transaction(() => toggle(e.key.toLowerCase())); }
  });
  root.addEventListener('beforeinput', (e) => {
    if (editing || composing) return;
    if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') { e.preventDefault(); history(e.inputType === 'historyRedo'); return; }
    if (e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') { e.preventDefault(); transaction(onEnter); return; }
    inputBefore = snapshot();
  });
  root.addEventListener('input', (e) => {
    if (editing || composing) return;
    changed(); record(inputBefore, e.inputType); inputBefore = null;
  });
  root.addEventListener('compositionstart', () => { compositionBefore = snapshot(); composing = true; });
  root.addEventListener('compositionend', () => { composing = false; changed(); record(compositionBefore); compositionBefore = inputBefore = null; });
  // Read supported rich formatting, then create our own nodes. Never insert clipboard HTML.
  const safeUrl = (url) => /^(https?:|mailto:|hgfile:)/i.test(url || '');
  function pastedLines(html, text) {
    if (!html) return text.replace(/\r\n?/g, '\n').split('\n').map(t => ({ kind: 'p', runs: t ? [{ text: t }] : [] }));
    html = /<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/i.exec(html)?.[1] || html;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,iframe,object,embed,meta,link').forEach(n => n.remove());
    for (const a of doc.querySelectorAll('a')) if (!safeUrl(a.getAttribute('href'))) a.removeAttribute('href');
    const lines = [];
    const visit = (parent, kind = 'p', indent = 0) => {
      let inline = document.createElement('div');
      const flush = () => { if (inline.textContent.trim() || inline.children.length) lines.push(...readBlock(inline)); inline = document.createElement('div'); };
      for (const node of parent.childNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) { inline.append(node.cloneNode(true)); continue; }
        const tag = node.tagName;
        if (tag === 'UL' || tag === 'OL') { flush(); visit(node, tag === 'UL' ? 'ul' : 'ol', kind === 'p' ? indent : indent + 1); continue; }
        if (/^(DIV|P|LI|H[1-6]|BLOCKQUOTE|PRE)$/.test(tag)) {
          flush();
          if (node.classList.contains('media') && ['image', 'file'].includes(node.dataset.k)) {
            const url = node.dataset.id ? `hgfile:${node.dataset.id}` : node.dataset.url;
            if (safeUrl(url)) lines.push({ kind: node.dataset.k, runs: [], file: { id: node.dataset.id, url: node.dataset.url, name: node.dataset.name || '' } });
            continue;
          }
          const block = node.cloneNode(true);
          const nested = [...block.querySelectorAll('ul,ol')]; nested.forEach(n => n.remove());
          block.dataset.k = ['p','ul','ol','todo'].includes(node.dataset.k) ? node.dataset.k : kind;
          block.dataset.i = String(Math.max(0, Math.min(6, Number(node.dataset.i) || indent)));
          if (/^H[1-6]$/.test(tag)) block.dataset.h = String(Math.min(3, Number(tag[1])));
          if (block.dataset.h) { block.style.removeProperty('font-size'); block.style.removeProperty('font-weight'); }
          if (block.dataset.k === 'todo' && block.dataset.c === '1') dropLineState(block);
          lines.push(...readBlock(block));
          for (const list of node.children) if (list.tagName === 'UL' || list.tagName === 'OL') visit(list, list.tagName === 'UL' ? 'ul' : 'ol', indent + 1);
        } else inline.append(node.cloneNode(true));
      }
      flush();
    };
    visit(doc.body);
    return lines.length ? lines : [{ kind: 'p', runs: [] }];
  }

  function insertLines(lines, plain = false) {
    const s = sel();
    if (!s.rangeCount || !root.contains(s.anchorNode)) return;
    if (!s.isCollapsed) { document.execCommand('delete'); normalize(); }
    let line = lineAt(s.anchorNode, s.anchorOffset);
    if (!line || line.classList.contains('media')) {
      const p = lineEl({ kind: 'p', runs: [] });
      if (line) line.after(p); else root.append(p);
      line = p; placeCaret(line);
    }
    if (s.anchorNode === root) placeCaret(line);
    const r = s.getRangeAt(0);
    const tail = document.createRange(); tail.setStart(r.startContainer, r.startOffset); tail.setEnd(line, line.childNodes.length);
    const rest = tail.extractContents();
    const empty = !line.textContent;
    if (empty) line.replaceChildren();
    const first = lines[0];
    if (first.kind === 'image' || first.kind === 'file') {
      const media = lineEl(first); line.after(media); line = media;
    } else {
      if (empty && !(plain && line.dataset.k !== 'p')) {
        const template = lineEl(first);
        for (const attr of ['k','i','h','c']) { delete line.dataset[attr]; if (template.dataset[attr]) line.dataset[attr] = template.dataset[attr]; }
      }
      for (const run of first.runs) line.append(runEl(run));
    }
    for (const l of lines.slice(1)) { const el = lineEl(l); line.after(el); line = el; }
    if (line.classList.contains('media')) { const p = lineEl({ kind: 'p', runs: [] }); line.after(p); line = p; }
    if (line.querySelector(':scope > br:only-child')) line.replaceChildren();
    const caret = document.createRange(); caret.selectNodeContents(line); caret.collapse(false);
    line.append(rest);
    if (!line.childNodes.length) line.append(h('br'));
    s.removeAllRanges(); s.addRange(caret);
  }

  root.addEventListener('paste', (e) => {
    const text = e.clipboardData?.getData('text/plain');
    if (text == null || e.clipboardData.files?.length) return;
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    transaction(() => insertLines(pastedLines(html, text), !html));
  });
  // The to-do whose box (as notes.css draws it, plus the look's --hit margin) is under the pointer.
  function boxAt(e) {
    const line = e.target.closest?.('.ln[data-k="todo"]');
    if (!line || line.parentNode !== root) return null;
    const r = line.getBoundingClientRect(), b = getComputedStyle(line, '::before');
    const m = parseFloat(getComputedStyle(line).getPropertyValue('--hit')) || 4;
    const x = e.clientX - r.left - parseFloat(b.left), y = e.clientY - r.top - parseFloat(b.top);
    return x >= -m && x <= parseFloat(b.width) + m && y >= -m && y <= parseFloat(b.height) + m ? line : null;
  }
  // A user's tick or untick (never load, undo or redo) marks the line .ticking for the look's animation.
  function ticking(line) {
    line.classList.remove('ticking');
    void line.offsetWidth; // restart the animation on a quick second click
    line.classList.add('ticking');
    clearTimeout(line.tickTimer);
    line.tickTimer = setTimeout(() => line.classList.remove('ticking'), 400);
  }
  // Hover: data-hot lights the box and shows the pointer. It is view state, never saved or kept in undo.
  let hot = null;
  const setHot = (line) => {
    if (line === hot) return;
    delete hot?.dataset.hot;
    hot = line;
    if (line) line.dataset.hot = '';
  };
  root.addEventListener('mousemove', (e) => setHot(boxAt(e)));
  root.addEventListener('mouseleave', () => setHot(null));
  // A click on a to-do's box ticks it (and saves at once).
  root.addEventListener('mousedown', (e) => {
    const line = boxAt(e);
    if (!line) return;
    e.preventDefault();
    transaction(() => { if (line.dataset.c === '1') delete line.dataset.c; else line.dataset.c = '1'; });
    ticking(line);
    onToggleTodo?.();
  });
  root.addEventListener('click', (e) => {
    const media = e.target.closest?.('.media');
    if (media?.parentNode === root) {
      if (media.dataset.id) onOpenFile?.(media.dataset.id);
      else if (safeUrl(media.dataset.url)) window.open(media.dataset.url);
    }
    const a = e.target.closest?.('a[href]');
    if (a && (e.ctrlKey || e.metaKey || !root.isContentEditable)) e.preventDefault();
  });
  // Delegation also works for nodes restored from an undo snapshot.
  root.addEventListener('error', e => { if (e.target.matches('.media img')) e.target.classList.add('broken'); }, true);
  root.addEventListener('load', e => { if (e.target.matches('.media img')) e.target.classList.remove('broken'); }, true);

  return {
    el: root,
    load(md) {
      loading = true;
      hot = null;
      root.replaceChildren(...NF.parse(md || '').map(lineEl));
      normalize();
      paintNumbers();
      loading = false;
      undoStack.length = redoStack.length = 0;
      savedRange = inputBefore = null;
      typingFormat = typingAt = null;
    },
    markdown() { return NF.serialize(readLines()); },
    focus(atEnd = true) { root.focus(); const line = atEnd ? root.lastElementChild : root.firstElementChild; if (line) placeCaret(line, atEnd); },
    // A picture or file goes on its own line after the caret's line.
    insertFile(f) {
      transaction(() => {
      const img = /^image\//.test(f.mime || '');
      const el = lineEl({ kind: img ? 'image' : 'file', indent: 0, runs: [], file: { id: f.id, name: f.name } });
      const s = sel();
      const line = s.rangeCount && root.contains(s.anchorNode) ? lineOf(s.anchorNode) : root.lastElementChild;
      if (line) line.after(el); else root.append(el);
      if (!el.nextElementSibling) el.after(lineEl({ kind: 'p', runs: [] }));
      });
    },
    refreshFiles() { for (const el of root.querySelectorAll('.media[data-k="image"][data-id] img')) el.src = fileUrl(el.parentElement.dataset.id); },
    destroy() { document.removeEventListener('selectionchange', selectionChanged); },
    setList: kind => transaction(() => setList(kind)),
    setHeading: level => transaction(() => setHeading(level)),
    toggle: key => transaction(() => toggle(key)),
    format: change => transaction(() => format(change)),
    indent: by => transaction(() => indent(by)),
    here,
  };
}

export const FONTS = NF.FONTS;
export const SIZES = NF.SIZES;
