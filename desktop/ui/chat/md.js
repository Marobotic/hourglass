// Small safe markdown renderer for Metro transcripts.
// Plain JS, safe escaping, streaming friendly, light syntax highlighting.

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ESC_MAP[c]);
}

const LANG_MAP = {
  js: 'js', javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
  ts: 'ts', typescript: 'ts', tsx: 'ts',
  json: 'json',
  rust: 'rust', rs: 'rust',
  python: 'python', py: 'python',
  powershell: 'powershell', ps: 'powershell', ps1: 'powershell',
  bash: 'bash', sh: 'bash', zsh: 'bash', shell: 'bash',
  css: 'css', scss: 'css',
  html: 'html', xml: 'html', svg: 'html',
  diff: 'diff', patch: 'diff'
};

const KEYWORDS = {
  js: 'const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|default|new|this|typeof|instanceof|class|extends|super|import|export|from|as|await|async|try|catch|finally|throw|yield|null|undefined|true|false|void|delete',
  ts: 'const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|default|new|this|typeof|instanceof|class|extends|super|import|export|from|as|await|async|try|catch|finally|throw|yield|null|undefined|true|false|void|delete|interface|type|enum|implements|declare|readonly|public|private|protected|static|abstract|any|never|unknown|string|number|boolean',
  json: 'true|false|null',
  rust: 'fn|let|mut|pub|struct|enum|impl|trait|match|if|else|for|while|loop|return|self|Self|use|mod|crate|const|type|where|async|await|unsafe|true|false|ref|move|dyn|extern|static|box|continue|break|as|in',
  python: 'def|class|return|if|elif|else|for|while|try|except|finally|raise|import|from|as|with|yield|lambda|pass|break|continue|None|True|False|self|async|await|and|or|not|in|is|global|nonlocal|assert|del',
  powershell: 'function|filter|param|if|else|elseif|for|foreach|in|while|do|until|switch|return|break|continue|try|catch|finally|throw|trap|process|begin|end|exit',
  bash: 'if|then|else|elif|fi|for|in|do|done|while|until|case|esac|function|return|exit|local|export|readonly|select|time|echo',
  css: 'important|media|import|keyframes|font-face|supports|root|from|to'
};

function highlightDiff(code) {
  const lines = code.split('\n');
  return lines.map(line => {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      return `<span class="hl-diff-add">${esc(line)}</span>`;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      return `<span class="hl-diff-del">${esc(line)}</span>`;
    }
    if (line.startsWith('@@')) {
      return `<span class="hl-diff-hunk">${esc(line)}</span>`;
    }
    return esc(line);
  }).join('\n');
}

function highlightHtml(code) {
  const re = /(?<comment><!--[\s\S]*?-->)|(?<tag><\/?[a-zA-Z0-9:-]+)|(?<attr>\b[a-zA-Z0-9:-]+(?==))|(?<string>"[^"]*"|'[^']*')/g;
  let out = '', last = 0, m;
  while ((m = re.exec(code)) !== null) {
    if (m.index > last) out += esc(code.slice(last, m.index));
    const g = m.groups;
    if (g.comment) out += `<span class="hl-comment">${esc(m[0])}</span>`;
    else if (g.tag) out += `<span class="hl-tag">${esc(m[0])}</span>`;
    else if (g.attr) out += `<span class="hl-attr">${esc(m[0])}</span>`;
    else if (g.string) out += `<span class="hl-string">${esc(m[0])}</span>`;
    else out += esc(m[0]);
    last = re.lastIndex;
  }
  if (last < code.length) out += esc(code.slice(last));
  return out;
}

