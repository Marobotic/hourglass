// The usage ledger and quota state behind GET /api/assistant/usage.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createQuotaState, createUsageLog } from "../assistant-usage.js";

const DAY = 24 * 60 * 60 * 1000;

test("usage is appended, aggregated per day and per engine, and pruned", () => {
  const dir = mkdtempSync(join(tmpdir(), "hg-usage-"));
  try {
    const file = join(dir, "assistant_usage.jsonl");
    const now = Date.parse("2026-11-08T12:00:00Z");
    const log = createUsageLog({ file, keepDays: 3, keepLines: 100, now: () => now });
    log.add({ at: now - 2 * DAY, engine: "free", model: "opencode/x", input_tokens: 100, output_tokens: 20, cost: null });
    log.add({ at: now - DAY, engine: "anthropic", model: "claude-haiku-5-5", input_tokens: 10, output_tokens: 5, cost: 0.001, context_window: 200000, context_percent: 1.2 });
    log.add({ at: now, engine: "anthropic", model: "claude-haiku-5-5", input_tokens: 30, output_tokens: 7, cost: 0.002 });
    // Too old: pruned on the next add.
    log.add({ at: now - 10 * DAY, engine: "free", model: "old", input_tokens: 999 });

    const summary = log.summary({ days: 3, now });
    assert.equal(summary.days.length, 3);
    assert.deepEqual(summary.days.map((d) => d.date), ["2026-11-06", "2026-11-07", "2026-11-08"]);
    assert.equal(summary.days[0].runs, 1);
    assert.equal(summary.days[0].tokens, 120);
    assert.equal(summary.days[0].unpriced_runs, 1);    assert.equal(summary.days[2].runs, 1);
    assert.equal(summary.days[2].tokens, 37);
    assert.equal(summary.days[2].cost, 0.002);
    assert.equal(summary.days[1].cost, 0.001);
    const anthropic = summary.engines.find((e) => e.engine === "anthropic");
    assert.equal(anthropic.runs, 2);
    assert.equal(anthropic.tokens, 52);
    assert.ok(Math.abs(anthropic.cost - 0.003) < 1e-9);
    assert.deepEqual(anthropic.models, ["claude-haiku-5-5"]);
    assert.equal(summary.totals.runs, 3);
    assert.equal(readFileSync(file, "utf8").split("\n").filter(Boolean).length, 3, "the 10 day old row is gone");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("quota is kept per account and engine, and cleared on recovery", () => {
  const quotas = createQuotaState();
  assert.equal(quotas.get("a@example.com", "free"), null);
  quotas.set("a@example.com", "free", { kind: "rate_limit", resets_at: 123, message: "too many" });
  quotas.set("a@example.com", "anthropic", { kind: "quota", resets_at: 456, message: "balance" });
  assert.equal(quotas.get("a@example.com", "free").resets_at, 123);
  assert.equal(quotas.all("a@example.com").length, 2);
  assert.equal(quotas.get("b@example.com", "free"), null, "accounts do not share a limit");
  quotas.clear("a@example.com", "free");
  assert.equal(quotas.get("a@example.com", "free"), null);
  assert.equal(quotas.all("a@example.com").length, 1);
  quotas.clearAll("a@example.com");
  assert.deepEqual(quotas.all("a@example.com"), []);
});
