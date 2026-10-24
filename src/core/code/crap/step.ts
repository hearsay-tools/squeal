import { compare } from "../../fs/index.js";
import type {
  CodeCheckId,
  CodeFile,
  CodeKnownState,
  CodeOutcome,
  CodeTransition,
  CodeTransitionKind,
  FileCount,
} from "../../types/code.js";
import type { CheckKey, EpochMs, RevisionNumber, WorktreeId } from "../../types/index.js";
import { COVERAGE_PROVIDER_VERSION, decodeRecord } from "../coverage/record.js";
import type { CoverageRecord } from "../coverage/types.js";
import { uncountableFiles } from "../pass/failed.js";
import type { CodeStore } from "../store/types.js";
import { coverageOf, type FileCondition, type FunctionCoverage, fileCondition } from "./file.js";
import { type LoaderCondition, type LoaderInputs, readLoaders } from "./loaders.js";
import { crapScore } from "./score.js";
import {
  type CoverageSummary,
  EVIDENCE_FILES,
  type FileEvidence,
  type FileSummary,
  functionKey,
  readSummary,
  writeEvidence,
  writeSummary,
} from "./summary.js";

/*
 * Spec 015 D9: the daemon's coverage step, run by the code pass after the
 * complexity pass while `coverage.enabled` holds. It judges each counted
 * source whose loaders all have a current record, and keeps a pending or
 * unknown source's last judged states. The first judgement of a function
 * that was there when coverage started, or when a recount seeded it, is
 * quiet; a function an edit added is a first-seen fail.
 */

export const COVERAGE_MEASURES = ["crap", "uncovered"] as const;

/** A step judges files for at most this long, then yields to hooks and runs again. */
export const STEP_BUDGET_MS = 50;

export interface CoverageStepInput {
  readonly store: CodeStore;
  readonly main: LoaderInputs["main"];
  readonly worktreeId: WorktreeId;
  readonly revision: RevisionNumber;
  /** `crap.threshold`. */
  readonly threshold: number;
  readonly now: () => EpochMs;
  /** The records' writer has work in hand: a result with no record may still get one. */
  readonly writing: boolean;
  /** Loader conditions that cannot change at their key, kept by the pass. */
  readonly settled: Map<CheckKey, LoaderCondition>;
  /** The complexity pass rebuilt every state: a function with no coverage state is seeded, not new. */
  readonly reseed: boolean;
}

export interface CoverageStepReport {
  readonly judged: number;
  readonly transitions: number;
  /** When a waiting record turns `unknown`; `null` when none waits. */
  readonly wakeAt: EpochMs | null;
  /** Files left to judge past the budget. */
  readonly more: boolean;
}

interface Judged {
  readonly file: CodeFile;
  readonly count: FileCount;
  readonly coverage: readonly FunctionCoverage[];
}

const checkOf = (path: string, fn: { qualifiedName: string; occurrence: number }): CodeCheckId => ({
  kind: "code",
  path,
  qualifiedName: fn.qualifiedName,
  occurrence: fn.occurrence,
});

