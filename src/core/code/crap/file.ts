import { createHash } from "node:crypto";
import { compare } from "../../fs/index.js";
import type { FunctionCount } from "../../types/code.js";
import type { CheckKey, EpochMs, FileHash, RelativePath, TestFileRef } from "../../types/index.js";
import type { CoverageRecord, CoverageSource } from "../coverage/types.js";
import { joinCoverage } from "./join.js";
import type { Loader, PendingReason, UnknownCause } from "./loaders.js";

/*
 * Spec 015 D9 for one source: whether its functions can be judged, from the
 * conditions of the test files that load it, and if so each function's
 * coverage from their records.
 */

/**
 * What can be said of a source's coverage now. A pending or unknown one
 * names its ready loaders, whose records in hand can prove a pass (row
 * 015-57). A ready or unknown one names its loader set (`loaderSet`), and
 * an unknown one with no record coming names the runners that give none
 * (row 015-75).
 */
export type FileCondition =
  | {
      readonly state: "ready";
      readonly loaders: readonly ReadyLoader[];
      readonly set: string;
    }
  | {
      readonly state: "pending";
      readonly reason: PendingReason;
      readonly waiting: number;
      readonly ready: readonly ReadyLoader[];
    }
  | {
      readonly state: "unknown";
      readonly cause: UnknownCause;
      readonly ready: readonly ReadyLoader[];
      readonly set: string;
      readonly runners?: readonly string[];
    };

export interface ReadyLoader {
  readonly testFile: TestFileRef;
  readonly key: CheckKey;
  /** When its record was stored: each record at a key has its own (row 015-44). */
  readonly storedAt: EpochMs;
}

/** The order a source's `unknown` names its cause in, when its loaders give several. */
const CAUSES: readonly UnknownCause[] = ["unkeyed", "skipped", "no-record", "unread"];

/** The order a pending source names why it waits, the furthest from a judgement first. */
const REASONS: readonly PendingReason[] = ["imports", "run", "record"];

/**
 * Pending until every loader has a current result with a record; unknown
 * while one cannot have one (D9). A source no test file loads is ready
 * with no loader, once the worktree has test files listed.
 */
export function fileCondition(loaders: readonly Loader[], listed: boolean): FileCondition {
  if (!listed) return { state: "pending", reason: "run", waiting: 0, ready: [] };
  const ready = loaders.flatMap((l) =>
    l.condition.kind === "ready"
      ? [{ testFile: l.testFile, key: l.condition.key, storedAt: l.condition.storedAt }]
      : [],
  );
  const causes = new Set(
    loaders.flatMap((l) => (l.condition.kind === "unknown" ? [l.condition.cause] : [])),
  );
  const cause = CAUSES.find((c) => causes.has(c));
  if (cause !== undefined) {
    const runners = cause === "no-record" ? runnersOf(loaders) : [];
    const named = runners.length === 0 ? {} : { runners };
    return { state: "unknown", cause, ready, set: loaderSet(loaders), ...named };
  }
  const waiting = loaders.flatMap((l) => (l.condition.kind === "pending" ? [l.condition] : []));
  if (waiting.length > 0) {
    const reason = REASONS.find((r) => waiting.some((w) => w.reason === r)) ?? "record";
    return { state: "pending", reason, waiting: waiting.length, ready };
  }
  return { state: "ready", loaders: ready, set: loaderSet(loaders) };
}

/**
 * Row 015-75: the test files that load a source, hashed short, so a
 * summary can keep the set its states were judged with. A test file whose
 * closure is not known yet may load any source and is left out.
 */
export function loaderSet(loaders: readonly Pick<Loader, "testFile" | "condition">[]): string {
  const files = loaders
    .filter((l) => l.condition.kind !== "pending" || l.condition.reason !== "imports")
    .map((l) => `${l.testFile.project}\0${l.testFile.path}`)
    .sort(compare);
  return createHash("sha1").update(files.join("\n")).digest("hex").slice(0, 16);
}

/** Row 015-75: the runners of a source's loaders that give no record, sorted. */
function runnersOf(loaders: readonly Loader[]): string[] {
  const runners = loaders.flatMap((l) =>
    l.condition.kind === "unknown" && l.condition.runner !== undefined ? [l.condition.runner] : [],
  );
  return [...new Set(runners)].sort(compare);
}

/** One function's coverage, as its states and lines tell it. */
export interface FunctionCoverage {
  /** Its own lines that can run, and of those the ones that ran. */
  readonly lines: number;
  readonly covered: number;
  /** 0 to 1; 0 when no in-process test ran it. */
  readonly coverage: number;
  /** The test files that ran it, sorted. */
  readonly runBy: readonly RelativePath[];
  /** None ran it and a record cannot tell whether it ran, so its states are `unknown` (review 0.1.297 B4). */
  readonly unresolved?: true;
}

/**
 * Each function's coverage from the ready loaders' records, in the count's
 * order; `unread` when a record cannot vouch for the bytes it ran of this
 * source, so it cannot show what it ran here. A loader whose record holds
 * no entry for the source ran none of it. `inHand` (row 015-57): such a
 * record is left out instead, and the coverage is `joinCoverage`'s bound,
 * at most what every record would give (review 0.1.324 B1).
 */
export function coverageOf(
  file: { readonly path: RelativePath; readonly blob: FileHash },
  functions: readonly FunctionCount[],
  loaders: readonly ReadyLoader[],
  record: (key: CheckKey) => CoverageRecord | null,
  inHand = false,
): FunctionCoverage[] | "unread" {
  const sources: CoverageSource[] = [];
  const paths: RelativePath[] = [];
  for (const loader of loaders) {
    const read = record(loader.key);
    const source =
      read === null || read.unread.includes(file.path)
        ? null
        : read.sources.find((s) => s.path === file.path);
    if (source === undefined) continue;
    if (source === null || source.blob !== file.blob) {
      if (inHand) continue;
      return "unread";
    }
    sources.push(source);
    paths.push(loader.testFile.path);
  }
  return joinCoverage(functions, sources, inHand).map((j) => ({
    lines: j.lines,
    covered: j.covered,
    coverage: j.coverage,
    runBy: [...new Set(j.runBy.map((i) => paths[i] ?? ""))].sort(compare),
    ...(j.ran === null ? { unresolved: true as const } : {}),
  }));
}
