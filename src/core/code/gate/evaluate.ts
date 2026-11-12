import { compare } from "../../fs/compare.js";
import { createInputMatcher } from "../../keys/glob.js";
import type { RelativePath } from "../../types/common.js";
import type { FileHash } from "../../types/keys.js";
import type { CoverageSource } from "../coverage/types.js";
import { type JoinedFunction, joinCoverage } from "../crap/join.js";
import { applyExceptions, type Judged } from "./exceptions.js";
import { byIdentity } from "./omitted.js";
import type { BasePolicy } from "./policy.js";
import {
  byPosition,
  countStates,
  type EngineVersions,
  type GateFunctionReport,
  type GatePathReport,
  type GateReport,
  type GateTimes,
  verdictOf,
} from "./report.js";
import { judgeFunction, type MissingGap, type RuleCoverage, UNRUN_GAPS } from "./rule.js";
import { runsOf } from "./runs.js";
import { leftOutLoaders } from "./scope.js";
import {
  type ChangedFunction,
  type ChangedSet,
  type CountedPath,
  type Evidence,
  type ExceptionEntry,
  GATE_REPORT_FORMAT,
  type GateGap,
  QUALITY_POLICY_VERSION,
  type TestFileEvidence,
} from "./types.js";

/*
 * Spec 020 D5: each changed function's state from the evidence of the
 * runs, under the policy read at the base, and the verdict. Pure: no I/O
 * and no clock. The join is 015 D9's over every counted function of the
 * path, so a nested function's lines are never its parent's; the score is
 * 015's CRAP.
 */

/** What one selected test file says of one source (D5.2, D5.3). */
type Standing =
  /** Its whole record, at the head bytes: the source's entry, or `null` when it ran none of it. */
  | { readonly kind: "measured"; readonly source: CoverageSource | null }
  /** It loads the source, or may, and gives no record of these bytes. */
  | { readonly kind: "missing"; readonly gap: GateMissing }
  | { readonly kind: "none" };

/**
 * The gate's missing gaps (D5): a loader that did not finish, one with no
 * record of these bytes, or one its `prepare` kept from running (D15.3).
 */
type GateMissing = Extract<MissingGap, "not-finished" | "no-record" | "not-prepared">;

function standing(file: TestFileEvidence, path: RelativePath, blob: FileHash): Standing {
  const loads = file.loads === null ? null : file.loads.includes(path);
  const record = file.completed ? file.record : null;
  if (record === null) {
    if (loads === false) return { kind: "none" };
    if (file.notPrepared === true) return { kind: "missing", gap: "not-prepared" };
    return { kind: "missing", gap: file.completed ? "no-record" : "not-finished" };
  }
  if (record.unread.includes(path)) return { kind: "missing", gap: "no-record" };
  const source = record.sources.find((s) => s.path === path);
  if (source !== undefined) {
    return source.blob === blob
      ? { kind: "measured", source }
      : { kind: "missing", gap: "no-record" };
  }
  return loads === true ? { kind: "measured", source: null } : { kind: "none" };
}

/** One source's evidence over every selected test file. */
interface PathEvidence {
  readonly expected: readonly RelativePath[];
  readonly measured: readonly RelativePath[];
  /** The first gap of a loader with no record of these bytes; `null` when every one has. */
  readonly missing: GateMissing | null;
  /** A loader skipped a test (D11.3). */
  readonly skipped: boolean;
  /** The join over every counted function of the path; `null` with no record in hand. */
  readonly joined: readonly JoinedFunction[] | null;
}

function pathEvidence(
  counted: CountedPath | undefined,
  path: RelativePath,
  blob: FileHash,
  files: readonly TestFileEvidence[],
): PathEvidence {
  const standings = files.map((file) => ({ file, at: standing(file, path, blob) }));
  const paths = (kind: Standing["kind"]) =>
    [...new Set(standings.filter((s) => s.at.kind === kind).map((s) => s.file.path))].sort(compare);
  const measured = paths("measured");
  const expected = [...new Set([...measured, ...paths("missing")])].sort(compare);
  const gaps = standings.flatMap((s) => (s.at.kind === "missing" ? [s.at.gap] : []));
  // The gaps that rule out a pass come first: a loader that did not run whole.
  const missing = UNRUN_GAPS.find((gap) => gaps.includes(gap)) ?? gaps[0] ?? null;
  const skipped = standings.some((s) => s.at.kind !== "none" && s.file.skipped);
  const sources = standings.flatMap((s) =>
    s.at.kind === "measured" && s.at.source !== null ? [s.at.source] : [],
  );
  const joined =
    counted === undefined || measured.length === 0
      ? null
      : joinCoverage(counted.functions, sources, missing !== null);
  return { expected, measured, missing, skipped, joined };
}

