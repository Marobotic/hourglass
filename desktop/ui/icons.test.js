import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GLYPHS } from './dom.js';
import { glyphId } from '../../tools/font-glyphs.mjs';

for (const weight of ['Regular', 'Bold']) test(`every icon exists in the bundled Nerd Font ${weight}`, () => {
  const font = readFileSync(new URL(`./fonts/JetBrainsMonoNerdFont-${weight}.ttf`, import.meta.url));
  const missing = Object.entries(GLYPHS).filter(([, text]) => !glyphId(font, text.codePointAt(0)));
  assert.deepEqual(missing.map(([name, text]) => `${name}: U+${text.codePointAt(0).toString(16)}`), []);
  // Control for the cmap reader: a character the font is known to have.
  assert.ok(glyphId(font, 0x2713));
});
