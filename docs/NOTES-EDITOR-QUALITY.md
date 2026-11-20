# Desktop notes quality review — 0.3.3

Branch: `ai/notes-quality`, based on `ai/redesign`. The abandoned Qt fix stays on
`ai/notes-editor-quality` (`906e0d0`); neither branch was merged.

## Reproduction and cause

Used the actual Windows Tauri/WebView2 app on marolaptop through CDP, with an
isolated service/profile and 125% device scaling. No PC builds or UI tests.

Empty editor lines received the class `empty`. The shared kit's `.empty` rule
sets `display: grid`, centered content and `48px 24px` padding. An empty line was
121.5px high and its collapsed selection returned a zero rectangle; its caret
did not render at the normal writing position. Removing that unrelated class
restored normal 25.5px block lines. The placeholder is now absolutely positioned
and appears only on a blank paragraph, away from list markers.

The baseline native caret **was visible mid-word** at 125% scaling. A Chromium
fractional-DPI caret-width failure was not reproduced. The requested accent
`caret-color` rendered clearly mid-word and on an empty line in the 0.3.3 release
binary, so no custom caret was introduced.

## Fixes

- `desktop/ui/css/notes.css:45`: accent caret, preserved whitespace and a
  placeholder that does not participate in text layout.
- `desktop/ui/editor.js:129`: stop applying the kit's empty-state class to lines.
- `desktop/ui/editor.js:142`: preserve selection while normalizing font wrappers;
  combined font/size changes retain both attributes and pending typing format.
- `desktop/ui/editor.js:248`: one undo/redo history covers native typing, Enter,
  list/heading changes, indentation, to-do ticks, paste and attachments. Before
  this change, Enter followed by Ctrl+Z did nothing in the baseline app.
- `desktop/ui/editor.js:283`: keep the caret inside the scrolling page, below
  the sticky toolbar, without a delayed smooth scroll.
- `desktop/ui/editor.js:400`: replace multi-line selections safely on Enter and
  keep a heading when splitting inside its text.
- `desktop/ui/editor.js:477`: leave active IME composition alone and record its
  completed text as one history entry.
- `desktop/ui/editor.js:481`: import supported rich clipboard formatting through
  our own nodes; preserve literal plain text, the existing suffix, and the caret
  before that suffix. Native clipboard round-trips retain headings and to-dos.
- `desktop/ui/pages/note.js:33`: serialize saves, acknowledge only successful
  writes and retain dirty state after failure so Ctrl+S can retry.
- `desktop/ui/pages/note.js:116`: update toolbar state after programmatic edits.
- `desktop/ui/pages/note.js:200`: late Drive info updates image URLs in place
  instead of reloading the document and discarding undo/selection.
- Attachment click/image events are delegated from the editor, so restored undo
  snapshots remain interactive. Editor document listeners are removed on exit.

## Validation

All commands ran on marolaptop:

```text
node --test 'core/test/*.test.js' 'windows/sidecar/*.test.js'
tests 102; pass 102; fail 0; duration_ms 15477.1726

powershell -File windows/sidecar/hourglass-launcher.test.ps1
PASS: delayed window request issued once; Start-Process launches: 0

node tools/notes-editor-webview.mjs
15 passed, 0 failed
```

The WebView checks cover normal empty lines, forward/backward multi-line
selections, heading splitting, shared undo/redo, list continuation/Backspace,
indentation, to-do ticks, formatting and toolbar state, plain/rich/native
clipboard paste, attachment restoration, Japanese IME, cursor scrolling,
late Drive info, failed-save retry and ordered saves.

Also checked the compiled release app without injecting an editor module:
typing after a loaded picture saved successfully, Ctrl+Z restored the original
body on disk, and reload restored the note and picture. Mid-word and empty-line
screenshots were inspected and shown in Metro.

Built with `tools/build-windows-local.ps1` and the existing Inno installer on the
laptop, using the shared `C:\build\target`. Inno reported `Successful compile`.
The build's shell wrapper returned an error because Windows PowerShell classified
npm's stderr warnings as errors; packaging itself completed and produced the
installer below. Existing unused-function and Inno RunOnceId warnings remain.

Installer: `C:\Users\Moaka\Documents\Project Exports\Hourglass\Windows\Hourglass-0.3.3-setup.exe`

SHA-256: `1f1421726f9055cf79a2790c1310ab83c55683f72f1c645be1fbb5190b704e08`

PC install log: `Installation process succeeded.` Installed executable file and
product versions are both `0.3.3`; the app relaunched. The old 0.3.2 setup was
recycled, and the export contains only the current setup and refreshed
`Hourglass-Uninstaller.exe`.

