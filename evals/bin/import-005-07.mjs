#!/usr/bin/env node
// One-off (spec 006 D6): converts 005-07's 36 effort-`medium` cells of T1, T2 and T4, graded by the
// prototype's grade.mjs, into evals/results/2026-10-10-0.1.101.json, the trend's first point.
//   node evals/bin/import-005-07.mjs
// Two fields the prototype did not grade are recomputed from each cell's own timeline: own Vitest
// runs after Squeal had answered since the last edit, and node:test after the last edit to the
// scripts. The prototype's quirks stay in its other counts (a command chained after a Squeal call
// was not counted as a run); the file's `source` says so. Its conditions are the prototype's:
// fixture cbfaa0a, no knobs, so it is a trend line of its own.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EVALS, REPO } from "../lib/prepare.mjs";
import { cellRecord, conditionsOf } from "../lib/results.mjs";

const PROBE = join(REPO, "docs/specifications/005-agent-adoption/research/probes/model-evals");
const CELLS = join(PROBE, "logs/baseline-2026-10-10/cells");
const TASKS = ["t1-thousands", "t2-weekend", "t4-contract"];
const grades = readdirSync(CELLS)
  .filter(
    (f) =>
      f.endsWith(".grade.json") &&
      f.includes(".e-medium.") &&
      TASKS.some((t) => f.startsWith(`${t}.`)),
  )
  .sort()
  .map((f) => JSON.parse(readFileSync(join(CELLS, f), "utf8")));
if (grades.length !== 36) throw new Error(`expected 36 cells, found ${grades.length}`);

function regrade(g) {
  const { runs, pulls, edits, deliveries } = g.timeline;
  const answers = [
    ...deliveries.filter((d) => d.kind !== "registration").map((d) => d.t),
    ...pulls
      .filter((p) => !p.denied && /^(status|run|why)/.test(p.sub))
      .map((p) => p.t + (p.ms ?? 0)),
  ];
  const editBefore = (t) => edits.filter((e) => e.t < t).at(-1)?.t ?? -Infinity;
  const vitest = runs.filter((r) => r.runner === "vitest" && !r.denied);
  const lastScriptEdit =
    edits.filter((e) => /^scripts\/[^/]+\.mjs$/.test(e.path)).at(-1)?.t ?? null;
  const end = g.squealEnd;
  const verdict = !end
    ? null
    : end.knownFailures > 0
      ? "fail"
      : end.pending > 0
        ? "unknown"
        : "pass";
  return {
    ...g,
    reachedModel: true,
    vitestAfterSquealAnswered: vitest.filter((r) =>
      answers.some((a) => a > editBefore(r.t) && a <= r.t),
    ).length,
    nodeTestAfterScriptEdit:
      lastScriptEdit === null
        ? null
        : runs.some((r) => r.runner === "node:test" && !r.denied && r.t > lastScriptEdit),
    squealEnd: end ? { ...end, verdict } : null,
    claimMatchesSqueal: g.claim === null || !verdict ? null : g.claim === verdict,
  };
}

const prompt = (t) =>
  readFileSync(join(PROBE, "tasks", `${t}.txt`), "utf8") +
  readFileSync(join(PROBE, "tasks/_ending.txt"), "utf8");
const results = {
  schema: 1,
  kind: "baseline",
  date: "2026-10-10",
  squealVersion: "0.1.101",
  commit: "8c11e5b3bbd6beb4e04e7417e23aa467d0c3fbd1",
  source:
    "Imported from 005-07 (docs/specifications/005-agent-adoption/research/model-evals-baseline.md, probes/model-evals/logs/baseline-2026-10-10/cells), graded by the prototype's grade.mjs: a command chained after a Squeal call was not counted as a run, and refused commands were matched by text. vitestAfterSquealAnswered and nodeTestAfterScriptEdit are recomputed from each cell's timeline by evals/bin/import-005-07.mjs. T3's 4 cells are left out (one repetition).",
  conditions: conditionsOf({
    fixture: grades[0].head,
    tasks: Object.fromEntries(TASKS.map((t) => [t, { prompt: prompt(t), knobs: {} }])),
    variant: "p0",
    effort: "medium",
  }),
  harnesses: Object.fromEntries(grades.map((g) => [g.harness, g.harnessVersion])),
  models: [
    { harness: "claude", model: "claude-haiku-5-5", status: "served" },
    { harness: "codex", model: "gpt-6-luna", status: "served" },
    { harness: "claude", model: "claude-sonnet-5-5", status: "served" },
    { harness: "codex", model: "gpt-6.1-sol", status: "served" },
  ],
  load: { cpus: 24, maxLoad: 24, parallel: 2 },
  failed: [],
  cells: grades.map(regrade).map(cellRecord),
};
writeFileSync(
  join(EVALS, "results/2026-10-10-0.1.101.json"),
  `${JSON.stringify(results, null, 1)}\n`,
);
console.log(`imported ${results.cells.length} cells`);
