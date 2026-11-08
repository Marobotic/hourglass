// Usage and quota bookkeeping for the assistant (assistant.js).
//
// Every model turn appends one line to the account's assistant_usage.jsonl:
// engine, model, tokens, cost and the context meter numbers. The usage
// endpoint aggregates those lines per day and per engine; a small in-memory
// quota state turns a provider limit (rate limit, empty balance, the account's
// hourly cap) into one "quota" state with a reset time, cleared when a run
// succeeds again.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const DAY_MS = 24 * 60 * 60 * 1000;
const dayOf = (at) => new Date(at).toISOString().slice(0, 10);
const sum = (rows, key) => rows.reduce((n, r) => n + (Number.isFinite(Number(r[key])) ? Number(r[key]) : 0), 0);

/** The usage ledger for one account: append-only JSON lines, pruned by age and size. */
export function createUsageLog({ file, keepDays = 90, keepLines = 5000, now = () => Date.now() }) {
  const load = () => {
    try {
      return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter((row) => row && Number.isFinite(row.at));
    } catch { return []; }
  };
  const save = (rows) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""), { mode: 0o600 });
  };

  return {
    rows: load,
    /** Keep one turn. Prunes to `keepDays` and `keepLines` only when it must. */
    add(entry) {
      const row = { ...entry, at: Number.isFinite(entry.at) ? entry.at : now() };
      const rows = load();
      const cutoff = now() - keepDays * DAY_MS;
      if (row.at < cutoff) return row; // too old to keep at all
      const oldest = rows[0]?.at ?? row.at;
      if (oldest >= cutoff && rows.length + 1 <= keepLines) {
        mkdirSync(dirname(file), { recursive: true });
        appendFileSync(file, JSON.stringify(row) + "\n", { mode: 0o600 });
        return row;
      }
      const kept = [...rows, row].filter((r) => r.at >= cutoff).slice(-keepLines);
      save(kept);
      return row;
    },
    /** Day by day (UTC dates, oldest first, empty days filled) and per engine. */
    summary({ days = 30, now: at = now() } = {}) {
      const rows = load();
      const cutoff = at - (days - 1) * DAY_MS;
      const recent = rows.filter((row) => row.at >= cutoff);
      const byDay = new Map();
      for (let i = days - 1; i >= 0; i--) {
        const at_i = at - i * DAY_MS;
        byDay.set(dayOf(at_i), { date: dayOf(at_i), runs: 0, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, tokens: 0, cost: 0, unpriced_runs: 0 });
      }
      const engines = new Map();
      for (const row of recent) {
        const day = byDay.get(dayOf(row.at));
        if (day) addTo(day, row);
        const engine = String(row.engine || "free");
        if (!engines.has(engine)) engines.set(engine, { engine, runs: 0, input_tokens: 0, output_tokens: 0, tokens: 0, cost: 0, unpriced_runs: 0, models: [] });
        const bucket = engines.get(engine);
        addTo(bucket, row);
        if (row.model && !bucket.models.includes(row.model)) bucket.models.push(row.model);
      }
      const totals = { runs: 0, input_tokens: 0, output_tokens: 0, tokens: 0, cost: 0, unpriced_runs: 0 };
      for (const row of recent) addTo(totals, row);
      return { days: [...byDay.values()], engines: [...engines.values()], totals };
    },
  };

  function addTo(bucket, row) {
    bucket.runs = (bucket.runs || 0) + 1;
    for (const key of ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"]) {
      if (Number.isFinite(Number(row[key]))) bucket[key] = (bucket[key] || 0) + Number(row[key]);
    }
    const tokens = Number(row.input_tokens || 0) + Number(row.output_tokens || 0);
    bucket.tokens = (bucket.tokens || 0) + tokens;
    if (Number.isFinite(row.cost) && row.cost !== null) bucket.cost = (bucket.cost || 0) + Number(row.cost);
    else if (bucket.runs) bucket.unpriced_runs = (bucket.unpriced_runs || 0) + 1;
  }
}

/**
 * The one limit in force per account and engine, if any:
 * { engine, kind, message, resets_at, at, model }. Cleared on the next good run.
 */
export function createQuotaState() {
  const byAccount = new Map(); // key -> Map(engine -> quota)
  const mapFor = (key) => {
    if (!byAccount.has(key)) byAccount.set(key, new Map());
    return byAccount.get(key);
  };
  return {
    set(key, engine, quota) { mapFor(key).set(String(engine || "free"), { engine: String(engine || "free"), ...quota }); },
    get(key, engine) { return mapFor(key).get(String(engine || "free")) || null; },
    all(key) { return [...mapFor(key).values()]; },
    clear(key, engine) { return mapFor(key).delete(String(engine || "free")); },
    clearAll(key) { byAccount.delete(key); },
  };
}
