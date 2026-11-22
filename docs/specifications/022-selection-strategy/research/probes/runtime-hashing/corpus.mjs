// Throwaway: runs Candidate A and B over this repository's tracked JS/TS files under src/ and
// test/; prints fallback reasons, cold start and per-file timings. Usage: node corpus.mjs [a|b]
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { performance } from "node:perf_hooks";
import { loadavg } from "node:os";
import { REPO } from "./ts.mjs";

const which = process.argv[2] ?? "b";
const files = execFileSync("git", ["ls-files", "src", "test"], { cwd: REPO, encoding: "utf8" })
  .split("\n").filter((f) => /\.(ts|tsx|js|jsx|mjs|mts|cjs|cts)$/.test(f));
const texts = files.map((f) => [f, readFileSync(REPO + f, "utf8")]);
const t0 = performance.now();
let run;
if (which === "c") {
  const { normalizeC } = await import("./cand-c.mjs");
  run = async (t, e) => normalizeC(t, e);
  normalizeC("const a: number = 1;", ".ts");
} else if (which === "a") {
  const { normalizeA } = await import("./cand-a.mjs");
  run = async (t, e) => normalizeA(t, e);
  normalizeA("const a: number = 1;", ".ts");
} else {
  const { normalize } = await import("./strip.mjs");
  run = normalize;
  await normalize("const a: number = 1;", ".ts");
}
const cold = performance.now() - t0;
const reasons = new Map();
const times = [];
const failed = [];
for (const [f, t] of texts) {
  const s = performance.now();
  const r = await run(t, extname(f));
  times.push(performance.now() - s);
  const k = r.ok ? "ok" : r.reason;
  reasons.set(k, (reasons.get(k) ?? 0) + 1);
  if (!r.ok) failed.push(`${k} ${f}`);
}
times.sort((a, b) => a - b);
const q = (p) => times[Math.floor(p * (times.length - 1))].toFixed(3);
const total = times.reduce((a, b) => a + b, 0);
const bytes = texts.reduce((a, [, t]) => a + t.length, 0);
console.log(JSON.stringify({ candidate: which, node: process.version, files: files.length, chars: bytes, coldMs: +cold.toFixed(1), medianMs: +q(0.5), p90Ms: +q(0.9), maxMs: +q(1), totalMs: +total.toFixed(0), load1: +loadavg()[0].toFixed(1), reasons: Object.fromEntries(reasons) }));
if (process.env.LIST) console.log(failed.join("\n"));
