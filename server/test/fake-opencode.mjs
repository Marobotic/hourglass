// Stands in for `opencode run --format json` in the assistant tests: reads the
// prompt from stdin, calls the Hourglass MCP server named in ./opencode.json,
// and prints the JSON events opencode prints. Every call is appended to
// ./calls.jsonl so a test can check what it was given.
import { appendFileSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args[0] === "models" && args[1] === "opencode") {
  process.stdout.write(readFileSync(new URL("./fixtures/opencode-models-opencode.txt", import.meta.url), "utf8"));
  process.exit(0);
}
const model = args[args.indexOf("-m") + 1];
const session = args.includes("--session") ? args[args.indexOf("--session") + 1] : null;
let prompt = "";
for await (const c of process.stdin) prompt += c;
appendFileSync("calls.jsonl", JSON.stringify({ args, model, session, prompt, home: process.env.HOME, env: process.env }) + "\n");

const sessionID = session || "ses_fake1";
const emit = (e) => process.stdout.write(JSON.stringify({ sessionID, ...e }) + "\n");

// "fake/stuck" says nothing at all, like a free model that stalls.
if (model === "fake/stuck") {
  setInterval(() => {}, 1000);
  await new Promise(() => {});
}

if (model === "opencode/big-pickle") {
  emit({ type: "error", error: { name: "AI_APICallError", data: { message: "AI_APICallError: Free usage limit reached" } } });
  process.exit(1);
}

// The first model in the list "refuses", like a free model that is down.
if (model === "fake/down") {
  emit({ type: "error", error: { name: "APIError", data: { message: "503 Service Unavailable" } } });
  process.exit(1);
}

if (prompt.includes("DANGEROUS WORKSPACE TEST")) {
  const dir = join(process.cwd(), "files");
  const first = readdirSync(dir).find((name) => !name.startsWith("."));
  if (first) writeFileSync(join(dir, first), "edited by fake CLI\n");
  else writeFileSync(join(dir, "created.txt"), "created by fake CLI\n");
}

const said = prompt.split("The user says:\n")[1] || "";
const selectedTool = said.includes("READ_MCP_TEST") ? "get_settings" : said.includes("RISK_MCP_TEST") ? "remove_alarm" : "add_note";
const selectedArgs = selectedTool === "add_note" ? { title: "From assistant", body: said } : selectedTool === "remove_alarm" ? { alarm_id: "missing-mode-test-alarm" } : {};
const config = JSON.parse(readFileSync("opencode.json", "utf8"));
const client = new Client({ name: "fake-opencode", version: "1" });
await client.connect(new StreamableHTTPClientTransport(new URL(config.mcp.hourglass.url)));
emit({ type: "step_start" });
emit({ type: "text", part: { text: "Let me add that." } });
emit({ type: "tool_use", part: { id: "p1", callID: "c1", tool: `hourglass_${selectedTool}`, state: { status: "running", input: selectedArgs } } });
const r = await client.callTool({ name: selectedTool, arguments: selectedArgs });
emit({ type: "tool_use", part: { id: "p1", callID: "c1", tool: `hourglass_${selectedTool}`, state: { status: r.isError ? "error" : "completed", input: selectedArgs, output: r } } });
emit({ type: "step_start" });
emit({ type: "text", part: { text: "Done." } });
await client.close();
