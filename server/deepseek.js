// DeepSeek API pricing from https://api-docs.deepseek.com/quick_start/pricing (2026-11-01).
// Prices are USD per 1M tokens at peak; off-peak is half. The official page
// currently documents tool support for DeepSeek-V4.1-Flash and DeepSeek-V4-Pro.
export const DEEPSEEK_PRICES = Object.freeze({
  "deepseek-flash": { hit: 0.006, miss: 0.3, output: 1.2 },
  "deepseek-v4-pro": { hit: 0.044, miss: 1.32, output: 3.96 },
  "deepseek-v4-flash": { hit: 0.006, miss: 0.3, output: 1.2 },
  "deepseek-v4-flash-vision-exp": { hit: 0.006, miss: 0.3, output: 1.2 },
});

export function isDeepSeekBaseUrl(value = "") {
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() === "api.deepseek.com") return true;
    return process.env.HOURGLASS_TEST_HTTP_API === "1" && ["127.0.0.1", "::1"].includes(url.hostname) && url.pathname.split("/").includes("deepseek");
  } catch { return false; }
}

export function deepSeekModelPricing(model) {
  const p = DEEPSEEK_PRICES[model];
  return p ? { input: p.miss / 1_000_000, output: p.output / 1_000_000, cache_hit: p.hit / 1_000_000 } : null;
}

export function isDeepSeekPeak(date = new Date()) {
  const day = date.getUTCDay();
  const hour = date.getUTCHours();
  return day >= 1 && day <= 5 && ((hour >= 1 && hour < 4) || (hour >= 6 && hour < 10));
}

export function deepSeekPeakEnds(date = new Date()) {
  if (!isDeepSeekPeak(date)) return null;
  const end = new Date(date);
  end.setUTCHours(date.getUTCHours() < 4 ? 4 : 10, 0, 0, 0);
  return end;
}

export function deepSeekPriceState(date = new Date()) {
  const end = deepSeekPeakEnds(date);
  return {
    peak: !!end,
    peak_until: end ? `${String(end.getUTCHours()).padStart(2, "0")}:00 UTC` : null,
    line: end ? `Peak price until ${String(end.getUTCHours()).padStart(2, "0")}:00 UTC` : "Off-peak: half price",
  };
}

export function deepSeekCost(model, { cache_hit = 0, cache_miss = 0, output = 0 } = {}, date = new Date()) {
  const p = DEEPSEEK_PRICES[model];
  if (!p) return null;
  const factor = isDeepSeekPeak(date) ? 1 : 0.5;
  return ((cache_hit * p.hit + cache_miss * p.miss + output * p.output) / 1_000_000) * factor;
}

export function deepSeekModelSupportsTools(model) {
  return ["deepseek-flash", "deepseek-v4-pro"].includes(model);
}
