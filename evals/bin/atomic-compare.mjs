#!/usr/bin/env node
// An atomic variant run's two arms, per model, scenario and measure, as markdown (spec 006 D8,
// D10; 006-48):
//   node evals/bin/atomic-compare.mjs evals/results/<file>.atomic-variant.json [<file>...]
// The coordinator commits the output beside the results.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { atomicCompareMarkdown } from "../lib/atomic-compare.mjs";
import { poolAtomicRuns } from "../lib/atomic-pool.mjs";

// Several files of one commit and one pair of arms (a staged run) pool into one comparison.
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node evals/bin/atomic-compare.mjs <results.atomic-variant.json>...");
  process.exit(2);
}
try {
  const parts = files.map((f) => ({
    name: basename(f),
    data: JSON.parse(readFileSync(f, "utf8")),
  }));
  process.stdout.write(
    atomicCompareMarkdown(poolAtomicRuns(parts), parts.map((p) => p.name).join(", ")),
  );
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
