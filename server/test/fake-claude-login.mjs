#!/usr/bin/env node
// Harmless stand-in for Claude Code in the Claude login status-flow test.
if (process.argv.includes("setup-token")) {
  process.stdout.write("https://claude.com/oauth/authorize?code=true&state=fake-state-for-tests\nPaste code here if prompted >\n");
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", () => process.stdout.write("OAuth error: That code wasn't accepted. It may be incomplete, expired, already used, or from an earlier sign-in attempt.\nPress Enter to retry.\n"));
} else if (process.argv.includes("-p")) {
  setTimeout(() => { process.stdout.write("OK\n"); process.exit(0); }, 500);
} else {
  process.exit(0);
}
