#!/usr/bin/env node
// Regenerates evals/results/ATOMIC.md from every atomic results file (spec 006 D10):
//   node evals/bin/atomic-trend.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { atomicMarkdown } from "../lib/atomic-trend.mjs";
import { EVALS } from "../lib/prepare.mjs";

const dir = join(EVALS, "results");
const runs = readdirSync(dir)
  .filter((f) => f.endsWith(".atomic.json"))
  .map((f) => ({
    name: f.replace(/\.json$/, ""),
    data: JSON.parse(readFileSync(join(dir, f), "utf8")),
  }));
writeFileSync(join(dir, "ATOMIC.md"), atomicMarkdown(runs));
console.log(`ATOMIC.md from ${runs.length} atomic results file(s)`);
