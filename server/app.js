// HTTP handler shared by the public server and the Linux sidecar.
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { TABLE_NAMES, toRRule } from "../core/index.js";
import { applyPush } from "../core/node/store.js";
import { INSTRUCTIONS, TOOLS, runTool } from "./tools.js";

export const VERSION = "0.2.0";
const MAX_BODY = 2 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json", "cache-control": "no-store", ...headers });
  res.end(text);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, "body too large");
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

function tokenOk(req, url, expected) {
  if (!expected) return true;
  const auth = req.headers.authorization ?? "";
  const got = auth.startsWith("Bearer ") ? auth.slice(7) : req.headers["x-hourglass-token"] ?? "";
  const a = Buffer.from(String(got));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// A fresh MCP server per request: stateless streamable HTTP.
function mcpServer(service) {
  const server = new McpServer({ name: "hourglass", title: "Hourglass", version: VERSION }, { instructions: INSTRUCTIONS });
  for (const t of TOOLS) {
    server.registerTool(
      t.name,
      {
        title: t.title,
        description: t.description,
        inputSchema: t.input,
        annotations: { readOnlyHint: !!t.readOnly, destructiveHint: !!t.destructive, openWorldHint: false },
      },
      async (args) => {
        try {
          const out = t.run(service, args);
          return { content: [{ type: "text", text: JSON.stringify(out ?? { ok: true }, null, 1) }] };
        } catch (e) {
          return { isError: true, content: [{ type: "text", text: e.message }] };
        }
      },
    );
  }
  return server;
}

export function openApi(baseUrl) {
  const paths = {};
  for (const t of TOOLS) {
    paths[`/api/actions/${t.name}`] = {
      post: {
        operationId: t.name,
        summary: t.title,
        description: t.description,
        "x-openai-isConsequential": !t.readOnly,
        requestBody: { required: false, content: { "application/json": { schema: z.toJSONSchema(z.object(t.input)) } } },
        responses: { 200: { description: "Result", content: { "application/json": { schema: { type: "object" } } } } },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Hourglass", version: VERSION, description: INSTRUCTIONS },
    servers: [{ url: baseUrl }],
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
    security: [{ bearer: [] }],
    paths,
  };
}

function ics(service) {
  const esc = (s) => String(s ?? "").replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
  const stamp = (d, t) => `${d.replaceAll("-", "")}T${t.replace(":", "")}00`;
  const tz = service.tz;
  const courses = new Map(service.store.all("courses").map((c) => [c.id, c]));
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Hourglass//EN", "X-WR-CALNAME:Hourglass", `X-WR-TIMEZONE:${tz}`];
  for (const e of service.store.all("events")) {
    const c = e.course_id ? courses.get(e.course_id) : null;
    lines.push("BEGIN:VEVENT", `UID:${e.id}@hourglass`, `DTSTAMP:${new Date(e.updated_at).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`);
    const ez = e.tz || tz;
    lines.push(`SUMMARY:${esc(e.title || c?.name || "Event")}`, `DTSTART;TZID=${ez}:${stamp(e.start_date, e.start_time)}`, `DTEND;TZID=${ez}:${stamp(e.start_date, e.end_time)}`);
    const loc = e.location || c?.location;
    if (loc) lines.push(`LOCATION:${esc(loc)}`);
    const rule = toRRule(e);
    if (rule) lines.push(`RRULE:${rule}`);
    for (const x of e.exceptions ?? []) lines.push(`EXDATE;TZID=${ez}:${stamp(x, e.start_time)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

// options: { store, service, token, icalToken, publicUrl, extra(req, res, url) -> handled? }
export function createHandler({ store, service, token, icalToken, publicUrl = "", extra }) {
  return async (req, res) => {
    const url = new URL(req.url, "http://local");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (path === "/health") return send(res, 200, { ok: true, name: "hourglass", version: VERSION, rev: store.meta("rev", 0) });
      if (path === "/ical") {
        if (!icalToken || url.searchParams.get("key") !== icalToken) throw new HttpError(403, "bad key");
        return send(res, 200, ics(service), { "content-type": "text/calendar; charset=utf-8" });
      }
      if (path === "/openapi.json") return send(res, 200, openApi(publicUrl || `http://${req.headers.host}`));

      if (!tokenOk(req, url, token)) throw new HttpError(401, "unauthorized");

      if (path === "/mcp") {
        if (req.method !== "POST") return send(res, 405, { error: "stateless server: POST only" }, { allow: "POST" });
        const body = await readJson(req);
        const server = mcpServer(service);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on("close", () => {
          transport.close();
          server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, body);
        return;
      }

      if (extra && (await extra(req, res, url, path))) return;

      const m = req.method;
      const q = Object.fromEntries(url.searchParams);
      const seg = path.split("/").filter(Boolean); // ["api", ...]
      if (seg[0] !== "api") throw new HttpError(404, "not found");

      if (path === "/api/now" && m === "GET") return send(res, 200, service.whatsNow());
      if (path === "/api/schedule" && m === "GET") return send(res, 200, service.schedule(q));
      if (path === "/api/courses/summary" && m === "GET") return send(res, 200, service.listCourses());
      if (path === "/api/notes/search" && m === "GET") return send(res, 200, service.searchNotes({ query: q.q }));
      if (path === "/api/timezones" && m === "GET") return send(res, 200, service.searchZones({ query: q.q || "" }));
      if (path === "/api/settings") {
        if (m === "GET") return send(res, 200, service.settings());
        if (m === "PUT") return send(res, 200, service.setSettings(await readJson(req)));
      }
      if (path === "/api/sync") {
        if (m === "GET") return send(res, 200, store.changesSince(Number(q.since) || 0));
        if (m === "POST") {
          const body = await readJson(req);
          const result = applyPush(store, body.changes);
          return send(res, 200, { ...result, rev: store.meta("rev", 0) });
        }
      }
      if (seg[1] === "actions") {
        if (seg.length === 2 && m === "GET") return send(res, 200, TOOLS.map((t) => ({ name: t.name, title: t.title, description: t.description, input: z.toJSONSchema(z.object(t.input)) })));
        if (seg.length === 3 && m === "POST") return send(res, 200, (await runTool(service, seg[2], await readJson(req))) ?? { ok: true });
      }
      if (TABLE_NAMES.includes(seg[1])) {
        const table = seg[1];
        if (seg.length === 2 && m === "GET") return send(res, 200, store.all(table));
        if (seg.length === 2 && m === "POST") return send(res, 201, store.upsert(table, { ...(await readJson(req)), id: undefined }));
        if (seg.length === 3) {
          if (m === "GET") {
            const row = store.get(table, seg[2]);
            if (!row || row.deleted) throw new HttpError(404, "not found");
            return send(res, 200, row);
          }
          if (m === "PUT" || m === "PATCH") return send(res, 200, store.upsert(table, { ...(await readJson(req)), id: seg[2] }));
          if (m === "DELETE") return send(res, 200, store.remove(table, seg[2]) ?? { ok: true });
        }
      }
      throw new HttpError(404, "not found");
    } catch (e) {
      if (res.headersSent) return;
      const status = e.status ?? (/required|must|bad |unknown|no course|no \w+ with|matches several|cannot|give /.test(e.message) ? 400 : 500);
      if (status === 500) console.error(e);
      send(res, status, { error: e.message });
    }
  };
}
