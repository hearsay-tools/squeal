#!/usr/bin/env node
// Regenerates evals/results/TREND.md from every results file (spec 006 D6):
//   node evals/bin/trend.mjs
import { join } from "node:path";
import { EVALS } from "../lib/prepare.mjs";
import { writeTrendMarkdown } from "../lib/trend.mjs";

const n = writeTrendMarkdown(join(EVALS, "results"));
console.log(`TREND.md from ${n} baseline results file(s)`);