function highlightCode(code, rawLang) {
  const lang = LANG_MAP[rawLang?.toLowerCase()] || '';
  if (!lang) return esc(code);
  if (lang === 'diff') return highlightDiff(code);
  if (lang === 'html') return highlightHtml(code);

  const isHashComment = ['python', 'bash', 'powershell'].includes(lang);
  const commentPat = isHashComment ? '#[^\n]*' : '\\/\\/[^\n]*|\\/\\*[\\s\\S]*?\\*\\/';
  const strPat = '"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'|`(?:[^`\\\\]|\\\\.)*`';
  const kw = KEYWORDS[lang];
  const kwPat = kw ? `\\b(?:${kw})\\b` : null;
  const numPat = '\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b|0x[0-9a-fA-F]+\\b';

  const parts = [`(?<comment>${commentPat})`, `(?<string>${strPat})`];
  if (kwPat) parts.push(`(?<keyword>${kwPat})`);
  parts.push(`(?<number>${numPat})`);

  const re = new RegExp(parts.join('|'), 'g');
  let out = '', last = 0, m;
  while ((m = re.exec(code)) !== null) {
    if (m.index > last) out += esc(code.slice(last, m.index));
    const g = m.groups;
    if (g.comment) out += `<span class="hl-comment">${esc(m[0])}</span>`;
    else if (g.string) out += `<span class="hl-string">${esc(m[0])}</span>`;
    else if (g.keyword) out += `<span class="hl-keyword">${esc(m[0])}</span>`;
    else if (g.number) out += `<span class="hl-number">${esc(m[0])}</span>`;
    else out += esc(m[0]);
    last = re.lastIndex;
  }
  if (last < code.length) out += esc(code.slice(last));
  return out;
}

export function isSafeLink(url) {
  if (!url) return false;
  const u = url.trim();
  // Web links only: a file:// link would be opened by the system handler, which runs executables.
  return /^https?:\/\//i.test(u);
}

export function isSafeImageUrl(url) {
  if (!url) return false;
  const u = url.trim();
  if (/^javascript:/i.test(u)) return false;
  // Raster data images only (an SVG can carry script if it is ever opened outside an <img>).
  if (/^(https?:\/\/|data:image\/(png|jpe?g|gif|webp|bmp|avif);)/i.test(u)) return true;
  // Local drive paths only. UNC paths (\\host\share, file://host/) make Windows connect to that host over SMB and
  // send the user's login hash, so a model's output could leak credentials just by showing an image.
  if (/^file:\/\/\/[a-zA-Z]:[\\/]/i.test(u)) return true;
  if (/^[a-zA-Z]:[\\/]/.test(u)) return true;
  if (/^\/(?![\\/])/.test(u)) return true; // but not //host/share
  return false;
}

export function resolveImageSrc(url) {
  const u = (url || '').trim();
  if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/|file:\/\/)/i.test(u)) {
    if (typeof window !== 'undefined' && window.__TAURI__?.core?.convertFileSrc) {
      try {
        let p = u;
        if (/^file:\/\/\/?/i.test(p)) {
          p = decodeURIComponent(p.replace(/^file:\/\/\/?/i, ''));
        }
        return window.__TAURI__.core.convertFileSrc(p);
      } catch {
        return u;
      }
    }
  }
  return u;
}

const INLINE_RE_SRC = '(?<code>`[^`\\n]+`)' +
  '|(?<image>!\\[(?<imgAlt>[^\\]\\n]*)\\]\\((?<imgSrc>[^)\\n]+)\\))' +
  '|(?<link>\\[(?<linkText>[^\\]\\n]+)\\]\\((?<linkHref>[^)\\n]+)\\))' +
  '|(?<boldItalic>\\*{3}(?<bi1>[^*\\n]+)\\*{3}|_{3}(?<bi2>[^_\\n]+)_{3})' +
  '|(?<bold>\\*{2}(?<b1>[^*\\n]+)\\*{2}|_{2}(?<b2>[^_\\n]+)_{2})' +
  '|(?<strike>~~(?<strikeText>[^~\\n]+)~~)' +
  '|(?<italic>\\*(?<i1>[^*\\s\\n][^*\\n]*)\\*|_(?<i2>[^_\\s\\n][^_\\n]*)_)' +
  '|(?<autolink>https?:\\/\\/[^\\s<>()"\']+(?<![.,:;!?]))';

