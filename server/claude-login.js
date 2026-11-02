// Parse the official Claude Code setup-token terminal stream.
export function stripTerminalSequences(input) {
  return String(input)
    // OSC sequences (including hyperlinks), terminated by BEL or ST.
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, " ")
    // CSI, DCS, SOS, PM and APC sequences.
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, " ")
    .replace(/\x1b[P_^X][\s\S]*?\x1b\\/g, " ")
    // Remaining two-byte escapes and C1 controls.
    .replace(/\x1b[@-_]/g, " ")
    .replace(/[\x80-\x9f]/g, " ");
}

export function parseClaudeLoginUrl(output) {
  const source = String(output);
  // OSC 8 contains the real target URL; remove OSC only after inspecting its
  // payload. For ordinary output, join terminal-wrapped URL lines.
  const hyperlink = source.match(/\x1b\]8;[^;]*;(https:\/\/(?:claude\.com|claude\.ai)\/[^\x07\x1b]+)(?:\x07|\x1b\\)/i)?.[1];
  const candidate = hyperlink || stripTerminalSequences(source).replace(/[\r\n]+(?=[A-Za-z0-9%._~!$&'()*+,;=:@/?#-])/g, "");
  return candidate.match(/https:\/\/(?:claude\.com|claude\.ai)\/(?:cai\/)?oauth\/authorize\?[^\s"'<>\x1b\x07]+/i)?.[0] || null;
}

export function parseClaudeSetupToken(output) {
  const compact = stripTerminalSequences(output).replace(/\s+/g, "");
  return compact.match(/sk-ant-oat\d+-[A-Za-z0-9_-]+/)?.[0] || null;
}

export function mapClaudeLoginError(output) {
  const text = stripTerminalSequences(output).replace(/\r/g, "\n");
  const match = text.match(/(?:invalid(?: or expired)? (?:oauth )?code|authorization code (?:is )?invalid|code has expired|oauth token exchange failed|failed to exchange (?:the )?code)[^\n]*/i);
  if (!match) return null;
  return /expired/i.test(match[0])
    ? "That code expired. Start sign-in again and copy the latest code from claude.com."
    : "That code wasn't accepted. Start sign-in again and copy the whole code from claude.com.";
}
