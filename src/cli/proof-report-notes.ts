import { shellWord } from "../core/text.js";
import type { ProofFile, ProofReport } from "./proof-report.js";

/*
 * Spec 023 D5.5, row 023-24 (lessons round 3, Q5 and Q6): the report's
 * lines that say what a proof does not show. Agents gave a source-case
 * red side as the file's own result at the base (s2-02, s2-09, s2-10),
 * and read "green: not run (red passed: nothing to prove)" as a pass at
 * HEAD (s1-05). Text only: the JSON keeps `greenNotRun` as it was.
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
 * runs at HEAD's version on the red side: the line says that is not the
 * file's result at the base. `imports` is `null` exactly for a keyed
 * file that changed since the base (`importsOf`); a red side with no
 * outcome says nothing to misread.
 */
export function redSideNote(file: ProofFile, report: ProofReport): string | null {
  if (report.case !== "source" || report.red === null || file.imports !== null) return null;
  if (file.red.end.end === "unknown") return null;
  const base = short(report.base);
  return `red is the test at ${short(report.head)} over the code at ${base}, not the file's own result at ${base}; that is \`squeal status --at ${base} ${shellWord(file.ref.path)}\`.`;
}
