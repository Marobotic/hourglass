// What the window needs from the OS: file pickers, the clipboard, opening links and files. Tauri plugins in the
// app; harmless fallbacks in a plain browser (dev).
const T = globalThis.__TAURI__;

// Paths of the chosen files (an array), or [] when cancelled.
export async function pickFiles({ title = 'Choose a file', multiple = false, filters, directory = false } = {}) {
  if (!T?.dialog) return [];
  const r = await T.dialog.open({ title, multiple, directory, filters });
  if (!r) return [];
  return (Array.isArray(r) ? r : [r]).map((p) => (typeof p === 'string' ? p : p.path));
}
export async function pickFolder(title = 'Choose a folder') { return (await pickFiles({ title, directory: true }))[0] || null; }
export async function savePath({ title = 'Save as', defaultPath, filters } = {}) {
  if (!T?.dialog) return null;
  return (await T.dialog.save({ title, defaultPath, filters })) || null;
}

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const t = document.createElement('textarea');
  t.value = text;
  document.body.append(t);
  t.select();
  const ok = document.execCommand('copy');
  t.remove();
  return ok;
}

export async function openUrl(url) {
  if (T?.opener?.openUrl) return T.opener.openUrl(url);
  window.open(url, '_blank', 'noopener');
}
export async function openPath(path) {
  if (T?.opener?.openPath) return T.opener.openPath(path);
}
export async function reveal(path) {
  if (T?.opener?.revealItemInDir) return T.opener.revealItemInDir(path);
}

// Links inside the window open in the browser, never inside it.
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a[href]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (/^(https?:|mailto:)/.test(href)) { e.preventDefault(); openUrl(href); }
});
