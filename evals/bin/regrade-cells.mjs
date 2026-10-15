#!/usr/bin/env node
// Row 006-82: grades committed results files' cells again from the raw `out/` their run kept,
// with the parser at this revision (evals/lib/regrade-cells.mjs), and rewrites only the files
// where a cell changed:
//   node evals/bin/regrade-cells.mjs --from-cells <root> --by <row> --note <text>
//     [--date YYYY-MM-DD] [--dry-run] [file.json ...]
// `<root>` holds each run's cells as `<root>/[<any>/]<run>/<cell id>/out`. With no file, every
// baseline, variant and atomic results file in evals/results. A cell whose `out/` is gone stays
// as committed and is counted. No model call: a long cell keeps its judge verdicts. A changed
// file's `regraded` note is `{ by, date, changed, note }`. Every file is graded before any is
// written; then TREND.md and ATOMIC.md are regenerated beside the files written. --dry-run
// prints each changed cell's changed fields and writes nothing.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { atomicConfig } from "../lib/atomic.mjs";
import { writeAtomicMarkdown } from "../lib/atomic-trend.mjs";
import { declarations } from "../lib/behaviours.mjs";
import { EVALS } from "../lib/prepare.mjs";
import { gradeOut, regradeFromOut, runDirOf } from "../lib/regrade-cells.mjs";
import { trendMarkdown } from "../lib/trend.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "from-cells": { type: "string" },
    by: { type: "string" },
    note: { type: "string" },
    date: { type: "string", default: new Date().toISOString().slice(0, 10) },
    "dry-run": { type: "boolean", default: false },
  },
});
const root = values["from-cells"];
const dry = values["dry-run"];
if (!root || (!dry && (!values.by || !values.note))) {
  console.error(
    "usage: regrade-cells.mjs --from-cells <root> --by <row> --note <text> [--date YYYY-MM-DD] [--dry-run] [file.json ...]",
  );
  process.exit(2);
}
const KINDS = new Set(["baseline", "variant", "atomic", "atomic-variant"]);
const results = join(EVALS, "results");
const files = positionals.length
  ? positionals
  : readdirSync(results)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => join(results, f));

const declared = declarations();
const config = atomicConfig();
const graded = files.flatMap((file) => {
  const data = JSON.parse(readFileSync(file, "utf8"));
  if (!KINDS.has(data.kind)) return [];
  const run = data.run ? runDirOf(root, data.run) : null;
  const gradeOf = (cell) => {
    const out = run && join(run, cell.id, "out");
    return out && existsSync(out) ? gradeOut(out) : null;
  };
  const by = values.by ?? "dry-run";
  const note = values.note ?? "dry-run";
  return [
    { file, ...regradeFromOut(data, { gradeOf, declared, config, by, note, date: values.date }) },
  ];
});

const show = (v) => (v === undefined ? "absent" : JSON.stringify(v));
for (const { file, data, changed, evidence: only, missing, diffs } of graded) {
  const kept = data.cells.length - missing.length;
  if (!kept) continue;
  console.log(
    `${file}: of ${kept} kept cell(s), ${changed.length} changed in a grade, ${only.length} in evidence alone; ${missing.length} without out/`,
  );
  for (const { id, grades } of diffs)
    for (const [k, before, after] of grades)
      console.log(`  ${id} ${k}: ${show(before)} -> ${show(after)}`);
  const evidence = new Map();
  for (const { evidence: fields } of diffs) {
    const key = fields.join(", ");
    if (key) evidence.set(key, (evidence.get(key) ?? 0) + 1);
  }
  for (const [fields, n] of evidence) console.log(`  ${n} cell(s) changed in ${fields}`);
}
const untouched = graded.filter((g) => g.data.cells.length === g.missing.length).length;
console.log(`${untouched} results file(s) with no kept cell, left as they are`);

if (dry) process.exit(0);
const written = graded.filter((g) => g.diffs.length);
for (const { file, data } of written) writeFileSync(file, `${JSON.stringify(data, null, 1)}\n`);
console.log(`wrote ${written.length} results file(s)`);
for (const dir of new Set(written.map((g) => dirname(g.file)))) {
  if (written.some((g) => dirname(g.file) === dir && g.data.kind.startsWith("atomic"))) {
    const n = writeAtomicMarkdown(dir);
    console.log(`${join(dir, "ATOMIC.md")} from ${n} atomic results file(s)`);
  }
  if (written.some((g) => dirname(g.file) === dir && !g.data.kind.startsWith("atomic"))) {
    const runs = readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({
        name: f.replace(/\.json$/, ""),
        data: JSON.parse(readFileSync(join(dir, f), "utf8")),
      }));
    writeFileSync(join(dir, "TREND.md"), trendMarkdown(runs, declared));
    console.log(`${join(dir, "TREND.md")} from ${runs.length} results file(s)`);
  }
}
