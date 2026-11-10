import { compare } from "../../fs/compare.js";
import { createInputMatcher } from "../../keys/glob.js";
import type { RelativePath } from "../../types/common.js";
import type { FileHash } from "../../types/keys.js";
import type { CoverageSource } from "../coverage/types.js";
import { type JoinedFunction, joinCoverage } from "../crap/join.js";
import { crapScore } from "../crap/score.js";
import type { BasePolicy } from "./policy.js";
import {
  byPosition,
  countStates,
  type EngineVersions,
  type GateFunctionReport,
  type GatePathReport,
  type GateReport,
  type GateTimes,
  runsOf,
  verdictOf,
} from "./report.js";
import {
  type ChangedFunction,
  type ChangedSet,
  type CountedPath,
  type Evidence,
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
  | { readonly kind: "missing"; readonly gap: "not-finished" | "no-record" }
  | { readonly kind: "none" };

function standing(file: TestFileEvidence, path: RelativePath, blob: FileHash): Standing {
  const loads = file.loads === null ? null : file.loads.includes(path);
  const record = file.completed ? file.record : null;
  if (record === null) {
    if (loads === false) return { kind: "none" };
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
  readonly missing: "not-finished" | "no-record" | null;
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
  const missing = gaps.includes("not-finished") ? "not-finished" : (gaps[0] ?? null);
  const sources = standings.flatMap((s) =>
    s.at.kind === "measured" && s.at.source !== null ? [s.at.source] : [],
  );
  const joined =
    counted === undefined || measured.length === 0
      ? null
      : joinCoverage(counted.functions, sources, missing !== null);
  return { expected, measured, missing, joined };
}

interface Context {
  readonly policy: BasePolicy;
  readonly excluded: (path: RelativePath) => boolean;
  /** A selected test failed (D5.5). */
  readonly failed: boolean;
  readonly evidenceOf: (fn: ChangedFunction) => PathEvidence;
  readonly counted: (path: RelativePath) => CountedPath | undefined;
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
const PASS: Judgement = { state: "pass", gap: null };
const VIOLATION: Judgement = { state: "violation", gap: null };
const gapOf = (gap: GateGap): Judgement => ({ state: "incomplete", gap });

/** The function's coverage and CRAP from the records in hand, when the join resolved it. */
function measuresOf(fn: ChangedFunction, ev: PathEvidence, ctx: Context): Measures {
  const loaders = { expected: ev.expected, measured: ev.measured };
  const { qualifiedName, occurrence } = fn.count;
  const index = ctx
    .counted(fn.path)
    ?.functions.findIndex((f) => f.qualifiedName === qualifiedName && f.occurrence === occurrence);
  const joined = index === undefined || index < 0 ? undefined : ev.joined?.[index];
  if (joined === undefined || joined.ran === null) return { ...UNMEASURED, loaders };
  return {
    coverage: { lines: joined.lines, covered: joined.covered, share: joined.coverage },
    crap: crapScore(fn.count.complexity, joined.coverage),
    loaders,
  };
}

/**
 * D5: over the CC limit is a violation on the count alone; otherwise the
 * first missing condition names the gap. A loader that did not finish rules
 * out a pass: its later tests never ran (amended 2026-11-10, review 0.1.423
 * B2). The records in hand of a source whose missing loaders all completed
 * prove a pass by 015 D9's bound, never a violation.
 */
function judgementOf(complexity: number, m: Measures, ev: PathEvidence, ctx: Context): Judgement {
  if (complexity > ctx.policy.complexityThreshold) return VIOLATION;
  if (ev.expected.length === 0) return gapOf("no-loader");
  if (ev.missing === "not-finished") return gapOf("not-finished");
  const underCrap = m.crap !== null && m.crap <= ctx.policy.crapThreshold;
  if (ev.missing !== null) return underCrap && !ctx.failed ? PASS : gapOf(ev.missing);
  if (m.crap === null) return gapOf("not-joined");
  if (ctx.failed) return gapOf("test-failed");
  return underCrap ? PASS : VIOLATION;
}

/** D5: one changed function counted outside a parse error. */
function judge(fn: ChangedFunction, ctx: Context): GateFunctionReport {
  if (ctx.excluded(fn.path)) {
    const over = fn.count.complexity > ctx.policy.complexityThreshold;
    return report(fn, UNMEASURED, over ? VIOLATION : { state: "skipped", gap: null });
  }
  const ev = ctx.evidenceOf(fn);
  const measures = measuresOf(fn, ev, ctx);
  return report(fn, measures, judgementOf(fn.count.complexity, measures, ev, ctx));
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
 * Spec 020 D5 to D7: the report of `changed` judged with `evidence` under
 * `policy`, read at the base with its counting keys. `versions` and
 * `times` are the caller's, so the same inputs give the same report.
 */
export function evaluate(
  changed: ChangedSet,
  evidence: Evidence,
  policy: BasePolicy,
  versions: EngineVersions,
  times: GateTimes,
): GateReport {
  const counted = new Map(changed.counted.map((c) => [c.path, c]));
  const cache = new Map<string, PathEvidence>();
  const ctx: Context = {
    policy,
    excluded: createInputMatcher(policy.coverageExclude),
    failed: evidence.testFiles.some((f) => f.failed.length > 0),
    counted: (path) => counted.get(path),
    evidenceOf: ({ path, blob }) => {
      const key = `${path}\0${blob}`;
      const known = cache.get(key);
      if (known !== undefined) return known;
      const ev = pathEvidence(counted.get(path), path, blob, evidence.testFiles);
      cache.set(key, ev);
      return ev;
    },
  };
  const functions = [
    ...changed.functions.map((fn) => judge(fn, ctx)),
    ...changed.inErrors.map((fn) => report(fn, UNMEASURED, gapOf("not-counted"))),
  ].sort(byPosition);
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
      },
    },
    head: { commit: changed.headCommit, dirty: changed.dirty, paths: headPaths(changed) },
    budget: { seconds: evidence.budgetSeconds, timedOut: evidence.timedOut },
    functions,
    uncounted,
    runs: runsOf(evidence, times.durationsMs),
    verdict: verdictOf(functions, uncounted, {
      failed: ctx.failed,
      unfinished: evidence.testFiles.some((f) => !f.completed),
    }),
    counts: countStates(functions),
  };
}
