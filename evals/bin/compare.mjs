#!/usr/bin/env node
// Shares of sessions per behaviour, grouped by any cell field, from one or more results files;
// for two groups, the repetitions per arm needed to tell them apart at the observed rates
// (two-sided alpha 0.05, power 0.8: n = 7.85 (p1 q1 + p2 q2) / (p1 - p2)^2), as 005-06 used.
//   node evals/bin/compare.mjs <results.json>... [--tasks t1-thousands,t2-weekend] [variant|model|harness|task]...
// A --variant run's file holds both arms: `node evals/bin/compare.mjs <file> variant`.
import { readFileSync } from "node:fs";
import { BEHAVIOURS, rate } from "../lib/behaviours.mjs";

const args = process.argv.slice(2);
const ti = args.indexOf("--tasks");
const only = ti >= 0 ? args.splice(ti, 2)[1].split(",") : null;
const files = args.filter((a) => a.endsWith(".json"));
const keys = args.filter((a) => !a.endsWith(".json"));
const cells = files
  .flatMap((f) => JSON.parse(readFileSync(f, "utf8")).cells)
  .filter((c) => c.reachedModel !== false && (!only || only.includes(c.task)));
const by = keys.length ? keys : ["variant", "model"];
const group = (c) => by.map((k) => c[k]).join(" / ");
const groups = [...new Set(cells.map(group))].sort();
const fmt = (r) => (r ? `${r.k}/${r.n}` : "-");

console.log(`| Behaviour | ${groups.join(" | ")} |`);
console.log(`| --- | ${groups.map(() => "---").join(" | ")} |`);
for (const b of BEHAVIOURS) {
  console.log(
    `| ${b.label} | ${groups
      .map((g) =>
        fmt(
          rate(
            cells.filter((c) => group(c) === g),
            b,
          ),
        ),
      )
      .join(" | ")} |`,
  );
}
if (groups.length === 2) {
  console.log(
    "\nRepetitions per arm to separate the two arms at these rates (alpha 0.05, power 0.8):",
  );
  for (const b of BEHAVIOURS) {
    const [a, z] = groups.map((g) =>
      rate(
        cells.filter((c) => group(c) === g),
        b,
      ),
    );
    if (!a || !z) continue;
    const p1 = a.k / a.n;
    const p2 = z.k / z.n;
    const d = Math.abs(p1 - p2);
    const n =
      d === 0
        ? "no difference observed"
        : Math.ceil((7.85 * (p1 * (1 - p1) + p2 * (1 - p2))) / d ** 2);
    console.log(`  ${b.label}: ${(p1 * 100).toFixed(0)}% vs ${(p2 * 100).toFixed(0)}% -> ${n}`);
  }
}
