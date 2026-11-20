import { shellWord } from "../core/text.js";
import type { ProofFile, ProofReport } from "./proof-report.js";

/*
 * Spec 023 D5.5, row 023-24 (lessons round 3, Q5 and Q6): the report's
 * lines that say what a proof does not show. Agents gave a source-case
 * red side as the file's own result at the base (s2-02, s2-09, s2-10),
 * and read "green: not run (red passed: nothing to prove)" as a pass at
 * HEAD (s1-05). Row 023-30 (round 4, R5): a proven changed test says it
 * in its verdict line. Text only: the JSON keeps its fields as they were.
 */

const short = (sha: string) => sha.slice(0, 9);

/** Q6: the green side's line when it did not run, saying what the proof does not show. */
export function greenNotRunLine(file: ProofFile): string {
  const now = `\`squeal status ${shellWord(file.ref.path)}\` gives its result now.`;
  const { end } = file.red.end;
  if (end === "pass")
    return `green: not run. Red passed, so this proof says nothing about HEAD; ${now}`;
  if (end === "fail" || end === "timeout" || end === "prepare")
    return `green: not run. Red failed for another reason, so this proof shows neither that the test catches the change nor its result at HEAD; ${now}`;
  return `green: not run (${file.greenNotRun ?? "not needed"})`;
}

/**
 * Q5: in the source case, a named test that changed between the sides
 * runs at HEAD's version on the red side, so its red side is not the
 * file's result at the base. `imports` is `null` exactly for a keyed
 * file that changed since the base (`importsOf`); a red side with no
 * outcome says nothing to misread.
 */
function redIsNewTest(file: ProofFile, report: ProofReport): boolean {
  if (report.case !== "source" || report.red === null || file.imports !== null) return false;
  return file.red.end.end !== "unknown";
}

const atBase = (file: ProofFile, base: string) =>
  `\`squeal status --at ${base} ${shellWord(file.ref.path)} --run\``;

/**
 * Row 023-30 (lessons round 4, R5): a proven changed test's verdict line
 * carries the distinction, since Q5's line under the red side was still
 * read as the file's change (6 of 10 s2 sessions). `null` otherwise.
 */
export function provenSummary(file: ProofFile, report: ProofReport): string | null {
  if (file.verdict !== "proven" || !redIsNewTest(file, report)) return null;
  const base = short(report.base);
  return `the new test fails on the old code. This is not the file's result at ${base}; that is ${atBase(file, base)}`;
}

/** Q5's line under the red side; the verdict line says it instead when the file is proven (R5). */
export function redSideNote(file: ProofFile, report: ProofReport): string | null {
  if (!redIsNewTest(file, report) || provenSummary(file, report) !== null) return null;
  const base = short(report.base);
  return `red is the test at ${short(report.head)} over the code at ${base}, not the file's own result at ${base}; that is ${atBase(file, base)}.`;
}
