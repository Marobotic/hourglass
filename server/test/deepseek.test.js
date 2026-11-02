import { test } from "node:test";
import assert from "node:assert/strict";
import { deepSeekCost, deepSeekPeakEnds, deepSeekPriceState, isDeepSeekPeak } from "../deepseek.js";

const utc = (day, hour, minute = 0) => new Date(Date.UTC(2026, 9, day, hour, minute)); // October 2026: day 5 is Monday.

test("DeepSeek peak price boundaries use UTC weekdays", () => {
  assert.equal(isDeepSeekPeak(utc(5, 0, 59)), false);
  assert.equal(isDeepSeekPeak(utc(5, 1)), true);
  assert.equal(isDeepSeekPeak(utc(5, 3, 59)), true);
  assert.equal(isDeepSeekPeak(utc(5, 4)), false);
  assert.equal(isDeepSeekPeak(utc(5, 6)), true);
  assert.equal(isDeepSeekPeak(utc(5, 9, 59)), true);
  assert.equal(isDeepSeekPeak(utc(5, 10)), false);
  assert.equal(isDeepSeekPeak(utc(10, 2)), false); // Saturday.
  assert.equal(deepSeekPeakEnds(utc(5, 2, 30)).toISOString(), "2026-10-05T04:00:00.000Z");
  assert.equal(deepSeekPeakEnds(utc(5, 7)).toISOString(), "2026-10-05T10:00:00.000Z");
  assert.equal(deepSeekPriceState(utc(5, 7)).line, "Peak price until 10:00 UTC");
  assert.equal(deepSeekPriceState(utc(10, 7)).line, "Off-peak: half price");
});

test("DeepSeek usage costs use cache hit, miss, output prices and halve off-peak", () => {
  const usage = { cache_hit: 1_000_000, cache_miss: 1_000_000, output: 1_000_000 };
  assert.equal(deepSeekCost("deepseek-flash", usage, utc(5, 2)), 1.506);
  assert.equal(deepSeekCost("deepseek-flash", usage, utc(5, 5)), 0.753);
  assert.equal(deepSeekCost("unknown-model", usage, utc(5, 2)), null);
});
