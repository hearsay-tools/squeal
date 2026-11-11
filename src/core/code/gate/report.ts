import { compare } from "../../fs/compare.js";
import type { RelativePath } from "../../types/common.js";
import type { FileHash } from "../../types/keys.js";
import type { RunEstimate } from "./estimate.js";
import type { PrepareRun } from "./prepare.js";
import type { LeftOutGroup, ScopeGroup } from "./scope.js";
import {
  type ChangeKind,
  type ChildFiles,
  type Evidence,
  type ExceptionEntry,
  type GATE_REPORT_FORMAT,
  GATE_RUNNERS,
  type GateGap,
  type GatePolicy,
  type GateState,
  type GateVerdict,
  type OmittedFunction,
  type TestFileEvidence,
  type UncountedPath,
} from "./types.js";

/*
 * Spec 020 D7: the report of `squeal code --base --json`, format
 * `squeal-code-gate/1`. Every list is sorted, so the same inputs give the
 * same report; its only times are `createdAt` and the runs' durations,
 * which the caller passes in.
 */

export type GateRunner = TestFileEvidence["runner"];

/** Where a selected test file's evidence came from (D7, D11.7, D13.2). */
export type GateEvidenceSource = "run" | NonNullable<TestFileEvidence["from"]>;

/** The versions the inventory, collector and Squeal ran at, as the caller gives them. */
export interface EngineVersions {
  readonly squeal: string;
  /** `COUNTER_VERSION`. */
  readonly counter: number;
  /** `COVERAGE_PROVIDER_VERSION`. */
  readonly coverageProvider: number;
  /** `COVERAGE_RECORD_VERSION`. */
  readonly coverageRecord: number;
}

/** D7's `versions`: the engine's, and the evaluator's own `QUALITY_POLICY_VERSION`. */
export interface GateVersions extends EngineVersions {
  readonly qualityPolicy: number;
}

/** The report's only times, read by the caller so the evaluator reads no clock. */
export interface GateTimes {
  /** ISO 8601. */
  readonly createdAt: string;
  /** Each runner's run, in ms; a runner absent here reads `null`. */
  readonly durationsMs: Readonly<Partial<Record<GateRunner, number>>>;
}

/** A function's own-line coverage (015 D9's join). */
export interface GateCoverage {
  /** Its own lines that can run; every own line when measured from a subset. */
  readonly lines: number;
  readonly covered: number;
  /** 0 to 1. */
  readonly share: number;
}

/** D7: one changed function. */
export interface GateFunctionReport {
  readonly path: RelativePath;
  readonly qualifiedName: string;
  readonly occurrence: number;
  /** Where it starts at the head, 1-based. */
  readonly line: number;
  readonly bodyHash: string;
  readonly change: ChangeKind;
  readonly complexity: number;
  /**
   * From the loaders measured; `null` when no record joined it or none is
   * wanted (`skipped`). From a subset of the loaders it is a lower bound.
   */
  readonly coverage: GateCoverage | null;
  /** From `coverage`; an upper bound when it is from a subset. */
  readonly crap: number | null;
  readonly state: GateState;
  /** Set when, and only when, the state is `incomplete`. */
  readonly gap: GateGap | null;
  readonly loaders: {
    /** The selected test files that load its source, or may: their closure is not known. */
    readonly expected: readonly RelativePath[];
    /** Of those, the ones whose whole record at the head bytes was read. */
    readonly measured: readonly RelativePath[];
    /**
     * D14.2: the selected test files that load it, or may, in a group the
     * scope left out: they did not run. Present only when one is.
     */
    readonly leftOut?: readonly RelativePath[];
  };
  /** D8: the entries that name it, each with what it did; present only when one does. */
  readonly exceptions?: readonly GateExceptionUse[];
}

/**
 * D8: what one entry did for the function it names. `covers`: it covers
 * its measure's finding. `not-needed`: the measure is within its limit.
 * `incomplete`: the function's evidence is not complete, which no exception
 * covers. Otherwise why it does not cover: `over-value`, the head value, or
 * an inherited CC's base value, is over the entry's; `worse-than-base`, the
 * head CC is over the base CC; `not-over-at-base`, an inherited CC was
 * within the limit at the base; `not-at-base`, an inherited entry's
 * function is not at the base (added, or the base was not counted).
 */
export type GateExceptionOutcome =
  | "covers"
  | "not-needed"
  | "incomplete"
  | "over-value"
  | "worse-than-base"
  | "not-over-at-base"
  | "not-at-base";

