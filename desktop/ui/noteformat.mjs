// Hourglass note text, and how every editor reads and writes it.
//
// A note is stored as Markdown, one line per line (a line break is a line
// break, not a soft wrap), so search, sync, versions and every AI keep
// working on plain text. What Markdown has no syntax for travels as two
// HTML tags:
//   <u>underlined</u>
//   <span style="font-family: Lora; font-size: 20px">…</span>
//
// The editors (desktop, Android, iOS) are WYSIWYG: they parse a note into
// lines of styled runs, show those, and serialize them back. This file is the
// reference; Kotlin (Note.kt) and Swift (NoteFormat.swift) port it, and
// core/test/noteformat.test.js is the spec all three must match. The desktop
// app imports a byte-identical copy (windows|linux/app/Hourglass/noteformat.mjs).
//
// line  = { kind: "p" | "ul" | "ol" | "todo" | "image" | "file",
//           indent: 0.., h: 0..3 (p only), num (ol), checked (todo),
//           runs: [run], file: { id, url, name } (image | file) }
// run   = { text, b, i, u, s, code, font, size, href }   (absent = off/default)

// Fonts the apps carry. The first is the default (no span written for it).
export const FONTS = ["Inter", "Lora", "JetBrains Mono", "Caveat", "Playfair Display"];
export const SIZES = [12, 14, 15, 16, 18, 20, 24, 28, 32, 40];
export const DEFAULT_SIZE = 15;
// Heading lines (## …) show at these sizes, bold.
export const HEADING_SIZES = [0, 26, 21, 18];

// The editors show list lines with these in front of the text.
export const BULLET = "•";
export const BOX = "☐";
export const CHECKED = "☑";

const STYLE_KEYS = ["b", "i", "u", "s", "code", "font", "size", "href"];
const isSpace = (c) => c === undefined || c === "" || /\s/.test(c);
// Letters, digits and _ (Qt's JavaScript has no \p{L}: anything past Latin-1 that isn't
// space or punctuation counts as a letter).
const isWord = (c) => {
  if (c === undefined || c === "") return false;
  if (/[A-Za-z0-9_]/.test(c)) return true;
  const n = c.charCodeAt(0);
  return n >= 0xc0 && !/\s/.test(c) && !(n >= 0x2000 && n <= 0x206f) && !(n >= 0x3000 && n <= 0x303f);
};

export function sameStyle(a, b) {
  for (const k of STYLE_KEYS) if ((a[k] || null) !== (b[k] || null)) return false;
  return true;
}

function cleanRun(r) {
  const out = { text: r.text };
  for (const k of STYLE_KEYS) if (r[k]) out[k] = r[k];
  return out;
}

// Adjacent runs with the same style become one; empty runs go.
export function mergeRuns(runs) {
  const out = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && sameStyle(last, r)) last.text += r.text;
    else out.push(cleanRun(r));
  }
  return out;
}

// --- parsing -------------------------------------------------------------------

