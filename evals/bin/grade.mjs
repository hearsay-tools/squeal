#!/usr/bin/env node
// Grades one cell's out/ directory mechanically and writes out/grade.json (spec 006 D4):
//   node evals/bin/grade.mjs <cell>/out
// The cell directory beside out/ holds the scratch homes, where the harnesses' own records are.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gradeCell } from "../lib/grade.mjs";
import { claudeTimeline, codexTimeline, reportedEffort } from "../lib/transcript.mjs";

const OUT = process.argv[2];
const CELL = join(OUT, "..");
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
let timeline;
let records;
if (meta.harness === "claude") {
  timeline = claudeTimeline(events);
  records = walk(join(CELL, "home", ".claude", "projects"))
    .filter((f) => f.endsWith(".jsonl"))
    .flatMap(jsonl);
} else {
  records = walk(join(CELL, "codex", "sessions"))
    .filter((f) => f.endsWith(".jsonl"))
    .flatMap(jsonl);
  timeline = codexTimeline(events, records, T0);
}
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