Version metadata is 0.3.3 throughout the desktop package, Cargo and service. CI
workflows now require manual dispatch per the standing build rule. The dev
harness also silences alarms and keeps its course directory in its test profile.

# To-do quality — 0.3.4

Both bugs were seen in installed 0.3.3 and reproduced in the real WebView2 app on marolaptop.

## Causes

1. **Ticked box, no tick.** The tick was a 12px "✓" glyph positioned in em from the line top (`top: .05em`),
   while the box was at `top: .38em` of the line's own font size. The glyph's ink landed on the box's top edge,
   mostly outside it: a small dark mark on the border that reads as an empty box.
2. **Ticked box, plain unstruck text.** When Chromium merges lines (Backspace at a line start, Delete at a line
   end, typing over a selection across lines) it keeps the moved text's old look by wrapping it in
   `<span style="color: …">`. Joined into a checked to-do, that text stayed in the plain colour and unstruck while
   the box was ticked and the Markdown said `- [x]`. Reproduced exactly: `- [x] ` then Backspace at the start of
   `dfsadfsad`. A related gap: the note page saved what it was opened with, so a stale copy from the list (the
   assistant changed the note in the meantime) was shown and could be saved back over the change.

## Fixes

- `desktop/ui/editor.js` `dropLineState()` / `normalize()`: inline colour, background and text-decoration never
  stay inside lines (notes have no text colour; done-ness belongs to the line's `data-c`); emptied wrappers are
  unwrapped and the text re-joined. The paste path uses the same helper.
- `desktop/ui/pages/note.js` `syncFromServer()`: on open and on each data refresh, the server copy replaces the
  shown one while nothing is unsaved (unsaved typing is kept and saved).
- `desktop/ui/css/notes.css` "to-do look" block: the only place the box, tick and done line are styled. Maro's
  chosen design (2026-11-20): 16px rounded square, inset-shadow ring, accent flood, white tick (an SVG image,
  never a font glyph) centred on the box. The editor sets `data-hot` (pointer over the box plus `--hit`) and
  `.ticking` (400ms after a user tick only); both stay out of undo snapshots.
- The tick's draw-in is a left-to-right clip reveal (220ms ease-out after 170ms). A `stroke-dashoffset`
  animation inside the SVG image does not restart: Chromium shares one animation clock per image URL, so only
  the first tick of a session would animate (checked in WebView2).

## Checks

`node tools/notes-editor-webview.mjs` (WebView2 on marolaptop), 23 checks. To-do cases end in one agreement
rule: box, tick, strike, dimming and saved Markdown agree, no inline colour inside a line, and the editor is
pixel-identical to a fresh editor loaded from its own Markdown. Cases: tick, untick, Enter after a checked
to-do, typing at the end/middle, replacing and retyping, Backspace/Delete joins, typing over lines, undo/redo
of a tick, native copy/paste, save, reopen, server reload, assistant edit while open. Pixel checks: a done box
shows a visible tick (any look); the design pin (red centre, white tick centred within 1px, rounded corners,
muted open ring with an empty centre, hover colours); the draw-in timing. Run against the 0.3.3 code, the
tick check fails (tick covers 6% of the box), the Backspace-join check fails on the colour span, and the stale
reopen check fails.

`node --test core/test/*.test.js windows/sidecar/*.test.js desktop/ui/*.test.js`: 104 pass, including every
icon in `GLYPHS` present in the bundled Nerd Font (Regular and Bold). Icons and fonts are unchanged since 0.3.2.

## Build and install

Built on marolaptop with `tools/build-windows-local.ps1` from `5768f43` (shared `C:\build\target`); Inno reported
`Successful compile`. The script stops on npm's stderr warnings if PowerShell redirects them (`*>`), so run it with
cmd-level redirection (`cmd /c "powershell -File tools\build-windows-local.ps1 > log 2>&1"`).

Installer: `C:\Users\Moaka\Documents\Project Exports\Hourglass\Windows\Hourglass-0.3.4-setup.exe`

SHA-256: `3e0ff4b5ef1f447b3e5f5b479515cf1aa73cc20a29b51af8a774a7ee494554c2`

PC install (`/VERYSILENT`): `Installation process succeeded.`; window file/product version and service
`VERSION` are 0.3.4. A silent install does not relaunch (`skipifsilent`), so the service was started again from
its sign-in shortcut. Screenshot of the 0.3.4 window: `Project Exports\Hourglass\Windows\shots\hourglass-0.3.4-todos.png`.
