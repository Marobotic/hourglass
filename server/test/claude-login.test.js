import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapClaudeLoginError, parseClaudeLoginUrl, parseClaudeSetupToken, stripTerminalSequences } from "../claude-login.js";

for (const version of ["2.1.303", "2.1.316"]) {
  test(`Claude ${version} captured setup-token output contains a usable link`, () => {
    const raw = readFileSync(join(import.meta.dirname, "fixtures", `claude-${version}.raw`), "utf8");
    assert.match(raw, /REDACTED/);
    assert.doesNotMatch(raw, /state=[A-Za-z0-9_-]{15,}/);
    assert.match(parseClaudeLoginUrl(raw), /^https:\/\/claude\.com\/cai\/oauth\/authorize\?/);
    assert.match(stripTerminalSequences(raw), /Paste\s*code\s*here\s*if\s*prompted/);
  });
}

test("plain URL stops before the next prompt and OSC hyperlink parses", () => {
  const url = "https://claude.com/cai/oauth/authorize?code=true&state=REDACTED";
  assert.equal(parseClaudeLoginUrl(`${url}\r\nPaste code here if prompted >`), url);
  assert.equal(parseClaudeLoginUrl(`\x1b]8;;${url}\x07click\x1b]8;;\x07`), url);
});

test("token stops before following instructions or ANSI styled next-line text", () => {
  assert.equal(parseClaudeSetupToken("sk-ant-oat01-aB_C-9\nStore this token securely."), "sk-ant-oat01-aB_C-9");
  assert.equal(parseClaudeSetupToken("sk-ant-oat01-aB_C-9\r\n\x1b[38;5;246mStore this token securely."), "sk-ant-oat01-aB_C-9");
});

test("URL on its own line stops before ordinary next-line text", () => {
  const url = "https://claude.com/cai/oauth/authorize?state=abc";
  assert.equal(parseClaudeLoginUrl(`${url}\nPaste code here if prompted >`), url);
});

test("error mapping requires actual auth failure wording", () => {
  assert.equal(mapClaudeLoginError("No error occurred; token setup continues."), null);
  assert.match(mapClaudeLoginError("Invalid code. Please try again."), /wasn't accepted/);
  assert.match(mapClaudeLoginError("The code has expired"), /expired/);
});
