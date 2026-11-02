const header = (headers, name) => {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key]) : null;
};

function parseReset(value, now) {
  if (!value) return undefined;
  const text = String(value).trim();
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 0) {
    if (numeric >= 1e12) return Math.round(numeric);
    if (numeric >= 1e9) return Math.round(numeric * 1000);
    return Math.round(now + numeric * 1000);
  }
  const date = Date.parse(text);
  return Number.isFinite(date) && date > 0 ? date : undefined;
}

function errorData(error, body) {
  let data = body ?? error?.body ?? error?.error ?? error?.response?.data ?? error ?? {};
  if (typeof data === "string") {
    try { data = JSON.parse(data); } catch { data = { message: data }; }
  }
  const nested = data?.error ?? data?.cause ?? data;
  return {
    data: nested && typeof nested === "object" ? nested : {},
    text: [error?.message, error?.result, error?.subtype, error?.data?.message, error?.data?.code, error?.name, data?.message, nested?.message, nested?.data?.message, nested?.type, nested?.code].filter(Boolean).join(" "),
  };
}

export function isSharedFreeQuotaError(error) {
  let raw = "";
  try { raw = typeof error === "string" ? error : JSON.stringify(error); } catch {}
  return /AI_APICallError\s*:\s*Free usage limit reached/i.test(raw);
}

export function normalizeEngineError(error, { provider = "assistant", status, headers, body, now = Date.now(), timeZone = "UTC" } = {}) {
  const { data, text } = errorData(error, body);
  const code = String(data.code ?? data.type ?? error?.code ?? "").toLowerCase();
  const statusCode = Number(status ?? error?.status ?? error?.statusCode ?? error?.response?.status ?? 0);
  const lower = `${code} ${text}`.toLowerCase();
  const retry = header(headers ?? error?.headers ?? error?.response?.headers, "retry-after");
  let retry_after_s;
  let resets_at;
  if (retry != null) {
    const seconds = Number(retry);
    if (Number.isFinite(seconds) && seconds >= 0) {
      retry_after_s = Math.ceil(seconds);
      resets_at = now + retry_after_s * 1000;
    } else {
      const date = Date.parse(retry);
      if (Number.isFinite(date) && date > now) {
        retry_after_s = Math.ceil((date - now) / 1000);
        resets_at = date;
      }
    }
  }
  if (resets_at === undefined) {
    for (const name of ["anthropic-ratelimit-requests-reset", "anthropic-ratelimit-input-tokens-reset", "anthropic-ratelimit-output-tokens-reset", "x-ratelimit-reset", "x-ratelimit-reset-requests"]) {
      resets_at = parseReset(header(headers ?? error?.headers ?? error?.response?.headers, name), now);
      if (resets_at !== undefined) break;
    }
  }
  const explicitRetry = data.retry_after_s ?? data.retry_after ?? data.data?.retry_after_s ?? data.data?.retry_after ?? error?.error?.data?.retry_after_s;
  if (retry_after_s === undefined && explicitRetry !== undefined && Number.isFinite(Number(explicitRetry))) {
    retry_after_s = Math.max(0, Math.ceil(Number(explicitRetry)));
    resets_at = now + retry_after_s * 1000;
  }
  if (resets_at === undefined) {
    resets_at = parseReset(data.resets_at ?? data.reset_at ?? data.resetAt ?? data.data?.resets_at ?? data.data?.reset_at ?? data.data?.resetAt ?? error?.error?.data?.resets_at ?? error?.error?.data?.reset_at, now);
  }

  let kind = "other";
  if ([401, 403].includes(statusCode) || /authentication_error|invalid_api_key|invalid api key|unauthorized|authentication failed|oauth token.*expired|sign.?in expired|not authenticated|no api key|token.*missing|token was not accepted|key was not accepted|paste your claude token|add your key/.test(lower)) kind = "auth";
  else if (statusCode === 402 || isSharedFreeQuotaError(error) || /insufficient_quota|insufficient balance|out of credits|billing|quota_exceeded|credit balance/.test(lower)) kind = "quota";
  else if (statusCode === 429 || /rate_limit|rate limit|too many requests|request_limit_exceeded/.test(lower)) kind = "rate_limit";
  else if ([500, 502, 503, 504, 529].includes(statusCode) || /\b5(?:00|02|03|04|29)\b|overloaded|server_overloaded|temporarily unavailable|service unavailable|internal server error/.test(lower)) kind = "overloaded";
  else if (/econn|etimedout|eai_again|fetch failed|network|socket hang up|connection reset|aborterror|timed out|stalled/.test(lower)) kind = "network";
  else if ([400, 404, 413, 422].includes(statusCode) || /invalid_request|bad_request|model_not_found|context_length_exceeded|unsupported_parameter|pick a model/.test(lower)) kind = "bad_request";

  let message = userMessage(kind, provider, { retry_after_s, resets_at, timeZone });
  if (provider === "free" && isSharedFreeQuotaError(error)) {
    message = "The free models have hit their limit. Try again later, or add your own key in Assistant settings.";
    if (resets_at) message += ` It resets at ${formatReset(resets_at, timeZone)}.`;
  }
  const result = { kind, message };
  if (retry_after_s !== undefined) result.retry_after_s = retry_after_s;
  if (resets_at !== undefined) result.resets_at = resets_at;
  return result;
}

function formatReset(resets_at, timeZone = "UTC") {
  let zone = timeZone || "UTC";
  try { return new Date(resets_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone }); }
  catch { zone = "UTC"; return new Date(resets_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone }); }
}

export function userMessage(kind, provider = "assistant", { retry_after_s, resets_at, timeZone = "UTC" } = {}) {
  const name = provider === "claude" || provider === "anthropic" ? "Claude" : provider === "deepseek" ? "DeepSeek" : provider === "openai" ? "Your AI provider" : "The assistant provider";
  if (kind === "auth") {
    if (provider === "claude") return "Your Claude sign-in expired. Sign in again in Assistant settings.";
    if (provider === "anthropic") return "Your Claude API key was rejected. Check it in Assistant settings.";
    return "Your API key or sign-in was rejected. Check Assistant settings.";
  }
  if (kind === "rate_limit" || kind === "quota") {
    if (provider === "deepseek" && kind === "quota") return "DeepSeek balance is empty";
    if (provider === "deepseek" && kind === "rate_limit") return "DeepSeek is rate limited. Try again shortly.";
    if (resets_at) {
      return `${name}'s limit is reached; it resets at ${formatReset(resets_at, timeZone)}.`;
    }
    if (retry_after_s !== undefined) return `${name}'s limit is reached; try again in ${retry_after_s} seconds.`;
    return `${name}'s limit is reached. Try another model or try again later.`;
  }
  if (kind === "overloaded") return `${name} is busy. Try again shortly.`;
  if (kind === "network") return `Could not reach ${name.toLowerCase()}. Check your connection and try again.`;
  if (kind === "bad_request") return "The provider rejected this request. Check the model and settings.";
  return "The assistant couldn't complete this request. Try again.";
}