/** Spec 015 D9: one step over the worktree; `null` while its first count runs. */
export function runCoverageStep(input: CoverageStepInput): CoverageStepReport | null {
  const { store, worktreeId } = input;
  const files = store.files.list(worktreeId).filter((f) => f.tooBig !== true);
  const spent = uncountableFiles(store, worktreeId, files);
  const counts = new Map<string, FileCount>();
  for (const file of files) {
    const count = store.counts.get(file.blob, file.language, file.counterVersion);
    if (count !== null) counts.set(file.path, count);
    else if (!spent.has(file.path)) return null;
  }
  const summary = readSummary(store.meta, worktreeId);
  const start = summary === null || summary.provider !== COVERAGE_PROVIDER_VERSION;
  const loaders = readLoaders({ ...input, coverage: store.coverage, now: input.now() });
  const records = new Map<CheckKey, CoverageRecord | null>();
  const record = (key: CheckKey) => {
    if (!records.has(key)) {
      const bytes = store.coverage.get({
        resultKey: key,
        providerVersion: COVERAGE_PROVIDER_VERSION,
      });
      records.set(key, bytes === null ? null : decodeRecord(bytes));
    }
    return records.get(key) ?? null;
  };

  const began = input.now();
  const next: Record<string, FileSummary> = {};
  const judged: Judged[] = [];
  let more = false;
  for (const file of files) {
    const count = counts.get(file.path);
    if (count === undefined) continue;
    const before = summary?.files[file.path];
    const condition = fileCondition(loaders.of(file.path), loaders.listed);
    if (condition.state !== "ready") {
      next[file.path] = summaryOf(file, condition);
      continue;
    }
    const signature = [file.blob, ...condition.loaders.map((l) => l.key).sort(compare)].join("\n");
    if (!start && before?.state === "judged" && before.signature === signature) {
      next[file.path] = before;
      continue;
    }
    if (input.now() - began > STEP_BUDGET_MS) {
      more = true;
      if (before !== undefined) next[file.path] = before;
      continue;
    }
    const coverage = coverageOf(file, count.functions, condition.loaders, record);
    if (coverage === "unread") {
      next[file.path] = { state: "unknown", blob: file.blob, cause: "unread" };
      continue;
    }
    next[file.path] = { state: "judged", blob: file.blob, signature };
    judged.push({ file, count, coverage });
  }

  return store.transaction(() => {
    if (start || input.reseed) seed(input, files, counts, start && summary !== null);
    const { states, transitions } = judge(input, judged);
    store.states.upsertMany(states);
    store.transitions.append(transitions);
    for (const j of judged) writeEvidence(store.meta, worktreeId, j.file.path, evidenceOf(j));
    for (const path of Object.keys(summary?.files ?? {})) {
      if (next[path] === undefined) writeEvidence(store.meta, worktreeId, path, null);
    }
    const written: CoverageSummary = {
      v: 1,
      since: start ? input.revision : (summary?.since ?? input.revision),
      provider: COVERAGE_PROVIDER_VERSION,
      files: next,
    };
    if (start || JSON.stringify(written) !== JSON.stringify(summary)) {
      writeSummary(store.meta, worktreeId, written);
    }
    return { judged: judged.length, transitions: transitions.length, wakeAt: loaders.wakeAt, more };
  });
}

function summaryOf(file: CodeFile, condition: Exclude<FileCondition, { state: "ready" }>) {
  return condition.state === "pending"
    ? {
        state: "pending" as const,
        blob: file.blob,
        reason: condition.reason,
        waiting: condition.waiting,
      }
    : { state: "unknown" as const, blob: file.blob, cause: condition.cause };
}

/**
 * A `pending` state for each function with no coverage state, so its first
 * judgement is quiet: the functions there when coverage started, or that a
 * first count or recount brought. With `again`, every state is pending
 * again: the provider's records changed meaning.
 */
function seed(
  input: CoverageStepInput,
  files: readonly CodeFile[],
  counts: ReadonlyMap<string, FileCount>,
  again: boolean,
): void {
  const { store, worktreeId, revision } = input;
  const known = new Set(
    again
      ? []
      : store.states
          .list(worktreeId, { measure: "crap" })
          .map((s) => `${functionKey(s.check)}\0${s.check.path}`),
  );
  const states: CodeKnownState[] = [];
  for (const file of files) {
    for (const fn of counts.get(file.path)?.functions ?? []) {
      if (known.has(`${functionKey(fn)}\0${file.path}`)) continue;
      for (const measure of COVERAGE_MEASURES) {
        states.push({
          worktreeId,
          check: checkOf(file.path, fn),
          measure,
          outcome: "pending",
          value: null,
          threshold: null,
          countedAt: revision,
          blob: file.blob,
          changedAt: revision,
        });
      }
    }
  }
  store.states.upsertMany(states);
}

/** Each judged function's `crap` and `uncovered` states, and the transitions D5 records. */
function judge(
  input: CoverageStepInput,
  judged: readonly Judged[],
): { states: CodeKnownState[]; transitions: CodeTransition[] } {
  const { store, worktreeId, revision } = input;
  const paths = judged.map((j) => j.file.path);
  const prior = new Map(
    (paths.length === 0 ? [] : store.states.list(worktreeId, { paths })).map((s) => [
      `${s.measure}\0${s.check.path}\0${functionKey(s.check)}`,
      s,
    ]),
  );
  const at = input.now();
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
          fail: crap > input.threshold,
          value: crap,
          threshold: input.threshold,
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

function evidenceOf({ file, count, coverage }: Judged): FileEvidence {
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