export interface GateExceptionUse {
  readonly entry: ExceptionEntry;
  readonly outcome: GateExceptionOutcome;
  /** The function's CC at the merge base, as Squeal counted it; `null` when it is not there. */
  readonly baseComplexity: number | null;
}

/**
 * D8: why an entry names no changed function of this run: `base-commit`,
 * its base commit is not the merge base; `body-hash`, a changed function
 * has its path and name but another body; `no-function`, none has both.
 */
export interface GateUnusedException {
  readonly entry: ExceptionEntry;
  readonly why: "base-commit" | "body-hash" | "no-function";
}

/** D2: a changed path the counter could not count; the verdict is at least incomplete. */
export interface GatePathReport {
  readonly path: RelativePath;
  readonly reason: UncountedPath["reason"];
  readonly gap: "not-counted";
}

/** D7: one runner's run. */
export interface GateRunReport {
  readonly runner: GateRunner;
  readonly selected: readonly RelativePath[];
  readonly completed: readonly RelativePath[];
  readonly notFinished: readonly RelativePath[];
  readonly failed: readonly { readonly path: RelativePath; readonly tests: readonly string[] }[];
  /**
   * Where each selected file's evidence came from: `run`, this command ran
   * it; `store`, the stores at its key (D11.7); `parts`, `squeal ci
   * record`'s parts (D13.2). Present only when one file did not run here,
   * so a report whose every file ran is as before. By path.
   */
  readonly from?: Readonly<Record<RelativePath, GateEvidenceSource>>;
  /**
   * D12.7: with `coverage.children`, the child coverage files this run
   * read and dropped, over its files; absent with the key off.
   */
  readonly children?: ChildFiles;
  /**
   * D15.3: node:test only, each entry's `prepare` that its selected files
   * waited for, by entry; absent when none. The files it kept from running
   * are its `notRun`, not in `notFinished`.
   */
  readonly prepare?: readonly PrepareRun[];
  /**
   * D17.1: the estimate told before the first run, of the files this
   * command ran here; absent when none was to run. Advice: the verdict does
   * not read it.
   */
  readonly estimate?: Omit<RunEstimate, "runner">;
  readonly durationMs: number | null;
}

/**
 * D7: every policy value read at the base (D6): the gate's limits and skip
 * list, and the keys D2 counted by, each named after its 015 key.
 */
export interface GateReportPolicy extends GatePolicy {
  /** `complexity.include`. */
  readonly complexityInclude: readonly string[];
  /** `complexity.exclude`. */
  readonly complexityExclude: readonly string[];
  /** `complexity.maxFileBytes`. */
  readonly complexityMaxFileBytes: number;
  /**
   * D12.7: `coverage.children`, present only when it is on, so a report
   * with the key off is byte for byte as before.
   */
  readonly coverageChildren?: true;
  /** D14.3: `gate.groups` as kept, `null` when not set; absent when the caller gave no scope. */
  readonly gateGroups?: readonly string[] | null;
}

export interface GateReport {
  readonly format: typeof GATE_REPORT_FORMAT;
  readonly createdAt: string;
  readonly versions: GateVersions;
  /** The merge base and the policy read there (D6). */
  readonly base: {
    readonly ref: string;
    readonly commit: string;
    readonly policy: GateReportPolicy;
  };
  readonly head: {
    readonly commit: string;
    readonly dirty: boolean;
    /**
     * Each changed path the gate counted, or could not count, with its blob
     * at the head; a path that is not a regular file there has none and is
     * left out (amended 2026-11-10, review 0.1.423 S1).
     */
    readonly paths: readonly { readonly path: RelativePath; readonly blob: FileHash }[];
  };
  readonly budget: { readonly seconds: number; readonly timedOut: boolean };
  /** D14.3: the groups in scope, and each group left out; absent when the caller gave no scope. */
  readonly scope?: {
    readonly groups: readonly ScopeGroup[];
    readonly leftOut: readonly LeftOutGroup[];
  };
  readonly functions: readonly GateFunctionReport[];
  /**
   * D16: the head functions a changed line touches that D2 does not
   * judge, with why; sorted by path, name and occurrence. Absent when the
   * inventory gave none (row 020-18).
   */
  readonly omitted?: readonly OmittedFunction[];
  readonly uncounted: readonly GatePathReport[];
  /** D8: present when an exceptions file was given: its entries that applied to no function. */
  readonly exceptions?: { readonly unused: readonly GateUnusedException[] };
  readonly runs: readonly GateRunReport[];
  readonly verdict: GateVerdict;
  /** The functions in each state. */
  readonly counts: Readonly<Record<GateState, number>>;
}

