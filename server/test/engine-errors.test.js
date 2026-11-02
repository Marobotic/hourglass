import { test } from "node:test";
import assert from "node:assert/strict";
import { isSharedFreeQuotaError, normalizeEngineError } from "../engine-errors.js";

test("normalizes captured Anthropic rate-limit headers and honors Retry-After", () => {
  const now = 1_800_000_000_000;
  const result = normalizeEngineError({ status: 429, message: "rate limit exceeded" }, {
    provider: "anthropic", now, headers: new Headers({
      "retry-after": "17", "anthropic-ratelimit-requests-reset": "2027-01-15T12:00:00Z",
    }), body: { type: "error", error: { type: "rate_limit_error", message: "rate limit exceeded" } },
  });
  assert.equal(result.kind, "rate_limit");
  assert.equal(result.retry_after_s, 17);
  assert.equal(result.resets_at, now + 17_000);
  assert.match(result.message, /Claude's limit is reached/);
  assert.doesNotMatch(result.message, /rate limit exceeded/);
});

test("recognizes OpenRouter quota and OpenAI key errors from provider response bodies", () => {
  const quota = normalizeEngineError({ status: 402 }, {
    provider: "openai", body: { error: { code: "insufficient_quota", message: "Account has no credits" } },
  });
  assert.equal(quota.kind, "quota");
  assert.equal("resets_at" in quota, false);
  const auth = normalizeEngineError({ status: 401 }, {
    provider: "openai", body: { error: { code: "invalid_api_key", message: "sk-secret is invalid" } },
  });
  assert.equal(auth.kind, "auth");
  assert.doesNotMatch(auth.message, /sk-secret/);
});

test("normalizes captured DeepSeek balance and rate-limit responses", () => {
  const quota = normalizeEngineError({ status: 402, body: { error: { code: "insufficient_balance", message: "Insufficient Balance" } } }, {
    provider: "deepseek", status: 402, body: { error: { code: "insufficient_balance", message: "Insufficient Balance" } },
  });
  assert.equal(quota.kind, "quota");
  assert.equal(quota.message, "DeepSeek balance is empty");
  assert.equal("resets_at" in quota, false);
  const limited = normalizeEngineError({ status: 429, message: "Too Many Requests" }, {
    provider: "deepseek", status: 429, headers: new Headers({ "retry-after": "9" }),
    body: { error: { code: "rate_limit_exceeded", message: "Too Many Requests" } },
  });
  assert.equal(limited.kind, "rate_limit");
  assert.equal(limited.retry_after_s, 9);
  assert.equal(limited.message, "DeepSeek is rate limited. Try again shortly.");
});

test("normalizes Claude subscription JSON errors, overloaded responses, network errors, and bad requests", () => {
  const claude = normalizeEngineError({ message: "Claude Code error", data: { message: "OAuth token has expired" } }, { provider: "claude" });
  assert.equal(claude.kind, "auth");
  assert.match(claude.message, /Sign in again/);
  assert.equal(normalizeEngineError({ status: 529, message: "overloaded_error" }).kind, "overloaded");
  assert.equal(normalizeEngineError(Object.assign(new Error("fetch failed"), { code: "ECONNRESET" })).kind, "network");
  assert.equal(normalizeEngineError({ status: 400, message: "invalid_request_error: bad input" }).kind, "bad_request");
});

test("parses OpenCode JSON error events and does not invent reset times", () => {
  const event = { type: "error", error: { name: "APIError", data: { message: "429 too many requests" } } };
  const result = normalizeEngineError(event, { provider: "free" });
  assert.equal(result.kind, "rate_limit");
  assert.equal("retry_after_s" in result, false);
  assert.equal("resets_at" in result, false);
});

test("OpenCode shared free quota maps to a clear quota message and only uses an explicit reset", () => {
  const event = { type: "error", error: { name: "AI_APICallError", data: { message: "AI_APICallError: Free usage limit reached" } } };
  assert.equal(isSharedFreeQuotaError(event.error), true);
  const result = normalizeEngineError(event.error, { provider: "free" });
  assert.equal(result.kind, "quota");
  assert.equal(result.message, "The free models have hit their limit. Try again later, or add your own key in Assistant settings.");
  assert.equal("resets_at" in result, false);
  const withReset = normalizeEngineError({ name: "AI_APICallError", data: { message: "AI_APICallError: Free usage limit reached", reset_at: "2026-11-01T20:00:00Z" } }, { provider: "free", timeZone: "Asia/Tokyo" });
  assert.equal(withReset.resets_at, Date.parse("2026-11-01T20:00:00Z"));
  assert.match(withReset.message, /It resets at 05:00\./);
  assert.doesNotMatch(withReset.message, /UTC/);
});

test("provider reset wording uses the account zone and falls back to UTC", () => {
  const error = { name: "AI_APICallError", data: { message: "AI_APICallError: Free usage limit reached", reset_at: "2026-11-01T20:00:00Z" } };
  const cairo = normalizeEngineError(error, { provider: "free", timeZone: "Africa/Cairo" });
  assert.equal(cairo.message, "The free models have hit their limit. Try again later, or add your own key in Assistant settings. It resets at 22:00.");
  const utc = normalizeEngineError(error, { provider: "free" });
  assert.equal(utc.message, "The free models have hit their limit. Try again later, or add your own key in Assistant settings. It resets at 20:00.");
  assert.doesNotMatch(utc.message, /UTC/);
});
