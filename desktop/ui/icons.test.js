import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { hasIcon } from './dom.js';

// Every icon name the window asks for has a drawing (dom.js): icon('x'), icon: 'x', glyph: 'x' and the pages' table.
test('every icon the window uses has a drawing', () => {
  const dir = new URL('./', import.meta.url);
  const files = ['app.js', 'kit.js', 'editor.js', 'uploads.js', ...readdirSync(new URL('pages/', dir)).map((f) => 'pages/' + f), ...readdirSync(new URL('chat/', dir)).map((f) => 'chat/' + f)];
  const names = new Set();
  for (const f of files) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/\bicon\(\s*'([a-z-]+)'|\b(?:icon|glyph|ic):\s*'([a-z-]+)'/g)) names.add(m[1] || m[2]);
  }
  assert.ok(names.size > 40, `found only ${names.size} icon names`);
  assert.deepEqual([...names].filter((n) => !hasIcon(n)), []);
});