function parseStyleAttr(css) {
  const out = {};
  for (const part of String(css).split(";")) {
    const [k, ...v] = part.split(":");
    const key = (k || "").trim().toLowerCase();
    const val = v.join(":").trim().replace(/^['"]|['"]$/g, "");
    if (!val) continue;
    if (key === "font-family") out.font = val.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
    else if (key === "font-size") {
      const n = parseFloat(val);
      if (n > 0) out.size = Math.round(/pt$/i.test(val) ? n * 4 / 3 : n);
    }
  }
  return out;
}

/** One line's inline Markdown into runs. Styles never carry over to the next line. */
export function parseInline(src) {
  const runs = [];
  const st = { b: false, i: false, u: false, s: false, font: null, size: null };
  const spans = [];
  let text = "";
  const push = (extra = {}) => {
    if (!text && !extra.text) return;
    runs.push(Object.assign({}, st, extra, { text: extra.text ?? text }));
    if (!extra.text) text = "";
  };
  const emit = (t, extra) => { push(); push(Object.assign({}, extra, { text: t })); };
  let k = 0;
  while (k < src.length) {
    const c = src[k];
    if (c === "\\" && k + 1 < src.length && /[\\`*_~<>\[\]()#+\-.!|]/.test(src[k + 1])) {
      text += src[k + 1];
      k += 2;
      continue;
    }
    if (c === "`") {
      const end = src.indexOf("`", k + 1);
      if (end > k + 1) {
        emit(src.slice(k + 1, end), { code: true });
        k = end + 1;
        continue;
      }
    }
    if (c === "*" || c === "~" || c === "_") {
      let n = 1;
      while (src[k + n] === c) n++;
      const prev = src[k - 1];
      const next = src[k + n];
      const flank = !(isSpace(prev) && isSpace(next));
      const wordOk = c !== "_" || !(isWord(prev) && isWord(next));
      if (flank && wordOk && (c !== "~" || n === 2)) {
        push();
        if (c === "~") st.s = !st.s;
        else {
          if (n === 1 || n === 3) st.i = !st.i;
          if (n === 2 || n === 3) st.b = !st.b;
          if (n > 3) { text += src.slice(k, k + n); }
        }
        k += n;
        continue;
      }
      text += src.slice(k, k + n);
      k += n;
      continue;
    }
    if (c === "<") {
      const m = /^<(\/?)([a-zA-Z]+)((?:\s+[a-zA-Z-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/.exec(src.slice(k));
      if (m) {
        const close = m[1] === "/";
        const tag = m[2].toLowerCase();
        const known = { u: "u", ins: "u", b: "b", strong: "b", i: "i", em: "i", s: "s", del: "s", strike: "s" };
        if (known[tag]) {
          push();
          st[known[tag]] = !close;
          k += m[0].length;
          continue;
        }
        if (tag === "span") {
          push();
          if (close) {
            const prev = spans.pop();
            if (prev) { st.font = prev.font; st.size = prev.size; }
          } else {
            spans.push({ font: st.font, size: st.size });
            const style = /style\s*=\s*("([^"]*)"|'([^']*)')/i.exec(m[3] || "");
            const css = parseStyleAttr(style ? style[2] ?? style[3] : "");
            if (css.font) st.font = css.font;
            if (css.size) st.size = css.size;
          }
          k += m[0].length;
          continue;
        }
        if (tag === "br") { k += m[0].length; continue; }
      }
    }
    if (c === "[") {
      // [text](url): the text keeps whatever style is on; it is not parsed further.
      const m = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(src.slice(k));
      if (m) {
        emit(m[1].replace(/\\(.)/g, "$1"), { href: m[2] });
        k += m[0].length;
        continue;
      }
    }
    text += c;
    k++;
  }
  push();
  return mergeRuns(runs.map((r) => Object.assign({}, r, { font: r.font && r.font !== FONTS[0] ? r.font : null, size: r.size && r.size !== DEFAULT_SIZE ? r.size : null })));
}

const indentOf = (ws) => Math.floor(ws.replace(/\t/g, "    ").length / 2);
const FILE_RE =/^\s*(!?)\[([^\]]*)\]\(([^)\s]+)\)\s*$/;

/** A whole note into lines. */
export function parse(md) {
  const lines = [];
  for (const raw of String(md ?? "").replace(/\r/g, "").split("\n")) {
    const f = FILE_RE.exec(raw);
    if (f && (f[1] || f[3].startsWith("hgfile:"))) {
      const id = f[3].startsWith("hgfile:") ? f[3].slice(7) : null;
      lines.push({ kind: f[1] ? "image" : "file", indent: 0, runs: [], file: { id, url: id ? null : f[3], name: f[2].replace(/^📎\s*/, "") } });
      continue;
    }
    let m;
    if ((m = /^(\s*)[-*+] \[([ xX])\] ?(.*)$/.exec(raw))) {
      lines.push({ kind: "todo", indent: indentOf(m[1]), checked: m[2] !== " ", runs: parseInline(m[3]) });
    } else if ((m = /^(\s*)[-*+] (.*)$/.exec(raw))) {
      lines.push({ kind: "ul", indent: indentOf(m[1]), runs: parseInline(m[2]) });
    } else if ((m = /^(\s*)(\d{1,9})[.)] (.*)$/.exec(raw))) {
      lines.push({ kind: "ol", indent: indentOf(m[1]), num: Number(m[2]), runs: parseInline(m[3]) });
    } else if ((m = /^(#{1,6}) (.*)$/.exec(raw))) {
      lines.push({ kind: "p", indent: 0, h: Math.min(3, m[1].length), runs: parseInline(m[2]) });
    } else {
      lines.push({ kind: "p", indent: 0, runs: parseInline(raw) });
    }
  }
  return lines;
}


// --- writing -------------------------------------------------------------------

function escapeText(t, atLineStart) {
  let out = t
    .replace(/\\/g, "\\\\")
    .replace(/[*`]/g, (c) => "\\" + c)
    .replace(/~~+/g, (m) => m.replace(/~/g, "\\~"))
    .replace(/<(?=[a-zA-Z/!])/g, "\\<")
    .replace(/\[/g, "\\[")
    .replace(/_/g, (c, at, s) => (isWord(s[at - 1]) && isWord(s[at + 1]) ? c : "\\_"));
  if (atLineStart) out = out.replace(/^(\s*)([-+]|#{1,6}|\d{1,9}[.)])(?= )/, (m0, ws, mark) => ws + (/^\d/.test(mark) ? mark.replace(/([.)])$/, "\\$1") : "\\" + mark));
  return out;
}

// Spaces at the edges of bold/italic/struck text move outside the markers,
// so the markers always touch a letter (Markdown ignores "** x**").
function splitEdges(runs) {
  const out = [];
  for (const r of runs) {
    if (!(r.b || r.i || r.s) || r.code) { out.push(r); continue; }
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(r.text);
    const plain = Object.assign({}, r, { b: false, i: false, s: false });
    if (m[1]) out.push(Object.assign({}, plain, { text: m[1] }));
    if (m[2]) out.push(Object.assign({}, r, { text: m[2] }));
    if (m[3]) out.push(Object.assign({}, plain, { text: m[3] }));
  }
  return out;
}

const spanOf = (r) => {
  const parts = [];
  if (r.font && r.font !== FONTS[0]) parts.push(`font-family: ${r.font}`);
  if (r.size && r.size !== DEFAULT_SIZE) parts.push(`font-size: ${r.size}px`);
  return parts.join("; ");
};

/** Runs into one line's inline Markdown. */
export function serializeInline(runs, atLineStart = false) {
  let out = "";
  const cur = { b: false, i: false, s: false, u: false, span: "" };
  const list = splitEdges(mergeRuns(runs));
  const to = (want) => {
    // Off first, then on: toggles (**, *, ~~) can sit together, tags close and open in order.
    let toggles = "";
    if (cur.s !== want.s) toggles += "~~";
    const b = cur.b !== want.b, i = cur.i !== want.i;
    toggles += b && i ? "***" : b ? "**" : i ? "*" : "";
    const offFirst = (!want.s && cur.s) || (!want.b && cur.b) || (!want.i && cur.i);
    let tags = "";
    if (cur.u && (!want.u || cur.span !== want.span)) { tags += "</u>"; cur.u = false; }
    if (cur.span && cur.span !== want.span) { tags += "</span>"; cur.span = ""; }
    let open = "";
    if (want.span && cur.span !== want.span) { open += `<span style="${want.span}">`; cur.span = want.span; }
    if (want.u && !cur.u) { open += "<u>"; cur.u = true; }
    out += offFirst ? toggles + tags + open : tags + open + toggles;
    cur.b = want.b; cur.i = want.i; cur.s = want.s;
  };
  list.forEach((r, n) => {
    to({ b: !!r.b, i: !!r.i, s: !!r.s, u: !!r.u, span: spanOf(r) });
    let t = r.code && !r.text.includes("`") ? "`" + r.text + "`" : escapeText(r.text, atLineStart && n === 0);
    if (r.href) t = `[${r.code ? r.text.replace(/[\[\]]/g, "\\$&") : t.replace(/\]/g, "\\]")}](${r.href})`;
    out += t;
  });
  to({ b: false, i: false, s: false, u: false, span: "" });
  return out;
}

/** Lines back into the note's Markdown. */
export function serialize(lines) {
  const pad = (n) => "  ".repeat(n || 0);
  return lines.map((l) => {
    switch (l.kind) {
      case "image": return l.file.id ? `![${l.file.name}](hgfile:${l.file.id})` : `![${l.file.name}](${l.file.url})`;
      case "file": return l.file.id ? `[${l.file.name}](hgfile:${l.file.id})` : `[${l.file.name}](${l.file.url})`;
      case "todo": return `${pad(l.indent)}- [${l.checked ? "x" : " "}] ${serializeInline(l.runs)}`;
      case "ul": return `${pad(l.indent)}- ${serializeInline(l.runs)}`;
      case "ol": return `${pad(l.indent)}${l.num || 1}. ${serializeInline(l.runs)}`;
      default: return l.h ? `${"#".repeat(l.h)} ${serializeInline(l.runs)}` : serializeInline(l.runs, true);
    }
  }).join("\n");
}

export const lineText = (l) => (l.runs || []).map((r) => r.text).join("");

/** Numbered lists counted again from 1, per run of numbered lines at the same indent. */
export function renumber(lines) {
  const counters = [];
  for (const l of lines) {
    if (l.kind === "ol") {
      counters.length = l.indent + 1;
      counters[l.indent] = (counters[l.indent] || 0) + 1;
      l.num = counters[l.indent];
    } else if (l.kind === "p" && !lineText(l).trim()) {
      // a blank line ends the list
      counters.length = 0;
    } else if (l.kind !== "ul" && l.kind !== "todo") counters.length = 0;
  }
  return lines;
}


/** The words of a note without any markup: previews, search, notifications. */
export function plainText(md) {
  return parse(md).map((l) => {
    if (l.kind === "image") return `[picture: ${l.file.name}]`;
    if (l.kind === "file") return `[file: ${l.file.name}]`;
    const pre = l.kind === "todo" ? (l.checked ? CHECKED : BOX) + " " : l.kind === "ul" ? BULLET + " " : l.kind === "ol" ? `${l.num}. ` : "";
    return "  ".repeat(l.indent || 0) + pre + lineText(l);
  }).join("\n");
}

// --- the editors' text ---------------------------------------------------------
// In an editor a list line is plain text with its marker in front:
//   "• item", "☐ to do", "☑ done", "1. first", two spaces per indent level.

export function prefixOf(l) {
  const pad = "  ".repeat(l.indent || 0);
  if (l.kind === "ul") return pad + BULLET + " ";
  if (l.kind === "todo") return pad + (l.checked ? CHECKED : BOX) + " ";
  if (l.kind === "ol") return pad + (l.num || 1) + ". ";
  return "";
}

const PREFIX_RE = /^( *)(•|☐|☑|\d{1,9}\.) /;

/** What kind of line an editor line is, from the text in front of it. */
export function kindOf(text) {
  const m = PREFIX_RE.exec(text);
  if (!m) return { kind: "p", indent: 0, prefix: 0 };
  const indent = Math.floor(m[1].length / 2);
  const mark = m[2];
  const prefix = m[0].length;
  if (mark === BULLET) return { kind: "ul", indent, prefix };
  if (mark === BOX || mark === CHECKED) return { kind: "todo", indent, prefix, checked: mark === CHECKED };
  return { kind: "ol", indent, prefix, num: parseInt(mark, 10) };
}

/** Enter at the end of a list line: what the next line starts with ("" ends the list). */
export function continuePrefix(text) {
  const k = kindOf(text);
  if (k.kind === "p") return null;
  if (!text.slice(k.prefix).trim()) return ""; // an empty item: Enter ends the list
  return prefixOf({ kind: k.kind, indent: k.indent, num: (k.num || 0) + 1, checked: false });
}
