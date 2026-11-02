// Parse the official Claude Code setup-token terminal stream.
export function stripTerminalSequences(input) {
  return String(input)
    // OSC sequences (including hyperlinks), terminated by BEL or ST.
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
    // CSI, DCS, SOS, PM and APC sequences.
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[P_^X][\s\S]*?\x1b\\/g, "")
    // Remaining two-byte escapes and C1 controls.
    .replace(/\x1b[@-_]/g, "")
    .replace(/[\x80-\x9f]/g, "");
}

export function parseClaudeLoginUrl(output) {
  const source = String(output);
  // OSC 8 contains the real target URL; remove OSC only after inspecting its
  // payload. The CLI is run at 4000 columns, so leave line boundaries intact:
  // joining lines can append the next prompt or instruction to a URL.
  const hyperlink = source.match(/\x1b\]8;[^;]*;(https:\/\/(?:claude\.com|claude\.ai)\/[^\x07\x1b]+)(?:\x07|\x1b\\)/i)?.[1];
  const candidate = hyperlink || stripTerminalSequences(source);
  return candidate.match(/https:\/\/(?:claude\.com|claude\.ai)\/(?:cai\/)?oauth\/authorize\?[^\s"'<>\x1b\x07]+/i)?.[0] || null;
}

export function parseClaudeSetupToken(output) {
  return stripTerminalSequences(output).match(/sk-ant-oat\d+-[A-Za-z0-9_-]+/)?.[0] || null;
}

// The one paste field accepts Claude's code, callback URL, or a local
// `claude setup-token` result. Preserve the #state suffix required by Claude.
export function detectClaudeLoginPaste(input) {
  const value = String(input || "").trim();
  const token = value.match(/sk-ant-oat\d+-[A-Za-z0-9_-]+/)?.[0];
  if (token) return { kind: "token", value: token };
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (code && state) return { kind: "code", value: `${code}#${state}` };
      if (code) return { kind: "code", value: code };
    } catch {}
    return { kind: "invalid", value: "" };
  }
  const code = value.replace(/\s+/g, "");
  return code ? { kind: "code", value: code } : { kind: "invalid", value: "" };
}

export function redactClaudeSecrets(text) {
  return String(text || "")
    .replace(/sk-ant-oat\d+-[A-Za-z0-9_-]+/g, (s) => `${s.slice(0, 6)}…[redacted]`)
    .replace(/([?&#]state=)[^&\s]+/gi, "$1[redacted]")
    .replace(/([?&#]code=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\b[A-Za-z0-9_-]{1,}#[A-Za-z0-9_-]{1,}\b/g, (s) => `${s.slice(0, 6)}…[redacted]`);
}

export function claudeCliExcerpt(text) {
  return redactClaudeSecrets(stripTerminalSequences(text).replace(/\r/g, "\n").split("\n").filter(Boolean).slice(-5).join("\n")).slice(-700);
}

export function mapClaudeLoginError(output) {
  const text = stripTerminalSequences(output).replace(/\r/g, "\n");
  const match = text.match(/(?:that code wasn['’]t accepted|invalid(?: or expired)? (?:oauth )?code|authorization code (?:is )?invalid|code has expired|oauth token exchange failed|failed to exchange (?:the )?code)[^\n]*/i);
  if (!match) return null;
  return /(?:code (?:has )?expired|expired code)/i.test(match[0])
    ? "That code expired. Start sign-in again and copy the latest code from claude.com."
    : "That code wasn't accepted. Start sign-in again and copy the whole code from claude.com.";
}
