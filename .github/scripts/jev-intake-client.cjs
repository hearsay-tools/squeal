"use strict";

// The HTTP call to Jev for issue intake (spec 010 D12), ported from
// hearsay-tools/cezarion at 10cec2e9: one POST per question set, retried on
// rate limits and overload, failing closed on anything else.

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504, 529]);

function truncate(text, limit) {
  const value = String(text ?? "");
  return value.length <= limit ? value : `${value.slice(0, limit)}…`;
}

function retryDelayMs(response, attempt) {
  const header = response?.headers?.get?.("retry-after");
  const seconds = header === null || header === undefined || header === "" ? NaN : Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 30) * 1000;
  return 1000 * 2 ** (attempt - 1);
}

async function callJev({
  request,
  apiKey,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxAttempts = 4,
  timeoutMs = 30_000,
}) {
  if (typeof apiKey !== "string" || apiKey.length === 0)
    throw new Error("TYPESAFE_API_KEY is not set.");
  for (let attempt = 1; ; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (attempt >= maxAttempts)
        throw new Error(`Jev request failed after ${attempt} attempts: ${error.message}`);
      await sleep(retryDelayMs(null, attempt));
      continue;
    }
    if (response.ok) return response.json();
    if (RETRY_STATUSES.has(response.status) && attempt < maxAttempts) {
      await sleep(retryDelayMs(response, attempt));
      continue;
    }
    const detail = truncate(await response.text().catch(() => ""), 500);
    throw new Error(`Jev request failed with HTTP ${response.status}: ${detail}`);
  }
}

module.exports = { callJev, truncate, ENDPOINT };
