import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claudeCliExcerpt, detectClaudeLoginPaste, mapClaudeLoginError, parseClaudeLoginUrl, parseClaudeSetupToken, redactClaudeSecrets, stripTerminalSequences } from "../claude-login.js";

test("paste field accepts code, code with state, callback URL, and setup-token", () => {
  assert.deepEqual(detectClaudeLoginPaste(" fake-code-123 "), { kind: "code", value: "fake-code-123" });
  assert.deepEqual(detectClaudeLoginPaste("abc123#state-456"), { kind: "code", value: "abc123#state-456" });
  assert.deepEqual(detectClaudeLoginPaste("https://platform.claude.com/oauth/code/callback?code=abc123&state=state456"), { kind: "code", value: "abc123#state456" });
  assert.deepEqual(detectClaudeLoginPaste("sk-ant-oat01-LOCAL_FAKE_TOKEN"), { kind: "token", value: "sk-ant-oat01-LOCAL_FAKE_TOKEN" });
});

test("CLI error excerpts redact tokens, codes, and oauth state", () => {
  const out = claudeCliExcerpt("OAuth failed\nsk-ant-oat01-LOCAL_SECRET\n?state=verylongsecretstate\nfakecode123#fakestate");
  assert.match(out, /sk-ant…\[redacted\]/);
  assert.doesNotMatch(out, /LOCAL_SECRET|verylongsecretstate|fakecode123|fakestate/);
  assert.match(redactClaudeSecrets("sk-ant-oat01-abc"), /^sk-ant…\[redacted\]$/);
});

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
  assert.match(mapClaudeLoginError("OAuth error: That code wasn't accepted. It may be incomplete, expired, already used, or from an earlier sign-in attempt."), /wasn't accepted/);
  assert.match(mapClaudeLoginError("The code has expired"), /expired/);
});