/** What the runs say of the verdict, whatever function they load. */
export interface RunsStanding {
  /** A selected test failed (D5.5). */
  readonly failed: boolean;
  /** A selected test file did not finish (D3.4). */
  readonly unfinished: boolean;
}

/**
 * D5: `violations` when one function is a violation; else `incomplete`
 * when one is incomplete, a changed path was not counted, a selected test
 * failed or a selected test file did not finish; else `pass`. D8:
 * `accepted` counts beside `pass`.
 */
export function verdictOf(
  functions: readonly Pick<GateFunctionReport, "state">[],
  uncounted: readonly unknown[],
  runs: RunsStanding,
): GateVerdict {
  if (functions.some((f) => f.state === "violation")) return "violations";
  if (
    runs.failed ||
    runs.unfinished ||
    uncounted.length > 0 ||
    functions.some((f) => f.state === "incomplete")
  ) {
    return "incomplete";
  }
  return "pass";
}

export function countStates(
  functions: readonly Pick<GateFunctionReport, "state">[],
): Record<GateState, number> {
  const counts: Record<GateState, number> = {
    pass: 0,
    violation: 0,
    incomplete: 0,
    skipped: 0,
    accepted: 0,
  };
  for (const f of functions) counts[f.state] += 1;
  return counts;
}

const sorted = (paths: Iterable<RelativePath>) => [...new Set(paths)].sort(compare);

/** D7's `runs`: each runner that selected a file or ran, in a fixed order. */
export function runsOf(evidence: Evidence, durationsMs: GateTimes["durationsMs"]): GateRunReport[] {
  return GATE_RUNNERS.flatMap((runner) => {
    const files = evidence.testFiles.filter((f) => f.runner === runner);
    const durationMs = durationsMs[runner] ?? null;
    if (files.length === 0 && durationMs === null) return [];
    const failed = files
      .filter((f) => f.failed.length > 0)
      .map((f) => ({ path: f.path, tests: [...f.failed].sort(compare) }))
      .sort((a, b) => compare(a.path, b.path));
    const from = sourcesOf(files);
    const children = childFilesOf(files);
    const prepare = runner === "node-test" ? preparesOf(evidence) : null;
    const estimate = evidence.estimates?.find((e) => e.runner === runner);
    return [
      {
        runner,
        selected: sorted(files.map((f) => f.path)),
        completed: sorted(files.filter((f) => f.completed).map((f) => f.path)),
        notFinished: sorted(files.filter(unfinished).map((f) => f.path)),
        failed,
        ...(from === null ? {} : { from }),
        ...(children === null ? {} : { children }),
        ...(prepare === null ? {} : { prepare }),
        ...(estimate === undefined ? {} : { estimate: withoutRunner(estimate) }),
        durationMs,
      },
    ];
  });
}

const withoutRunner = ({ seconds, files, known, width }: RunEstimate) => ({
  seconds,
  files,
  known,
  width,
});

/** A file that started and did not finish; one its `prepare` kept from running is not (D15.3). */
const unfinished = (f: TestFileEvidence) => !f.completed && f.notPrepared !== true;

/** D15.3: the `prepare` runs, by entry; `null` when none. */
function preparesOf(evidence: Evidence): PrepareRun[] | null {
  const runs = evidence.prepares ?? [];
  if (runs.length === 0) return null;
  return [...runs]
    .map((run) => ({ ...run, notRun: [...run.notRun].sort(compare) }))
    .sort((a, b) => compare(a.project, b.project));
}

/** Each file's evidence source, by path; `null` when this command ran every one. */
function sourcesOf(
  files: readonly TestFileEvidence[],
): Record<RelativePath, GateEvidenceSource> | null {
  if (files.every((f) => f.from === undefined)) return null;
  const byPath = [...files].sort((a, b) => compare(a.path, b.path));
  return Object.fromEntries(byPath.map((f) => [f.path, f.from ?? "run"]));
}

/** D12.7: the sum of the files' child coverage files; `null` when none counts them. */
function childFilesOf(files: readonly TestFileEvidence[]): ChildFiles | null {
  const counted = files.flatMap((f) => (f.children === undefined ? [] : [f.children]));
  if (counted.length === 0) return null;
  return {
    read: counted.reduce((sum, c) => sum + c.read, 0),
    dropped: counted.reduce((sum, c) => sum + c.dropped, 0),
  };
}

/** The report's order of functions: by path, then where each starts, then identity. */
export function byPosition(a: GateFunctionReport, b: GateFunctionReport): number {
  return (
    compare(a.path, b.path) ||
    a.line - b.line ||
    compare(a.qualifiedName, b.qualifiedName) ||
    a.occurrence - b.occurrence
  );
}
