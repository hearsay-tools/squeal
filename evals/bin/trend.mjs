#!/usr/bin/env node
// Regenerates evals/results/TREND.md from every results file (spec 006 D6):
//   node evals/bin/trend.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EVALS } from "../lib/prepare.mjs";
import { trendMarkdown } from "../lib/trend.mjs";

const dir = join(EVALS, "results");
const runs = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({
    name: f.replace(/\.json$/, ""),
    data: JSON.parse(readFileSync(join(dir, f), "utf8")),
  }));
writeFileSync(join(dir, "TREND.md"), trendMarkdown(runs));
console.log(`TREND.md from ${runs.length} results file(s)`);
