import type {
  CodeCheckId,
  CodeFile,
  CodeKnownState,
  CodeOutcome,
  CodeTransition,
  CodeTransitionKind,
  FileCount,
} from "../../types/code.js";
import type { CodeEdit } from "../store/types.js";
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
  /**
   * Row 015-40: the complexity pass's last edit of each judged function's
   * body, by `path NUL functionKey`; one git brought is not among them (015-19).
   */
  readonly edits: ReadonlyMap<string, CodeEdit>;
}

/** A stored state's key in `JudgeContext.prior`. */
export const priorKey = (s: Pick<CodeKnownState, "measure" | "check">) =>
  `${s.measure}\0${s.check.path}\0${functionKey(s.check)}`;

export interface Judged {
  readonly file: CodeFile;
  readonly count: FileCount;
  readonly coverage: readonly FunctionCoverage[];
  /** A recount's judgement: no crossing from a judged state (review 0.1.297 B2). */
  readonly quiet?: true;
  /**
   * Row 015-57: from the records in hand of a file not ready, so it judges
   * only the failures they prove pass; every other state stays as last judged.
   */
  readonly early?: true;
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

/**
 * Each judged function's `crap` and `uncovered` states, the transitions D5
 * records, and D6's edits: a measure judged before whose function's body an
 * edit changed since, at the edit's revision (row 015-40). A recount's
 * judgement marks none, as the complexity pass's does not. An early
 * judgement (row 015-57) gives only a `fail` that is `pass` now, and not
 * one that only a change of `crap.threshold` passes: whether the coverage
 * passed it too waits for every record.
 */
export function judgeFiles(
  ctx: JudgeContext,
  judged: readonly Judged[],
): { states: CodeKnownState[]; transitions: CodeTransition[]; edited: CodeEdit[] } {
  const out: Judgement = { states: [], transitions: [], edited: [] };
  for (const j of judged) {
    j.count.functions.forEach((fn, i) => {
      const id = `${j.file.path}\0${functionKey(fn)}`;
      // D3: a function in a parse error's range has no CC to build on.
      if (ctx.prior.get(`complexity\0${id}`)?.outcome === "unknown") return;
      const cov = j.coverage[i];
      if (cov === undefined) return;
      const edit = j.quiet === true ? undefined : ctx.edits.get(id);
      const named = { check: checkOf(j.file.path, fn), id, edit };
      for (const m of measuresOf(fn.complexity, cov, ctx.threshold)) {
        judgeMeasure(ctx, j, named, m, out);
      }
    });
  }
  return out;
}

interface Judgement {
  readonly states: CodeKnownState[];
  readonly transitions: CodeTransition[];
  readonly edited: CodeEdit[];
}

/** One measure of one function: its state, its transition and D6's edit, into `out`. */
function judgeMeasure(
  ctx: JudgeContext,
  { file, quiet, early }: Judged,
  fn: { readonly check: CodeCheckId; readonly id: string; readonly edit: CodeEdit | undefined },
  m: ReturnType<typeof measuresOf>[number],
  out: Judgement,
): void {
  const { check, edit } = fn;
  const { worktreeId, revision, at } = ctx;
  const was = ctx.prior.get(`${m.measure}\0${fn.id}`);
  const { outcome } = m;
  const kind = quiet === true && was !== undefined ? null : kindOf(was, outcome, m.value);
  const passed = was?.outcome === "fail" && outcome === "pass" && (quiet === true || kind !== null);
  if (early === true && !passed) return;
  if (edit !== undefined && was !== undefined && edit.revision > was.countedAt) {
    out.edited.push({ check, measure: m.measure, revision: edit.revision, at });
  }
  out.states.push({
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
  if (kind === null) return;
  out.transitions.push({
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

/** A function's `crap` and `uncovered` outcomes; both `unknown` when the join cannot tell. */
function measuresOf(complexity: number, cov: FunctionCoverage, threshold: number) {
  if (cov.unresolved === true) {
    return (["crap", "uncovered"] as const).map((measure) => ({
      measure,
      outcome: "unknown" as CodeOutcome,
      value: null,
      threshold: null,
    }));
  }
  const crap = crapScore(complexity, cov.coverage);
  return [
    {
      measure: "crap" as const,
      outcome: (crap > threshold ? "fail" : "pass") as CodeOutcome,
      value: crap as number | null,
      threshold: threshold as number | null,
    },
    {
      measure: "uncovered" as const,
      outcome: (cov.runBy.length === 0 ? "fail" : "pass") as CodeOutcome,
      value: null,
      threshold: null,
    },
  ];
}

/**
 * D5's transition from the last judged state; none out of or into
 * `pending` or `unknown`, and none that only a change of `crap.threshold`
 * made (D1).
 */
function kindOf(
  was: CodeKnownState | undefined,
  outcome: CodeOutcome,
  value: number | null,
): CodeTransitionKind | null {
  if (outcome !== "pass" && outcome !== "fail") return null;
  if (was === undefined) return outcome === "fail" ? "first-seen-fail" : null;
  if (was.outcome === outcome || (was.outcome !== "pass" && was.outcome !== "fail")) return null;
  if (typeof was.threshold === "number" && value !== null) {
    if (value > was.threshold !== (outcome === "fail")) return null;
  }
  return outcome === "fail" ? "pass-to-fail" : "fail-to-pass";
}

/**
 * The file's evidence from its judgement. `only` (row 015-57): an early
 * judgement's, for the functions it judged, over `before`'s for the rest.
 */
export function evidenceOf(
  { file, count, coverage }: Judged,
  only?: ReadonlySet<string>,
  before?: FileEvidence | null,
): FileEvidence {
  const functions: Record<string, FileEvidence["functions"][string]> = { ...before?.functions };
  count.functions.forEach((fn, i) => {
    const cov = coverage[i];
    if (cov === undefined || (only !== undefined && !only.has(functionKey(fn)))) return;
    functions[functionKey(fn)] = [
      cov.lines,
      cov.covered,
      cov.runBy.length,
      ...cov.runBy.slice(0, EVIDENCE_FILES),
    ];
  });
  return { blob: file.blob, functions };
}