export function renderInline(s) {
  if (s == null) return '';
  const str = String(s);
  const re = new RegExp(INLINE_RE_SRC, 'g');
  let out = '', last = 0, m;
  while ((m = re.exec(str)) !== null) {
    if (m.index > last) out += esc(str.slice(last, m.index));
    const g = m.groups;
    if (g.code) {
      out += `<code>${esc(g.code.slice(1, -1))}</code>`;
    } else if (g.image) {
      const alt = g.imgAlt || '', rawUrl = (g.imgSrc || '').trim();
      if (isSafeImageUrl(rawUrl)) {
        const src = resolveImageSrc(rawUrl);
        out += `<img class="md-image" alt="${esc(alt)}" src="${esc(src)}" data-src="${esc(rawUrl)}" loading="lazy">`;
      } else {
        out += esc(m[0]);
      }
    } else if (g.link) {
      const text = g.linkText || '', rawUrl = (g.linkHref || '').trim();
      if (isSafeLink(rawUrl)) {
        out += `<a href="${esc(rawUrl)}" class="md-link" data-external="true" target="_blank" rel="noreferrer">${renderInline(text)}</a>`;
      } else {
        out += renderInline(text);
      }
    } else if (g.boldItalic) {
      out += `<strong><em>${renderInline(g.bi1 || g.bi2)}</em></strong>`;
    } else if (g.bold) {
      out += `<strong>${renderInline(g.b1 || g.b2)}</strong>`;
    } else if (g.strike) {
      out += `<del>${renderInline(g.strikeText)}</del>`;
    } else if (g.italic) {
      out += `<em>${renderInline(g.i1 || g.i2)}</em>`;
    } else if (g.autolink) {
      out += `<a href="${esc(g.autolink)}" class="md-link" data-external="true" target="_blank" rel="noreferrer">${esc(g.autolink)}</a>`;
    }
    last = re.lastIndex;
  }
  if (last < str.length) out += esc(str.slice(last));
  return out;
}

const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const LIST_ITEM_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

function parseTableCells(row) {
  return row.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
}

function parseTableAlignments(sepRow) {
  return parseTableCells(sepRow).map(col => {
    const left = col.startsWith(':'), right = col.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    if (left) return 'left';
    return '';
  });
}

