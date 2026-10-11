#!/usr/bin/env node
// Shares of sessions per expectation and context count (spec 006 D4), grouped by any cell field,
// from one or more results files; for two groups, the repetitions per arm needed to tell their
// expectation rates apart (two-sided alpha 0.05, power 0.8: n = 7.85 (p1 q1 + p2 q2) / (p1 - p2)^2),
// as 005-06 used. Each cell is graded under evals/tasks/tasks.json; a cell whose run had other
// knobs for its task is not graded (see TREND.md).
//   node evals/bin/compare.mjs <results.json>... [--tasks t1-thousands,t2-weekend] [variant|model|harness|task]...
// A --variant run's file holds both arms: `node evals/bin/compare.mjs <file> variant`.
import { readFileSync } from "node:fs";
import {
  CONTEXT,
  declarations,
  EXPECTATIONS,
  expectationsOf,
  metRate,
  rate,
} from "../lib/behaviours.mjs";

const args = process.argv.slice(2);
const ti = args.indexOf("--tasks");
const only = ti >= 0 ? args.splice(ti, 2)[1].split(",") : null;
const files = args.filter((a) => a.endsWith(".json"));
const keys = args.filter((a) => !a.endsWith(".json"));
const declared = declarations();
const ids = (c) => (declared.expectations[c.task] ?? []).map((e) => e.id);
// A variant arm's cells are graded under its own conditions, which hold the same task knobs.
const cells = files
  .flatMap((f) => {
    const data = JSON.parse(readFileSync(f, "utf8"));
    return data.cells.map((c) => ({ c, g: expectationsOf(c, data.conditions, declared) }));
  })
  .filter(({ c }) => c.reachedModel !== false && (!only || only.includes(c.task)));
const by = keys.length ? keys : ["variant", "model"];
const group = (c) => by.map((k) => c[k]).join(" / ");
const groups = [...new Set(cells.map(({ c }) => group(c)))].sort();
const fmt = (r) => (r ? `${r.k}/${r.n}` : "-");
const of = (g) => cells.filter(({ c }) => group(c) === g);
const rows = [
  ...Object.keys(EXPECTATIONS).map((id) => ({
    label: `\`${id}\``,
    rate: (g) =>
      metRate(
        of(g).map((x) => x.g),
        id,
      ),
    scored: true,
  })),
  ...CONTEXT.map((x) => ({
    label: `${x.label} (context)`,
    rate: (g) => rate(of(g).map(({ c }) => x.of(c, ids(c), declared.context?.[c.task]))),
    scored: false,
  })),
];

console.log(`| | ${groups.join(" | ")} |`);
console.log(`| --- | ${groups.map(() => "---").join(" | ")} |`);
for (const r of rows)
  console.log(`| ${r.label} | ${groups.map((g) => fmt(r.rate(g))).join(" | ")} |`);
if (groups.length === 2) {
  console.log(
    "\nRepetitions per arm to separate the two arms at these rates (alpha 0.05, power 0.8):",
  );
  for (const r of rows.filter((x) => x.scored)) {
    const [a, z] = groups.map(r.rate);
    if (!a || !z) continue;
    const p1 = a.k / a.n;
    const p2 = z.k / z.n;
    const d = Math.abs(p1 - p2);
    const n =
      d === 0
        ? "no difference observed"
        : Math.ceil((7.85 * (p1 * (1 - p1) + p2 * (1 - p2))) / d ** 2);
    console.log(`  ${r.label}: ${(p1 * 100).toFixed(0)}% vs ${(p2 * 100).toFixed(0)}% -> ${n}`);
  }
}
