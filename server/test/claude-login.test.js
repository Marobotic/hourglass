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

test("plain wrapped URL and OSC hyperlink parse after terminal cleanup", () => {
  const url = "https://claude.com/cai/oauth/authorize?code=true&state=REDACTED";
  assert.equal(parseClaudeLoginUrl(`Browser URL:\n${url.slice(0, 32)}\r\n${url.slice(32)}`), url);
  assert.equal(parseClaudeLoginUrl(`\x1b]8;;${url}\x07click\x1b]8;;\x07`), url);
});

test("token parser accepts short token suffixes after terminal whitespace", () => {
  assert.equal(parseClaudeSetupToken("token: sk-ant-oat01-aB\nC_d-9"), "sk-ant-oat01-aBC_d-9");
});

test("error mapping requires actual auth failure wording", () => {
  assert.equal(mapClaudeLoginError("No error occurred; token setup continues."), null);
  assert.match(mapClaudeLoginError("Invalid code. Please try again."), /wasn't accepted/);
  assert.match(mapClaudeLoginError("The code has expired"), /expired/);
});
