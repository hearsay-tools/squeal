import type {
  CodeCheckId,
  CodeFile,
  CodeKnownState,
  CodeOutcome,
  CodeTransition,
  CodeTransitionKind,
  FileCount,
} from "../../types/code.js";
import type { FunctionCoverage } from "./file.js";
import { crapScore } from "./score.js";
import { EVIDENCE_FILES, type FileEvidence, functionKey } from "./summary.js";

/*
 * Spec 015 D9 and D5: the `crap` and `uncovered` states of each function of
 * a judged source, and the transitions they record.
 */

/** What `judgeFiles` reads of the store and the step. */
export interface JudgeContext {
  readonly worktreeId: string;
  readonly revision: number;
  /** `crap.threshold`. */
  readonly threshold: number;
  readonly at: number;
  /** Every stored state of the judged files, by `priorKey`. */
  readonly prior: ReadonlyMap<string, CodeKnownState>;
}

/** A stored state's key in `JudgeContext.prior`. */
export const priorKey = (s: Pick<CodeKnownState, "measure" | "check">) =>
  `${s.measure}\0${s.check.path}\0${functionKey(s.check)}`;

export interface Judged {
  readonly file: CodeFile;
  readonly count: FileCount;
  readonly coverage: readonly FunctionCoverage[];
}

export const checkOf = (
  path: string,
  fn: { qualifiedName: string; occurrence: number },
): CodeCheckId => ({
  kind: "code",
  path,
  qualifiedName: fn.qualifiedName,
  occurrence: fn.occurrence,
});

/** Each judged function's `crap` and `uncovered` states, and the transitions D5 records. */
export function judgeFiles(
  ctx: JudgeContext,
  judged: readonly Judged[],
): { states: CodeKnownState[]; transitions: CodeTransition[] } {
  const { prior, worktreeId, revision, at } = ctx;
  const states: CodeKnownState[] = [];
  const transitions: CodeTransition[] = [];
  for (const { file, count, coverage } of judged) {
    count.functions.forEach((fn, i) => {
      const check = checkOf(file.path, fn);
      const id = `${file.path}\0${functionKey(fn)}`;
      // D3: a function in a parse error's range has no CC to build on.
      if (prior.get(`complexity\0${id}`)?.outcome === "unknown") return;
      const cov = coverage[i];
      if (cov === undefined) return;
      const crap = crapScore(fn.complexity, cov.coverage);
      const measured = [
        {
          measure: "crap" as const,
          fail: crap > ctx.threshold,
          value: crap,
          threshold: ctx.threshold,
        },
        {
          measure: "uncovered" as const,
          fail: cov.runBy.length === 0,
          value: null,
          threshold: null,
        },
      ];
      for (const m of measured) {
        const was = prior.get(`${m.measure}\0${id}`);
        const outcome: CodeOutcome = m.fail ? "fail" : "pass";
        states.push({
          worktreeId,
          check,
          measure: m.measure,
          outcome,
          value: m.value,
          threshold: m.threshold,
          countedAt: revision,
          blob: file.blob,
          changedAt: was?.outcome === outcome ? was.changedAt : revision,
        });
        const kind = kindOf(was, outcome, m.value);
        if (kind === null) continue;
        transitions.push({
          worktreeId,
          check,
          measure: m.measure,
          kind,
          from: was?.outcome ?? null,
          to: outcome,
          fromValue: was?.value ?? null,
          toValue: m.value,
          threshold: m.threshold,
          revision,
          at,
        });
      }
    });
  }
  return { states, transitions };
}

/**
 * D5's transition from the last judged state; none out of `pending` or
 * `unknown`, and none that only a change of `crap.threshold` made (D1).
 */
function kindOf(
  was: CodeKnownState | undefined,
  outcome: CodeOutcome,
  value: number | null,
): CodeTransitionKind | null {
  if (was === undefined) return outcome === "fail" ? "first-seen-fail" : null;
  if (was.outcome === outcome || (was.outcome !== "pass" && was.outcome !== "fail")) return null;
  if (typeof was.threshold === "number" && value !== null) {
    if (value > was.threshold !== (outcome === "fail")) return null;
  }
  return outcome === "fail" ? "pass-to-fail" : "fail-to-pass";
}

export function evidenceOf({ file, count, coverage }: Judged): FileEvidence {
  const functions: Record<string, FileEvidence["functions"][string]> = {};
  count.functions.forEach((fn, i) => {
    const cov = coverage[i];
    if (cov === undefined) return;
    functions[functionKey(fn)] = [
      cov.lines,
      cov.covered,
      cov.runBy.length,
      ...cov.runBy.slice(0, EVIDENCE_FILES),
    ];
  });
  return { blob: file.blob, functions };
}
