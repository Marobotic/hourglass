// The desktop note editor's side of the note format: a note's Markdown
// (noteformat.mjs) as the HTML a Qt TextEdit shows, and the HTML Qt writes
// back as Markdown again.
//
// In the editor, list lines carry their marker as text ("• ", "☐ ", "1. "),
// a heading is a line all in bold at a heading size, a picture is an <img>
// on its own line, a Drive file a "📎 name" link on its own line. Code
// (`text`) is shown in the app's own mono font, which is how it is told apart
// from a note in the "JetBrains Mono" note font.
import { FONTS, DEFAULT_SIZE, HEADING_SIZES, parse, serialize, kindOf, prefixOf, lineText, mergeRuns, renumber } from "./noteformat.mjs";

export const CODE_FONT = "JetBrainsMono Nerd Font";
const P = "margin-top:0px; margin-bottom:0px; line-height:125%; white-space:pre-wrap;";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function spanStyle(r) {
  const css = [];
  if (r.code) css.push(`font-family:'${CODE_FONT}'`);
  else if (r.font && r.font !== FONTS[0]) css.push(`font-family:'${r.font}'`);
  if (r.size && r.size !== DEFAULT_SIZE) css.push(`font-size:${r.size}px`);
  if (r.b) css.push("font-weight:700");
  if (r.i) css.push("font-style:italic");
  const deco = [r.u && "underline", r.s && "line-through"].filter(Boolean);
  if (deco.length) css.push(`text-decoration:${deco.join(" ")}`);
  return css.join("; ");
}

function runHtml(r) {
  const style = spanStyle(r);
  let h = style ? `<span style="${style}">${esc(r.text)}</span>` : esc(r.text);
  if (r.href) h = `<a href="${esc(r.href)}">${h}</a>`;
  return h;
}

/**
 * A note's Markdown as editor HTML.
 * ctx.fileUrl(id): where this window loads a Drive file; ctx.imageWidth: the
 * width pictures are shown at. Returns the HTML and the Drive file names by id
 * (the HTML only keeps the ids).
 */
export function toHtml(md, ctx = {}) {
  const names = {};
  const width = ctx.imageWidth || 480;
  // Numbered lists show counted 1, 2, 3 (older notes may say 1, 1, 1).
  const html = renumber(parse(md)).map((l) => {
    if (l.kind === "image") {
      if (l.file.id) names[l.file.id] = l.file.name;
      const src = l.file.id ? (ctx.fileUrl ? ctx.fileUrl(l.file.id) : `hgfile:${l.file.id}`) : l.file.url;
      return `<p style="${P}"><img src="${esc(src)}" width="${width}" alt="${esc(l.file.name)}" /></p>`;
    }
    if (l.kind === "file") {
      if (l.file.id) names[l.file.id] = l.file.name;
      return `<p style="${P}"><a href="${esc(l.file.id ? `hgfile:${l.file.id}` : l.file.url)}">📎 ${esc(l.file.name)}</a></p>`;
    }
    const runs = l.h ? l.runs.map((r) => Object.assign({}, r, { b: true, size: HEADING_SIZES[l.h] })) : l.runs;
    const body = esc(prefixOf(l)) + runs.map(runHtml).join("");
    return body ? `<p style="${P}">${body}</p>` : `<p style="-qt-paragraph-type:empty; ${P}"><br /></p>`;
  }).join("\n");
  return { html, names };
}

// --- reading Qt's HTML ---------------------------------------------------------------

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENT[e.toLowerCase()] ?? m;
});

function attrs(src) {
  const out = {};
  const re = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(String(src || "")))) out[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? "");
  return out;
}

// CSS of a span (or a block) onto a style.
function applyCss(st, css) {
  for (const part of String(css || "").split(";")) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    const v = part.slice(i + 1).trim();
    if (k === "font-family") st.font = v.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
    else if (k === "font-size") {
      const n = parseFloat(v);
      if (/px$/i.test(v) && n > 0) st.size = Math.round(n);
      else if (/pt$/i.test(v) && n > 0) st.size = Math.round(n * 4 / 3);
    } else if (k === "font-weight") st.b = v === "bold" || parseInt(v, 10) >= 600;
    else if (k === "font-style") st.i = v === "italic" || v === "oblique";
    else if (k === "text-decoration") { st.u = /underline/.test(v); st.s = /line-through/.test(v); }
  }
}

