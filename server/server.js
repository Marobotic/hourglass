#!/usr/bin/env node
// Hourglass server: source of truth for sync, REST for the apps, MCP for AIs.
//   HOURGLASS_DATA   data dir (default ./data)
//   HOURGLASS_PORT   default 8930
//   HOURGLASS_HOST   default 127.0.0.1 (put nginx/Caddy in front for TLS)
//   HOURGLASS_URL    public base URL, used in openapi.json
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Store } from "../core/node/store.js";
import { Service } from "../core/node/service.js";
import { createHandler, VERSION } from "./app.js";

const dataDir = resolve(process.env.HOURGLASS_DATA || join(import.meta.dirname, "data"));
const port = Number(process.env.HOURGLASS_PORT || 8930);
const host = process.env.HOURGLASS_HOST || "127.0.0.1";

function secret(name) {
  const p = join(dataDir, name);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const s = randomBytes(24).toString("base64url");
  writeFileSync(p, s + "\n", { mode: 0o600 });
  return s;
}

const store = new Store(join(dataDir, "hourglass.db"));
const service = new Service(store);
const token = process.env.HOURGLASS_TOKEN || secret("token");
const icalToken = secret("ical_key");

createServer(createHandler({ store, service, token, icalToken, publicUrl: process.env.HOURGLASS_URL })).listen(port, host, () => {
  console.log(`hourglass ${VERSION} on http://${host}:${port} (data ${dataDir}, tz ${service.tz})`);
});
