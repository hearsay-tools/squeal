#!/usr/bin/env node
// An atomic variant run's two arms, per model, scenario and measure, as markdown (spec 006 D8,
// D10; 006-48):
//   node evals/bin/atomic-compare.mjs evals/results/<file>.atomic-variant.json
// The coordinator commits the output beside the results.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { atomicCompareMarkdown } from "../lib/atomic-compare.mjs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node evals/bin/atomic-compare.mjs <results.atomic-variant.json>");
  process.exit(2);
}
try {
  process.stdout.write(
    atomicCompareMarkdown(JSON.parse(readFileSync(file, "utf8")), basename(file)),
  );
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
