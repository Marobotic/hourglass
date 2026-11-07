#!/usr/bin/env node
// Harmless stand-in for Claude Code in the Claude login status-flow test.
// Like the real CLI, a write that carries more than Enter is a paste: Enter
// inside it is text, so the code is only submitted by an Enter of its own.
if (process.argv.includes("setup-token")) {
  process.stdout.write("https://claude.com/oauth/authorize?code=true&state=fake-state-for-tests\nPaste code here if prompted >\n");
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  let input = "";
  process.stdin.on("data", (chunk) => {
    if (chunk !== "\r" && chunk !== "\n") { input += chunk.replace(/\x1b\[20[01]~/g, ""); return; }
    const [code, state] = input.split("#");
    input = "";
    process.stdout.write(code && state
      ? "OAuth error: That code wasn't accepted. It may be incomplete, expired, already used, or from an earlier sign-in attempt.\nPress Enter to retry.\n"
      : "OAuth error: Invalid code. Please make sure the full code was copied\nPress Enter to retry.\n");
  });
} else if (process.argv.includes("-p")) {
  setTimeout(() => { process.stdout.write("OK\n"); process.exit(0); }, 500);
} else {
  process.exit(0);
}