interface Context {
  readonly policy: BasePolicy;
  readonly excluded: (path: RelativePath) => boolean;
  /** A selected test failed (D5.5). */
  readonly failed: boolean;
  readonly evidenceOf: (fn: ChangedFunction) => PathEvidence;
  readonly counted: (path: RelativePath) => CountedPath | undefined;
  /** D14.2: the selected test files that load a source, or may, and that the scope left out. */
  readonly leftOut: (path: RelativePath) => readonly RelativePath[];
}

type Judgement = Pick<GateFunctionReport, "state" | "gap">;
type Measures = Pick<GateFunctionReport, "coverage" | "crap" | "loaders">;

function report(fn: ChangedFunction, measures: Measures, judgement: Judgement): GateFunctionReport {
  const { count } = fn;
  return {
    path: fn.path,
    qualifiedName: count.qualifiedName,
    occurrence: count.occurrence,
    line: count.range.startLine,
    bodyHash: count.bodyHash,
    change: fn.change,
    complexity: count.complexity,
    ...measures,
    ...judgement,
  };
}

const UNMEASURED: Measures = {
  coverage: null,
  crap: null,
  loaders: { expected: [], measured: [] },
};
const gapOf = (gap: GateGap): Judgement => ({ state: "incomplete", gap });
const stateOf = ({ state, gap }: Judgement): Judgement => ({ state, gap });

/** The function's coverage from the records in hand, when the join resolved it. */
function coverageOf(fn: ChangedFunction, ev: PathEvidence, ctx: Context): RuleCoverage | null {
  const { qualifiedName, occurrence } = fn.count;
  const index = ctx
    .counted(fn.path)
    ?.functions.findIndex((f) => f.qualifiedName === qualifiedName && f.occurrence === occurrence);
  const joined = index === undefined || index < 0 ? undefined : ev.joined?.[index];
  if (joined === undefined || joined.ran === null) return null;
  const { lines, covered, coverage: share, ran } = joined;
  return { lines, covered, share, ran };
}

/**
 * D5 by D11's rule (`judgeFunction`): one changed function counted outside
 * a parse error, what its evidence alone says, and whether that evidence is
 * complete (D8 reads both). A `coverage.exclude` file wants no evidence.
 */
function judge(fn: ChangedFunction, ctx: Context): Judged {
  const { complexity } = fn.count;
  if (ctx.excluded(fn.path)) {
    const out = judgeFunction<GateMissing>(
      {
        complexity,
        excluded: true,
        loaders: { expected: 0, measured: 0 },
        missing: null,
        coverage: null,
        failed: ctx.failed,
        skipped: false,
      },
      ctx.policy,
    );
    return {
      row: report(fn, UNMEASURED, stateOf(out)),
      evidence: out.evidence,
      gap: out.completeness,
    };
  }
  const ev = ctx.evidenceOf(fn);
  const left = ctx.leftOut(fn.path);
  const coverage = coverageOf(fn, ev, ctx);
  const out = judgeFunction(
    {
      complexity,
      excluded: false,
      loaders: { expected: ev.expected.length, measured: ev.measured.length },
      missing: ev.missing,
      coverage,
      failed: ctx.failed,
      skipped: ev.skipped,
      leftOut: left.length,
    },
    ctx.policy,
  );
  const leftOut = left.length === 0 ? {} : { leftOut: left };
  const measures: Measures = {
    coverage:
      coverage === null
        ? null
        : { lines: coverage.lines, covered: coverage.covered, share: coverage.share },
    crap: out.crap,
    loaders: { expected: ev.expected, measured: ev.measured, ...leftOut },
  };
  return { row: report(fn, measures, stateOf(out)), evidence: out.evidence, gap: out.completeness };
}

/** D2.5: a changed function inside a parse error is not counted. */
function inError(fn: ChangedFunction): Judged {
  const notCounted = gapOf("not-counted");
  return { row: report(fn, UNMEASURED, notCounted), evidence: notCounted, gap: "not-counted" };
}

