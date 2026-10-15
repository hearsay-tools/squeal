import type { ResultRecord, WhyDurations } from "../types/index.js";

/**
 * Task 001-411: min, nearest-rank median and p95, and max over the passes
 * and fails of `results`; skips are counted, not timed, as a skip runs
 * nothing. `null` when no pass or fail is among them.
 */
export function durationsOf(results: readonly ResultRecord[]): WhyDurations | null {
  const timed = results.filter((r) => r.outcome !== "skip");
  const sorted = timed.map((r) => r.durationMs).sort((a, b) => a - b);
  const max = sorted.at(-1);
  if (max === undefined) return null;
  const rank = (p: number) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? max;
  const fail = timed.filter((r) => r.outcome === "fail").length;
  return {
    results: timed.length,
    pass: timed.length - fail,
    fail,
    skip: results.length - timed.length,
    minMs: sorted[0] ?? max,
    medianMs: rank(0.5),
    p95Ms: rank(0.95),
    maxMs: max,
  };
}

/**
 * `(12 results, 10 pass / 2 fail): min 3 ms, ...`, shared by `why`'s
 * `Durations` line and each candidate's suffix. One result prints its
 * one duration.
 */
export function durationsText(d: WhyDurations): string {
  const counts = `${d.results} ${d.results === 1 ? "result" : "results"}, ${d.pass} pass / ${d.fail} fail${d.skip === 0 ? "" : `, ${d.skip} skip not timed`}`;
  const figures =
    d.results === 1
      ? ms(d.maxMs)
      : `min ${ms(d.minMs)}, median ${ms(d.medianMs)}, p95 ${ms(d.p95Ms)}, max ${ms(d.maxMs)}`;
  return `(${counts}): ${figures}`;
}

function ms(value: number): string {
  return `${Math.round(value)} ms`;
}
