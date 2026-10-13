#!/usr/bin/env node
// Grades one cell's out/ directory mechanically and writes out/grade.json (spec 006 D4):
//   node evals/bin/grade.mjs <cell>/out
// The harnesses' own records (Claude Code's transcript, Codex's rollout) are copied from the
// scratch homes into out/harness/ before the scratch is removed, so a cell can be graded again.
// Ground truth is truth.vitest.json with truth.json, the runner's completion record of both
// commands; Squeal's end state is status-end.json, `squeal status --json` (spec 006 wave 1.5).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gradeCell } from "../lib/grade.mjs";
import { claudeTimeline, codexTimeline, reportedEffort } from "../lib/transcript.mjs";
import { walk } from "../lib/variant.mjs";

const OUT = process.argv[2];
const read = (f) => (existsSync(join(OUT, f)) ? readFileSync(join(OUT, f), "utf8") : "");
const jsonl = (f) =>
  existsSync(f)
    ? readFileSync(f, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

const meta = JSON.parse(read("meta.json"));
const events = jsonl(join(OUT, "events.jsonl"));
const T0 = Number(read("t0"));
const records = walk(join(OUT, "harness"))
  .filter((f) => f.endsWith(".jsonl"))
  .flatMap(jsonl);
const timeline =
  meta.harness === "claude" ? claudeTimeline(events) : codexTimeline(events, records, T0);
/** A JSON file of out/, `undefined` when absent or unparsable: the grader reads it as missing. */
const readJson = (f) => {
  try {
    return JSON.parse(read(f));
  } catch {
    return undefined;
  }
};
// A cell without truth files (the 005-07 import) has no truth; one with any has to have both.
const truth = ["truth.json", "truth.vitest.json", "truth.txt"].some((f) => existsSync(join(OUT, f)))
  ? { vitest: readJson("truth.vitest.json"), completion: readJson("truth.json") }
  : null;
// A variant without the plugin has no Squeal state to grade the claim against.
const variantFile = join(
  dirname(fileURLToPath(import.meta.url)),
  "../variants",
  `${meta.variant}.json`,
);
const plugin =
  !existsSync(variantFile) || JSON.parse(readFileSync(variantFile, "utf8")).plugin !== false;
const grade = {
  ...meta,
  effortReported: reportedEffort(meta.harness, records),
  ...gradeCell({
    timeline,
    truth,
    statusEnd: read("status-end.json") || null,
    plugin,
    diff: read("diff.patch"),
  }),
};
writeFileSync(join(OUT, "grade.json"), JSON.stringify(grade, null, 2));
const t = grade.truth?.pass === undefined ? "?" : grade.truth.pass ? "pass" : "fail";
console.log(
  `${meta.id}\tvitest ${grade.vitestRuns}\tnode:test ${grade.nodeTestRuns}\twaits ${grade.squealWaits}\tsleep ${grade.sleeps}\tskill ${grade.skillLoads}\trefused ${grade.refused}\tclaim ${grade.claim} truth ${t} -> ${grade.claimTrue}`,
);
