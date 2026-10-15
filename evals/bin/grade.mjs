#!/usr/bin/env node
// Grades one cell's out/ directory mechanically and writes out/grade.json (spec 006 D4):
//   node evals/bin/grade.mjs <cell>/out
// The harnesses' own records (Claude Code's transcript, Codex's rollout) are copied from the
// scratch homes into out/harness/ before the scratch is removed, so a cell can be graded again.
// Ground truth is truth.vitest.json with truth.json, the runner's completion record of both
// commands; Squeal's end state is status-end.json, `squeal status --json` (spec 006 wave 1.5).
// The grade is gradeOut's (evals/lib/regrade-cells.mjs), the one reader of out/ (006-86), which
// regrade-cells.mjs reuses on a kept cell.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gradeOut } from "../lib/regrade-cells.mjs";

const OUT = process.argv[2];
const grade = gradeOut(OUT);
if (grade === null) {
  console.error(`${OUT}: no meta.json to grade`);
  process.exit(1);
}
writeFileSync(join(OUT, "grade.json"), JSON.stringify(grade, null, 2));
const t = grade.truth?.pass === undefined ? "?" : grade.truth.pass ? "pass" : "fail";
console.log(
  `${grade.id}\tvitest ${grade.vitestRuns}\tnode:test ${grade.nodeTestRuns}\twaits ${grade.squealWaits}\tsleep ${grade.sleeps}\tskill ${grade.skillLoads}\trefused ${grade.refused}\tclaim ${grade.claim} truth ${t} -> ${grade.claimTrue}`,
);
