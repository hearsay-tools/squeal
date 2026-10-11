#!/usr/bin/env node
// Spec 006 D9's calibration gate: the judge identity judges every reference session in both
// harnesses twice and must give each its expected verdict both times.
//   node --import tsx evals/bin/judge-calibrate.mjs [--model claude-haiku-5-5] [--base <dir>]
//     [--parallel 4] [--date YYYY-MM-DD]
// --model is Haiku 5.5 or Sonnet 5.5, never Opus or Fable; try Sonnet only when Haiku fails.
// --base is where each call's scratch HOME is made and removed (the system temp directory by
// default). The reference sessions are this repository's (test/evals/judge-references.ts), so the
// script runs with tsx. It writes evals/results/judge-calibration-<identity>.json, passing or
// not, and exits 0 when the identity passed, 3 when it did not. The file keeps the sessions'
// names, the expected and given verdicts with their cited steps and reasons, and the cost; it
// never keeps a transcript, and it is checked for secrets before it is written.
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { declarations } from "../lib/behaviours.mjs";
import { calibrate, calibrationName, JUDGE_MODELS } from "../lib/calibration.mjs";
import { claudeRunner, claudeVersion, JUDGE, JUDGED, judgeIdentity } from "../lib/judge.mjs";
import { EVALS } from "../lib/prepare.mjs";
import { assertNoSecrets } from "../lib/results.mjs";
import { secretsOf } from "../lib/scratch.mjs";

const { values } = parseArgs({
  options: {
    model: { type: "string", default: JUDGE_MODELS[0] },
    base: { type: "string", default: tmpdir() },
    parallel: { type: "string", default: "4" },
    date: { type: "string", default: new Date().toISOString().slice(0, 10) },
  },
});
if (!JUDGE_MODELS.includes(values.model)) {
  console.error(`--model must be one of ${JUDGE_MODELS.join(", ")} (spec 006 D9)`);
  process.exit(2);
}
let references;
try {
  ({ calibrationReferences: references } = await import("../../test/evals/judge-references.ts"));
} catch (e) {
  console.error(
    `the reference sessions need tsx: node --import tsx ${process.argv[1]} (${e.message})`,
  );
  process.exit(2);
}

const declared = declarations();
const runner = claudeRunner({ base: values.base });
const identity = judgeIdentity({
  model: values.model,
  effort: JUDGE.effort,
  claudeCode: await claudeVersion(runner),
  declared,
});
const refs = references(JUDGED, declared);
console.log(`calibrating ${calibrationName(identity)} on ${refs.length} sessions, twice each`);
const result = await calibrate({
  references: refs,
  declared,
  identity,
  runner,
  parallel: Number(values.parallel),
});
const text = `${JSON.stringify({ date: values.date, ...result }, null, 1)}\n`;
assertNoSecrets(text, secretsOf(process.env));
const file = join(EVALS, "results", calibrationName(identity));
writeFileSync(file, text);
for (const r of result.references.filter((x) => !x.pass))
  console.log(
    `failed: ${r.name}: expected ${JSON.stringify(r.expected)}, got ${r.runs.map((x) => JSON.stringify(x.grades)).join(" then ")}`,
  );
console.log(
  `${result.passed ? "PASSED" : "FAILED"}: ${result.sessions - result.failed.length}/${result.sessions} sessions, cost $${result.costUsd}; wrote ${file}`,
);
process.exit(result.passed ? 0 : 3);
