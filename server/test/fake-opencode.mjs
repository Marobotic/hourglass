// Stands in for `opencode run --format json` in the assistant tests: reads the
// prompt from stdin, calls the Hourglass MCP server named in ./opencode.json,
// and prints the JSON events opencode prints. Every call is appended to
// ./calls.jsonl so a test can check what it was given.
import { appendFileSync, readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const args = process.argv.slice(2);
const model = args[args.indexOf("-m") + 1];
const session = args.includes("--session") ? args[args.indexOf("--session") + 1] : null;
let prompt = "";
for await (const c of process.stdin) prompt += c;
appendFileSync("calls.jsonl", JSON.stringify({ args, model, session, prompt, home: process.env.HOME }) + "\n");

const sessionID = session || "ses_fake1";
const emit = (e) => process.stdout.write(JSON.stringify({ sessionID, ...e }) + "\n");

// The first model in the list "refuses", like a free model that is down.
if (model === "fake/down") {
  emit({ type: "error", error: { name: "APIError", data: { message: "model is down" } } });
  process.exit(1);
}

const said = prompt.split("The user says:\n")[1] || "";
const config = JSON.parse(readFileSync("opencode.json", "utf8"));
const client = new Client({ name: "fake-opencode", version: "1" });
await client.connect(new StreamableHTTPClientTransport(new URL(config.mcp.hourglass.url)));
emit({ type: "step_start" });
emit({ type: "text", part: { text: "Let me add that." } });
emit({ type: "tool_use", part: { id: "p1", callID: "c1", tool: "hourglass_add_note", state: { status: "running" } } });
const r = await client.callTool({ name: "add_note", arguments: { title: "From assistant", body: said } });
emit({ type: "tool_use", part: { id: "p1", callID: "c1", tool: "hourglass_add_note", state: { status: r.isError ? "error" : "completed" } } });
emit({ type: "step_start" });
emit({ type: "text", part: { text: "Done." } });
await client.close();