export function renderMarkdown(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    // 1. Fenced code block (handles streaming unclosed fences gracefully)
    const fenceMatch = /^```([a-zA-Z0-9_+-]*)/.exec(line);
    if (fenceMatch) {
      const lang = fenceMatch[1].trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i++]);
      }
      if (i < lines.length) i++; // consume closing fence if present
      const rawCode = codeLines.join('\n');
      const highlighted = highlightCode(rawCode, lang);
      const langBadge = lang ? `<span class="code-lang">${esc(lang)}</span>` : '';
      const codeClass = lang ? ` class="language-${esc(lang)}"` : '';
      out.push(
        `<pre class="code-block">${langBadge}<button type="button" class="code-copy" data-action="copy-code" data-code="${esc(rawCode)}">Copy</button><code${codeClass}>${highlighted}</code></pre>`
      );
      continue;
    }

    // 2. GitHub table (horizontal scroll if wide via .md-table)
    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1])) {
      const headers = parseTableCells(line);
      const aligns = parseTableAlignments(lines[i + 1]);
      i += 2;

      let tableHtml = '<table class="md-table"><thead><tr>';
      headers.forEach((h, idx) => {
        const align = aligns[idx] ? ` style="text-align:${aligns[idx]}"` : '';
        tableHtml += `<th${align}>${renderInline(h)}</th>`;
      });
      tableHtml += '</tr></thead><tbody>';

      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        const cells = parseTableCells(lines[i++]);
        tableHtml += '<tr>';
        headers.forEach((_, idx) => {
          const val = cells[idx] ?? '';
          const align = aligns[idx] ? ` style="text-align:${aligns[idx]}"` : '';
          tableHtml += `<td${align}>${renderInline(val)}</td>`;
        });
        tableHtml += '</tr>';
      }
      tableHtml += '</tbody></table>';
      out.push(tableHtml);
      continue;
    }

    // 3. Headings (# H1 to ###### H6)
    const hd = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hd) {
      const level = hd[1].length;
      out.push(`<h${level}>${renderInline(hd[2])}</h${level}>`);
      i++;
      continue;
    }

    // 4. Horizontal rules (---, ***, ___)
    if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // 5. Blockquotes (> ...)
    if (/^>\s?/.test(line)) {
      const q = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        q.push(lines[i++].replace(/^>\s?/, ''));
      }
      out.push(`<blockquote>${renderMarkdown(q.join('\n'))}</blockquote>`);
      continue;
    }

    // 6. Ordered, unordered, nested and task lists
    if (LIST_ITEM_RE.test(line)) {
      const stack = [];
      // An ordered list keeps the number it starts at (a list split by a paragraph goes on at 7., not 1.), and a list
      // that reaches three digits says so: its markers need more room on the left (card 20005209). Both are known
      // only once the list closes, so its opening tag holds a slot filled in at the end.
      const olAttrs = [];
      const close = (top) => {
        if (top.type === 'ol') {
          const digits = String(top.start + top.count - 1).length;
          olAttrs[top.slot] = `${top.start !== 1 ? ` start="${top.start}"` : ''}${digits >= 3 ? ` data-digits="${Math.min(digits, 6)}"` : ''}`;
        }
        return `</li></${top.type}>`;
      };
      let listHtml = '';

      while (i < lines.length && (LIST_ITEM_RE.test(lines[i]) || (stack.length > 0 && /^\s+/.test(lines[i]) && lines[i].trim()))) {
        const currLine = lines[i];
        const m = LIST_ITEM_RE.exec(currLine);

        if (!m) {
          listHtml += '<br>' + renderInline(currLine.trim());
          i++;
          continue;
        }

        const indent = m[1].length;
        const isOrdered = /^\d/.test(m[2]);
        const listType = isOrdered ? 'ol' : 'ul';
        const rawContent = m[3];
        i++;

        // Parse task list checkbox: [ ] or [x]
        const taskMatch = /^\[([ xX])\]\s+(.*)$/.exec(rawContent);
        const isTask = !!taskMatch;
        const isChecked = isTask && taskMatch[1].toLowerCase() === 'x';
        const itemText = isTask ? taskMatch[2] : rawContent;
        const liClass = isTask ? (isChecked ? 'task done' : 'task') : '';
        const liClassAttr = liClass ? ` class="${liClass}"` : '';

        const itemContent = isTask
          ? `<input type="checkbox"${isChecked ? ' checked' : ''} disabled> <span>${renderInline(itemText)}</span>`
          : renderInline(itemText);

        const number = isOrdered ? parseInt(m[2], 10) : 0;
        const open = (type) => {
          const entry = { indent, type, start: number, count: 1, slot: olAttrs.length };
          stack.push(entry);
          if (type !== 'ol') return '<ul>';
          olAttrs.push('');
          return `<ol\u0000${entry.slot}\u0000>`;
        };

        if (stack.length === 0 || indent > stack[stack.length - 1].indent) {
          listHtml += `${open(listType)}<li${liClassAttr}>${itemContent}`;
        } else {
          while (stack.length > 1 && indent < stack[stack.length - 1].indent) listHtml += close(stack.pop());
          if (stack[stack.length - 1].type !== listType) {
            listHtml += close(stack.pop());
            listHtml += open(listType);
          } else {
            stack[stack.length - 1].count++;
            listHtml += '</li>';
          }
          listHtml += `<li${liClassAttr}>${itemContent}`;
        }
      }

      while (stack.length > 0) listHtml += close(stack.pop());
      listHtml = listHtml.replace(/\u0000(\d+)\u0000/g, (_, slot) => olAttrs[Number(slot)]);
      out.push(listHtml);
      continue;
    }

    // 7. Regular paragraph
    const p = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/.test(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i]) &&
      !LIST_ITEM_RE.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]))
    ) {
      p.push(lines[i++]);
    }
    if (p.length) {
      out.push(`<p>${p.map(renderInline).join('<br>')}</p>`);
    } else {
      i++;
    }
  }

  return out.join('\n');
}

if (typeof window !== 'undefined') {
  window.renderMarkdown = renderMarkdown;
}
if (typeof globalThis !== 'undefined') {
  globalThis.renderMarkdown = renderMarkdown;
}