/**
 * D7's `head.paths`: each counted path and each uncounted regular file with
 * its head blob, once (a parse-error path is both), sorted.
 */
function headPaths(changed: ChangedSet): GateReport["head"]["paths"] {
  const blobs = new Map<RelativePath, FileHash>();
  for (const { path, blob } of [...changed.counted, ...changed.uncounted]) {
    if (blob !== undefined) blobs.set(path, blob);
  }
  return [...blobs].map(([path, blob]) => ({ path, blob })).sort((a, b) => compare(a.path, b.path));
}

/**
 * Spec 020 D5 to D8: the report of `changed` judged with `evidence` under
 * `policy`, read at the base with its counting keys, and the `exceptions`
 * entries when a file gave them. `versions` and `times` are the caller's,
 * so the same inputs give the same report.
 */
export function evaluate(
  changed: ChangedSet,
  evidence: Evidence,
  policy: BasePolicy,
  versions: EngineVersions,
  times: GateTimes,
  exceptions?: readonly ExceptionEntry[],
): GateReport {
  const counted = new Map(changed.counted.map((c) => [c.path, c]));
  const cache = new Map<string, PathEvidence>();
  const ctx: Context = {
    policy,
    excluded: createInputMatcher(policy.coverageExclude),
    failed: evidence.testFiles.some((f) => f.failed.length > 0),
    counted: (path) => counted.get(path),
    leftOut: (path) => leftOutLoaders(evidence.scope?.files ?? [], path),
    evidenceOf: ({ path, blob }) => {
      const key = `${path}\0${blob}`;
      const known = cache.get(key);
      if (known !== undefined) return known;
      const ev = pathEvidence(counted.get(path), path, blob, evidence.testFiles);
      cache.set(key, ev);
      return ev;
    },
  };
  const judged = [
    ...changed.functions.map((fn) => judge(fn, ctx)),
    ...changed.inErrors.map(inError),
  ];
  const applied =
    exceptions === undefined
      ? null
      : applyExceptions(judged, exceptions, changed.baseCounted ?? [], {
          policy,
          baseCommit: changed.baseCommit,
        });
  const functions = (applied?.functions ?? judged.map((j) => j.row)).sort(byPosition);
  const { incompleteClosures } = evidence;
  const uncounted: GatePathReport[] = changed.uncounted
    .map((u) => ({ path: u.path, reason: u.reason, gap: "not-counted" as const }))
    .sort((a, b) => compare(a.path, b.path) || compare(a.reason, b.reason));
  return {
    format: GATE_REPORT_FORMAT,
    createdAt: times.createdAt,
    versions: { ...versions, qualityPolicy: QUALITY_POLICY_VERSION },
    base: {
      ref: changed.ref,
      commit: changed.baseCommit,
      policy: {
        complexityThreshold: policy.complexityThreshold,
        crapThreshold: policy.crapThreshold,
        coverageExclude: [...policy.coverageExclude],
        complexityInclude: [...policy.include],
        complexityExclude: [...policy.exclude],
        complexityMaxFileBytes: policy.maxFileBytes,
        ...(policy.children ? { coverageChildren: true as const } : {}),
        ...(policy.scope === undefined ? {} : { gateGroups: policy.scope.configured }),
      },
    },
    head: { commit: changed.headCommit, dirty: changed.dirty, paths: headPaths(changed) },
    budget: budgetOf(evidence),
    ...(evidence.scope === undefined
      ? {}
      : { scope: { groups: evidence.scope.inScope, leftOut: evidence.scope.leftOut } }),
    functions,
    ...(changed.omitted === undefined ? {} : { omitted: [...changed.omitted].sort(byIdentity) }),
    uncounted,
    ...(applied === null ? {} : { exceptions: { unused: applied.unused } }),
    runs: runsOf(evidence, times.durationsMs),
    ...(incompleteClosures === undefined ? {} : { incompleteClosures }),
    verdict: verdictOf(functions, uncounted, {
      failed: ctx.failed,
      unfinished: evidence.testFiles.some((f) => !f.completed),
    }),
    counts: countStates(functions),
  };
}

/** D7's `budget`; row 020-45: the rerun that fits, when the estimate was over what was left. */
function budgetOf(evidence: Evidence): GateReport["budget"] {
  const { budgetSeconds: seconds, timedOut, rerun } = evidence;
  return { seconds, timedOut, ...(rerun === undefined ? {} : { rerun }) };
}
