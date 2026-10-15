#!/usr/bin/env node
// Spec 006 D10 (006-35): recomputes the measures of committed atomic results files from what each
// cell kept, its pilot record (`atomic`) and its retained timeline, under the declarations of
// evals/atomic/atomic.json at this revision:
//   node evals/bin/atomic-regrade.mjs --by <row> --note <text> [file.atomic.json ...]
//     [--date YYYY-MM-DD]
// With no file, every `*.atomic.json` and `*.atomic-variant.json` in evals/results (006-86: the
// variant files atomic-compare.mjs reads stay under the same rule). Only a file where a cell's measures
// changed is written, with a `regraded` note `{ by, date, changed, note }` naming those cells
// (006-80); nothing else changes. No session and no model call. Every file is regraded before
// any is written, so a failure leaves them all as they were. Then ATOMIC.md is regenerated in
// each directory a written file lives in, from every atomic file there.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { atomicConfig, regradeAtomic } from "../lib/atomic.mjs";
import { writeAtomicMarkdown } from "../lib/atomic-trend.mjs";
import { EVALS } from "../lib/prepare.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    by: { type: "string" },
    note: { type: "string" },
    date: { type: "string", default: new Date().toISOString().slice(0, 10) },
  },
});
if (!values.by || !values.note) {
  console.error(
    "usage: atomic-regrade.mjs --by <row> --note <text> [file.atomic.json ...] [--date YYYY-MM-DD]",
  );
  process.exit(2);
}
const results = join(EVALS, "results");
const files = positionals.length
  ? positionals
  : readdirSync(results)
      .filter((f) => f.endsWith(".atomic.json") || f.endsWith(".atomic-variant.json"))
      .sort()
      .map((f) => join(results, f));

const config = atomicConfig();
const regraded = files.map((file) => {
  const { data, changed } = regradeAtomic(
    JSON.parse(readFileSync(file, "utf8")),
    config,
    values.date,
    { by: values.by, note: values.note },
  );
  return { file, data, changed };
});
const written = regraded.filter((r) => r.changed.length);
for (const { file, data, changed } of regraded) {
  if (!changed.length) {
    console.log(`${file}: unchanged, not written`);
    continue;
  }
  writeFileSync(file, `${JSON.stringify(data, null, 1)}\n`);
  console.log(`${file}: ${changed.length} of ${data.cells.length} cells changed`);
  for (const line of tally(data.cells)) console.log(`  ${line}`);
}
for (const dir of new Set(written.map((r) => dirname(r.file)))) {
  const n = writeAtomicMarkdown(dir);
  console.log(`${join(dir, "ATOMIC.md")} from ${n} atomic results file(s)`);
}

/** Per scenario, measure and model: met of computable, as `a2-slow slow-through-squeal m 8/20`. */
function tally(cells) {
  const counts = new Map();
  for (const c of cells)
    for (const [m, v] of Object.entries(c.atomic?.measures ?? {})) {
      const key = `${c.task} ${m} ${c.model}`;
      const n = counts.get(key) ?? { met: 0, of: 0 };
      if (v !== null) n.of++;
      if (v === true) n.met++;
      counts.set(key, n);
    }
  return [...counts].map(([k, n]) => `${k} ${n.met}/${n.of}`);
}
