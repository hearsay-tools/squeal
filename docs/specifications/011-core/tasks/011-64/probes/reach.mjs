// THROWAWAY probe (011-64 design, question 4). Which of the design's seams a validity entry
// reaches through static imports (a regex walk, no bundle: it over-counts what esbuild's tree
// shaking keeps, so "reached" means "may be emitted", and "not reached" is certain).
// Usage, from the repository root: node reach.mjs
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const entries = ["global", "vitest", "node-test", "pytest", "recorder"].map(
  (e) => `test/keys/validity/entries/${e}.ts`,
);
const seams = [
  "src/core/store/repos/results.ts",
  "src/core/store/schema.ts",
  "src/core/store/store.ts",
  "src/core/store/prune.ts",
  "src/core/store/repos/runs.ts",
  "src/core/state/flaky.ts",
  "src/core/state/rerun-first.ts",
  "src/core/state/producers.ts",
  "src/core/retry/load.ts",
  "src/core/scheduler/store-results.ts",
  "src/core/status/failures.ts",
  "src/core/status/why.ts",
  "src/core/status/format-why.ts",
  "src/core/delivery/format.ts",
  "src/cli/failures.ts",
  "src/runners/vitest/results.ts",
  "src/runners/node-test/run/errors.ts",
  "src/runners/pytest/run/report.ts",
  "src/core/types/check.ts",
  "src/core/delivery/attribution.ts",
  "src/core/state/derive.ts",
  "src/core/state/fingerprint.ts",
  "src/core/state/index.ts",
  "src/core/scheduler/tiers.ts",
  "src/core/scheduler/scheduler.ts",
];
const IMPORT = /(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;

function resolveTs(from, spec) {
  if (!spec.startsWith(".")) return null;
  const base = join(dirname(from), spec);
  for (const c of [base.replace(/\.js$/, ".ts"), base.replace(/\.cjs$/, ".cjs"), `${base}.ts`, join(base, "index.ts")]) {
    if (existsSync(c)) return relative(".", c);
  }
  return null;
}

for (const entry of entries) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const text = readFileSync(file, "utf8").replace(/^\s*import type[^;]*;/gm, "").replace(/^\s*export type[^;]*;/gm, "");
    for (const m of text.matchAll(IMPORT)) {
      const next = resolveTs(file, m[1] ?? m[2]);
      if (next !== null) stack.push(next);
    }
  }
  const reached = seams.filter((s) => seen.has(s));
  console.log(`${entry}: ${seen.size} files; seams reached: ${reached.join(", ") || "none"}`);
}
