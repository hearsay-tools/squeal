// Cost per edit of the product ranker (src/core/slow/rank.ts) on cezarion's 77 slow web specs, task 004-82.
// Usage: npx tsx cost.ts <cezarion tree copy> <iterations> <label>
// Reads the copy only. The key stat cache is stood in for by a sha1 per path taken once up front, as the
// daemon has every closure path hashed before it settles; edits are not written, so each pass ranks one
// revision's changed set as the ledger does.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { fsRankSource, SlowRanker, type TokenRecord } from "../../../../../src/core/slow/rank.js";

const [root = "", iterations = "50", label = ""] = process.argv.slice(2);
const E2E = "packages/web/e2e";
const specs = readdirSync(join(root, E2E))
  .filter((f) => f.endsWith(".e2e.ts"))
  .map((f) => `${E2E}/${f}`);
const EDITS = [
  "packages/web/src/routes/task-thread/markdown.tsx",
  "packages/web/src/components/diff/diff.tsx",
  "packages/web/src/styles/accessibility.css",
  ".ai/scripts/build-e2e.sh",
];

const hashes = new Map<string, string>();
const hashOf = (path: string) => {
  if (!hashes.has(path)) {
    try {
      hashes.set(path, createHash("sha1").update(readFileSync(join(root, path))).digest("hex"));
    } catch {
      return null;
    }
  }
  return hashes.get(path);
};
const source = fsRankSource(root, hashOf);
const stats = (ms: number[]) => {
  const s = [...ms].sort((a, b) => a - b);
  const at = (q: number) => s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] ?? 0;
  return { medianMs: +at(0.5).toFixed(2), p90Ms: +at(0.9).toFixed(2), maxMs: +at(1).toFixed(2) };
};
const time = (f: () => void) => {
  const t = performance.now();
  f();
  return performance.now() - t;
};

for (const path of specs) hashOf(path);
const before = loadavg()[0];
const n = Number(iterations);
const out: Record<string, unknown>[] = [];
for (const edit of EDITS) {
  // Cold: a daemon's first edit with nothing stored, every spec and helper read and tokenised.
  const cold = Array.from({ length: n }, () => time(() => new SlowRanker(source).evidence([edit], specs)));
  // Stored: a successor daemon, token records read from the store (here a map of their JSON).
  const rows = new Map<string, string>();
  const records = {
    get: (p: string) => (rows.has(p) ? (JSON.parse(rows.get(p) as string) as TokenRecord) : null),
    set: (p: string, r: TokenRecord) => void rows.set(p, JSON.stringify(r)),
  };
  new SlowRanker(source, records).evidence([edit], specs);
  const stored = Array.from({ length: n }, () =>
    time(() => new SlowRanker(source, records).evidence([edit], specs)),
  );
  // Warm: the same daemon's next edit, records in memory; the changed side is read each time.
  const warmRanker = new SlowRanker(source);
  const evidence = warmRanker.evidence([edit], specs);
  const warm = Array.from({ length: n }, () => time(() => warmRanker.evidence([edit], specs)));
  out.push({
    edit,
    specsWithEvidence: evidence.size,
    tokens: [...new Set([...evidence.values()].flat())].length,
    cold: stats(cold),
    stored: stats(stored),
    warm: stats(warm),
    storedBytes: [...rows.values()].reduce((s, r) => s + r.length, 0),
    storedRows: rows.size,
  });
}
console.log(
  JSON.stringify(
    { label, cpus: cpus().length, node: process.version, loadBefore: before, loadAfter: loadavg()[0], iterations: n, results: out },
    null,
    1,
  ),
);
