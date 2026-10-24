// Throwaway probe (judge-calibration-2.1.310): prints the judge's input for the references the
// 2.1.310 calibration missed, as judgeCell builds it. Calls no model and runs nothing under evals/bin.
import { readFileSync } from "node:fs";
import { JUDGED } from "../../../../../../evals/lib/judge.mjs";
import { judgeInput, situationOf } from "../../../../../../evals/lib/judge.mjs";
import { rubricOf } from "../../../../../../evals/lib/rubric.mjs";
import { calibrationReferences } from "../../../../../../test/evals/judge-references.ts";

const declared = JSON.parse(readFileSync(new URL("../../../../../../evals/tasks/tasks.json", import.meta.url), "utf8"));
const want = process.argv.slice(2);
for (const r of calibrationReferences(JUDGED, declared)) {
  if (!want.some((w) => r.name.includes(w))) continue;
  console.log(`===== ${r.name}\nexpected ${JSON.stringify(r.expected)}`);
  console.log(judgeInput({ task: r.task, situation: situationOf(declared.tasks[r.task]), claim: r.cell.claim, transcript: r.cell.transcript }));
}
if (process.env.RUBRIC) console.log(rubricOf(process.env.RUBRIC, declared));
