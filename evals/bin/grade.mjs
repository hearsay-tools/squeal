#!/usr/bin/env node
// Grades one cell's out/ directory mechanically and writes out/grade.json (spec 006 D4):
//   node evals/bin/grade.mjs <cell>/out
// The harnesses' own records (Claude Code's transcript, Codex's rollout) are copied from the
// scratch homes into out/harness/ before the scratch is removed, so a cell can be graded again.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gradeCell } from "../lib/grade.mjs";
import { claudeTimeline, codexTimeline, reportedEffort } from "../lib/transcript.mjs";

const OUT = process.argv[2];
const read = (f) => (existsSync(join(OUT, f)) ? readFileSync(join(OUT, f), "utf8") : "");
const jsonl = (f) =>
  existsSync(f)
    ? readFileSync(f, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
const walk = (d) =>
  existsSync(d)
    ? readdirSync(d, { withFileTypes: true }).flatMap((x) =>
        x.isDirectory() ? walk(join(d, x.name)) : [join(d, x.name)],
      )
    : [];

const meta = JSON.parse(read("meta.json"));
const events = jsonl(join(OUT, "events.jsonl"));
const T0 = Number(read("t0"));
const records = walk(join(OUT, "harness"))
  .filter((f) => f.endsWith(".jsonl"))
  .flatMap(jsonl);
const timeline =
  meta.harness === "claude" ? claudeTimeline(events) : codexTimeline(events, records, T0);
let truth = null;
if (read("truth.vitest.json")) {
  const nodeExit = Number(/node:test exit (\d+)/.exec(read("truth.txt"))?.[1] ?? 0);
  truth = { vitest: JSON.parse(read("truth.vitest.json")), nodeExit };
}
const grade = {
  ...meta,
  effortReported: reportedEffort(meta.harness, records),
  ...gradeCell({ timeline, truth, statusEnd: read("status-end.txt"), diff: read("diff.patch") }),
};
writeFileSync(join(OUT, "grade.json"), JSON.stringify(grade, null, 2));
const t = grade.truth?.pass === undefined ? "?" : grade.truth.pass ? "pass" : "fail";
console.log(
  `${meta.id}\tvitest ${grade.vitestRuns} (after Squeal ${grade.vitestAfterSquealAnswered})\tnode:test ${grade.nodeTestRuns}\twaits ${grade.squealWaits}\tsleep ${grade.sleeps}\tskill ${grade.skillLoads}\trefused ${grade.refused}\tclaim ${grade.claim} truth ${t} -> ${grade.claimTrue}`,
);
