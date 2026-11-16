// Builds the window into dist/: the page, styles, fonts and assets as files, the scripts bundled into app.js.
import { cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

const dev = process.argv.includes('--dev');
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
for (const f of ['index.html', 'css', 'fonts', 'assets']) cpSync(`ui/${f}`, `dist/${f}`, { recursive: true });
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
await build({
  entryPoints: ['ui/app.js'], outfile: 'dist/app.js', bundle: true, format: 'esm', target: 'es2022',
  sourcemap: dev ? 'inline' : false,
  define: { 'globalThis.HOURGLASS_VERSION': JSON.stringify(version) },
});
console.log(`built dist/ (v${version}${dev ? ', dev' : ''})`);