const BLOCKS = new Set(["p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "blockquote", "pre"]);

/**
 * Qt's HTML as lines of runs, with each character's offset in the editor
 * (blocks are one character apart, a picture is one character), so a
 * selection's formatting can be changed run by run.
 * line = { runs: [{ text, start, b, i, u, s, font, size, href }], img: [{ src, start }], block, depth, list, checked }
 */
export function readHtml(html, { baseFont = FONTS[0], baseSize = DEFAULT_SIZE } = {}) {
  const lines = [];
  let line = null;
  let pos = 0;
  const stack = [{ tag: "root", st: { b: false, i: false, u: false, s: false, font: null, size: null, href: null } }];
  const lists = [];
  let skip = 0; // inside <head>, <style>, <script>
  const cur = () => stack[stack.length - 1].st;
  const startLine = (block, extra = {}) => {
    if (line && lines.length) pos += 1; // the paragraph break before this line
    line = Object.assign({ runs: [], img: [], block, depth: lists.length }, extra);
    lines.push(line);
  };
  const ensure = () => { if (!line) startLine("p"); };
  const text = (t) => {
    if (!t) return;
    ensure();
    const st = cur();
    line.runs.push({ text: t, start: pos, b: st.b, i: st.i, u: st.u, s: st.s, font: st.font, size: st.size, href: st.href });
    pos += t.length;
  };
  let emptyPara = false;
  const re = /<!--[\s\S]*?-->|<[!?][^>]*>|<(\/?)([a-zA-Z0-9]+)([^>]*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith("<!") || m[0].startsWith("<?")) continue;
    if (m[5] !== undefined) {
      if (skip) continue;
      // Between blocks Qt writes newlines that are not text.
      const t = decode(m[5]).replace(/\n/g, line ? "" : "");
      if (line || t.trim()) text(t);
      continue;
    }
    const close = m[1] === "/";
    const tag = m[2].toLowerCase();
    const a = attrs(m[3]);
    if (tag === "head" || tag === "style" || tag === "script") { skip += close ? -1 : 1; continue; }
    if (skip) continue;
    if (!close && (m[4] === "/" || tag === "br" || tag === "img" || tag === "meta" || tag === "hr")) {
      if (tag === "br") {
        if (emptyPara) continue;
        // A line break inside a paragraph (Shift+Enter): a new line all the same.
        // The break is one character; the text after it starts a line of its own.
        ensure();
        pos += 1;
        line = { runs: [], img: [], block: line.block, depth: line.depth, soft: true };
        lines.push(line);
      } else if (tag === "img") {
        ensure();
        line.img.push({ src: a.src || "", alt: a.alt || "", start: pos });
        pos += 1;
      }
      continue;
    }
    if (tag === "ul" || tag === "ol") {
      if (close) lists.pop();
      else lists.push({ type: tag, n: 0 });
      continue;
    }
    if (BLOCKS.has(tag)) {
      if (close) { emptyPara = false; continue; }
      const st = Object.assign({}, cur());
      applyCss(st, a.style);
      const extra = {};
      if (tag === "li") {
        const l = lists[lists.length - 1];
        if (l) l.n++;
        extra.list = l ? l.type : "ul";
        extra.num = l ? l.n : 1;
        if (a.class === "checked" || a.class === "unchecked") extra.checked = a.class === "checked";
        extra.depth = Math.max(0, lists.length - 1);
      }
      if (/^h[1-6]$/.test(tag)) extra.h = Math.min(3, Number(tag[1]));
      emptyPara = /-qt-paragraph-type:\s*empty/.test(a.style || "");
      startLine(tag, extra);
      if (extra.depth !== undefined) line.depth = extra.depth;
      continue;
    }
    if (close) {
      // Pop to the matching open tag.
      for (let k = stack.length - 1; k > 0; k--) if (stack[k].tag === tag) { stack.length = k; break; }
      continue;
    }
    const st = Object.assign({}, cur());
    if (tag === "span" || tag === "font") {
      applyCss(st, a.style);
      // Qt underlines and colours every link itself: that is not the note's underline.
      if (st.inLink) st.u = cur().u;
    }
    else if (tag === "b" || tag === "strong") st.b = true;
    else if (tag === "i" || tag === "em") st.i = true;
    else if (tag === "u" || tag === "ins") st.u = true;
    else if (tag === "s" || tag === "del" || tag === "strike") st.s = true;
    else if (tag === "a") { st.href = a.href || null; st.inLink = true; }
    else if (tag === "code" || tag === "tt") st.font = CODE_FONT;
    if (a.style && tag !== "span" && tag !== "font" && tag !== "a") applyCss(st, a.style);
    stack.push({ tag, st });
  }
  return lines.map((l) => Object.assign({}, l, { runs: l.runs.map((r) => Object.assign({}, r, { font: r.font === baseFont ? null : r.font, size: r.size === baseSize ? null : r.size })) }));
}

const fileIdOf = (src) => (/\/files\/([0-9a-f-]{36})/.exec(src) || /^hgfile:([0-9a-f-]{36})/.exec(src) || [])[1] || null;

/** The editor's HTML back into the note's Markdown. names: Drive file id -> name. */
export function fromHtml(html, names = {}, opts) {
  const out = [];
  for (const l of readHtml(html, opts)) {
    // Pictures each get a line of their own; text around one stays on its own line.
    let runs = l.runs.map((r) => ({ text: r.text.replace(/\u00a0/g, " ").replace(/[\u2028\u2029\ufffc]/g, ""), b: r.b, i: r.i, u: r.u, s: r.s, font: r.font, size: r.size, href: r.href }));
    for (const im of l.img) {
      const id = fileIdOf(im.src);
      out.push({ kind: "image", indent: 0, runs: [], file: id ? { id, name: names[id] || im.alt || "picture" } : { url: im.src, name: im.alt || "picture" } });
    }
    const plain = runs.map((r) => r.text).join("");
    if (l.img.length && !plain.trim()) continue;
    // A Drive file: a line that is only its link.
    const links = runs.filter((r) => r.text.trim());
    if (links.length && links.every((r) => r.href && r.href === links[0].href) && /^hgfile:/.test(links[0].href)) {
      const id = links[0].href.slice(7);
      out.push({ kind: "file", indent: 0, runs: [], file: { id, name: names[id] || plain.replace(/^\s*📎\s*/, "").trim() || "file" } });
      continue;
    }
    // Code is the app's mono font.
    runs = runs.map((r) => (r.font === CODE_FONT ? Object.assign({}, r, { font: null, code: true }) : r));
    let line = { kind: "p", indent: 0, runs };
    if (l.list) {
      // A real list (pasted from elsewhere): its marker becomes ours.
      line = { kind: l.checked !== undefined ? "todo" : l.list === "ol" ? "ol" : "ul", indent: l.depth || 0, num: l.num, checked: !!l.checked, runs };
    } else {
      const k = kindOf(plain);
      if (k.kind !== "p") {
        line = { kind: k.kind, indent: k.indent, num: k.num, checked: !!k.checked, runs: dropChars(runs, k.prefix) };
      }
    }
    // A heading: a whole line in bold at a heading size (or a pasted <h1>-<h3>).
    if (line.kind === "p") {
      const filled = runs.filter((r) => r.text.trim());
      const level = l.h || (filled.length ? HEADING_SIZES.indexOf(filled[0].size) : -1);
      if (level > 0 && (l.h || filled.every((r) => r.b && r.size === HEADING_SIZES[level] && !r.font))) {
        line.h = level;
        line.runs = runs.map((r) => Object.assign({}, r, { b: false, size: null }));
      }
    }
    line.runs = mergeRuns(line.runs);
    out.push(line);
  }
  return serialize(out);
}

// The first n characters of a line's runs taken off (the list marker).
function dropChars(runs, n) {
  const out = [];
  for (const r of runs) {
    if (n >= r.text.length) { n -= r.text.length; continue; }
    out.push(Object.assign({}, r, { text: r.text.slice(n) }));
    n = 0;
  }
  return out;
}

/** The runs of a stretch of the editor, with absolute positions: what a format change walks. */
export function runsOf(html, offset, opts) {
  const out = [];
  for (const l of readHtml(html, opts)) for (const r of l.runs) if (r.text) out.push(Object.assign({}, r, { start: offset + r.start, end: offset + r.start + r.text.length }));
  return out;
}

export { lineText };

/** Text for TextEdit.insert(), which reads it as HTML. */
export const escapeText = esc;
