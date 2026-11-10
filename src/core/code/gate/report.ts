import { compare } from "../../fs/compare.js";
import type { RelativePath } from "../../types/common.js";
import type { FileHash } from "../../types/keys.js";
import type {
  ChangeKind,
  Evidence,
  GATE_REPORT_FORMAT,
  GateGap,
  GatePolicy,
  GateState,
  GateVerdict,
  TestFileEvidence,
  UncountedPath,
} from "./types.js";

/*
 * Spec 020 D7: the report of `squeal code --base --json`, format
 * `squeal-code-gate/1`. Every list is sorted, so the same inputs give the
 * same report; its only times are `createdAt` and the runs' durations,
 * which the caller passes in.
 */

export type GateRunner = TestFileEvidence["runner"];

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
  };
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
  readonly functions: readonly GateFunctionReport[];
  readonly uncounted: readonly GatePathReport[];
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
 * failed or a selected test file did not finish; else `pass`.
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
  const counts: Record<GateState, number> = { pass: 0, violation: 0, incomplete: 0, skipped: 0 };
  for (const f of functions) counts[f.state] += 1;
  return counts;
}

const RUNNERS: readonly GateRunner[] = ["vitest", "node-test"];

const sorted = (paths: Iterable<RelativePath>) => [...new Set(paths)].sort(compare);

/** D7's `runs`: each runner that selected a file or ran, in a fixed order. */
export function runsOf(evidence: Evidence, durationsMs: GateTimes["durationsMs"]): GateRunReport[] {
  return RUNNERS.flatMap((runner) => {
    const files = evidence.testFiles.filter((f) => f.runner === runner);
    const durationMs = durationsMs[runner] ?? null;
    if (files.length === 0 && durationMs === null) return [];
    const failed = files
      .filter((f) => f.failed.length > 0)
      .map((f) => ({ path: f.path, tests: [...f.failed].sort(compare) }))
      .sort((a, b) => compare(a.path, b.path));
    return [
      {
        runner,
        selected: sorted(files.map((f) => f.path)),
        completed: sorted(files.filter((f) => f.completed).map((f) => f.path)),
        notFinished: sorted(files.filter((f) => !f.completed).map((f) => f.path)),
        failed,
        durationMs,
      },
    ];
  });
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
