#!/usr/bin/env node
// Regenerates evals/results/ATOMIC.md from every atomic results file (spec 006 D10):
//   node evals/bin/atomic-trend.mjs
import { join } from "node:path";
import { writeAtomicMarkdown } from "../lib/atomic-trend.mjs";
import { EVALS } from "../lib/prepare.mjs";

const n = writeAtomicMarkdown(join(EVALS, "results"));
console.log(`ATOMIC.md from ${n} atomic results file(s)`);
