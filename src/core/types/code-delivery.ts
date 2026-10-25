import type { CodeCheckId, CodeMeasure, CodeTransitionKind } from "./code.js";
import type { EpochMs, RelativePath, RevisionNumber } from "./common.js";

/*
 * Spec 015 D6: what a delivery, a registration and status say about the
 * code. Each is absent while `complexity.enabled` is off, so every payload
 * is then the one the release before sent (goal 1).
 */

/** Spec 015 D6: at most this many code changes are told in full in one delivery. */
export const CODE_LISTED_MAX = 5;

/**
 * What a told code entry says: a transition (D5); `edited`, the first edit
 * in a session to a function over the threshold before and after it (D6,
 * its last rule); or `edited-after-fail`, the first edit after a FAIL told
 * in this session that leaves the function over (015-21).
 */
export type CodeDeltaKind = CodeTransitionKind | "edited" | "edited-after-fail";

/** One code change told in full (D5's delivered rows). */
export interface CodeDeltaEntry {
  readonly check: CodeCheckId;
  readonly measure: CodeMeasure;
  readonly kind: CodeDeltaKind;
  /** The value now; for `removed`, the last one known, `null` when none was. */
  readonly value: number | null;
  readonly threshold: number | null;
  /** The function's first line now; `null` for `removed`. */
  readonly line: number | null;
  /** The revision the change was recorded at. */
  readonly revision: RevisionNumber;
  /**
   * Spec 015 D9 (row 015-12): what a `crap` or `uncovered` line names as
   * evidence. Absent for `complexity`, and while none is stored.
   */
  readonly evidence?: CodeCoverageEvidence;
}

/** Spec 015 D9: the CC, the coverage and the test files that run a function, at its last judgement. */
export interface CodeCoverageEvidence {
  readonly complexity: number;
  /** Its own lines that can run, and of those the ones that ran. */
  readonly lines: number;
  readonly covered: number;
  /** The test files that ran it in their own process, and the first of them by path. */
  readonly testFiles: number;
  readonly first: readonly RelativePath[];
}

/**
 * Spec 015 D4, D6: the record the daemon writes in the code store's meta
 * (`recount:<worktreeId>`) when a count changes states without a transition
 * per function: `first`, a first count done (the policy switched on);
 * `threshold`, `include` (`maxFileBytes` too) and `counter`, a recount after
 * that key changed, the first of them that did.
 */
export interface CodeRecount {
  readonly revision: RevisionNumber;
  readonly at: EpochMs;
  readonly reason: "first" | "threshold" | "include" | "counter";
  readonly threshold: number;
}

/** Spec 015 D6: one file over `complexity.maxFileBytes` an edit changed, told once per consumer. */
export interface CodeTooBig {
  readonly path: RelativePath;
  readonly size: number;
  readonly limit: number;
}

/** Row 015-49: at most this many changed files not judged are named in one line. */
export const CODE_NOT_JUDGED_MAX = 3;

/**
 * Spec 015 D6, a changed file not judged (row 015-49): a file the
 * consumer's own edit changed that is over `complexity.maxFileBytes`, or
 * that the counter failed on at every attempt.
 */
export type CodeNotJudged =
  | ({ readonly reason: "too-big" } & CodeTooBig)
  | { readonly path: RelativePath; readonly reason: "could-not-count" };

/** Spec 015 D6: the code part of a delivery; `Delta.code`, absent when there is none. */
export interface CodeNews {
  readonly v: 1;
  /** At most `CODE_LISTED_MAX`, failures first. */
  readonly entries: readonly CodeDeltaEntry[];
  /** The changes past `entries`: `and N more complexity changes`. */
  readonly more: number;
  /**
   * Spec 015 D9 (row 015-12): a change of a `crap` or `uncovered` state is
   * among the changes, so their number is worded as code changes. Absent
   * when every change is of complexity.
   */
  readonly coverage?: true;
  /** A recount since the consumer's view was seeded; the view is seeded again by count. */
  readonly recount?: CodeRecount & { readonly over: number };
  /**
   * Row 015-40: a `crap.threshold` change since the consumer's view was
   * seeded, `over` the functions over CRAP `threshold` now; the view is
   * seeded again by count.
   */
  readonly crapRecount?: {
    readonly revision: RevisionNumber;
    readonly at: EpochMs;
    readonly threshold: number;
    readonly over: number;
  };
  readonly tooBig?: readonly CodeTooBig[];
  /**
   * Row 015-27: on a delivery with test entries, the functions over
   * `threshold` now that the consumer was told of in full, as a `FAIL` or a
   * `STILL FAIL`. Absent when there is none, and from an older Squeal; with
   * it, `entries` can be empty. Row 015-40: `crap`, those over CRAP
   * `threshold`, and `uncovered`, those no in-process test reaches, told
   * the same way; each absent when none is, and then `count` can be 0.
   */
  readonly toldOver?: {
    readonly count: number;
    readonly threshold: number;
    readonly crap?: { readonly count: number; readonly threshold: number };
    readonly uncovered?: number;
  };
  /**
   * Row 015-49: on a delivery with test entries, the files the consumer's
   * own edit changed that are not judged, at most `CODE_NOT_JUDGED_MAX`,
   * the newest edit first, and the number of the rest. Absent when none
   * is, and from an older Squeal; with it, `toldOver` can be absent.
   */
  readonly notJudged?: { readonly files: readonly CodeNotJudged[]; readonly more: number };
}

/** Spec 015 D6: the registration's line; `Registration.code`. */
export interface CodeRegistration {
  readonly v: 1;
  readonly threshold: number;
  /** Functions over the threshold now. */
  readonly over: number;
  /** While the first count runs: files counted and files included. */
  readonly counting?: { readonly done: number; readonly total: number };
}

/**
 * Spec 015 D6: `StatusSnapshot.code`. `sinceRegistration` counts the
 * functions that went over after the registration `since` names: the
 * session `status` runs in, or else the oldest registration of the
 * worktree; `null` names none, so the count is 0.
 */
export interface CodeStatus {
  readonly v: 1;
  readonly threshold: number;
  readonly over: number;
  readonly sinceRegistration: number;
  readonly since: "session" | "oldest" | null;
  /** Included files not counted yet. */
  readonly pending: number;
  /** Included files, counted or not; files too big to count left out. */
  readonly files: number;
  /** Functions in a parse error's range. */
  readonly unknown: number;
  /**
   * Included files the counter failed on at every attempt, `unknown` until
   * their bytes change; neither in `pending` nor `files` (row 015-18).
   * Absent when there are none.
   */
  readonly uncountable?: number;
  /** Spec 015 D9 (row 015-12): absent while coverage is off or not judged yet. */
  readonly coverage?: CodeCoverageStatus;
}

/**
 * Spec 015 D9 (row 015-12): `CodeStatus.coverage`. `crap` and `uncovered`
 * count functions failing; the rest count files, which keep their last
 * judged states while they wait or are unknown.
 */
export interface CodeCoverageStatus {
  readonly v: 1;
  /** `crap.threshold`. */
  readonly threshold: number;
  readonly crap: number;
  readonly uncovered: number;
  /** Counted files the coverage step reads. */
  readonly files: number;
  /** Files a test file that loads them has no current result for: `squeal run --all` runs them. */
  readonly waitingForRuns: number;
  /** Files whose loaders all ran, a record not stored yet. */
  readonly waitingForRecords: number;
  /**
   * Files that wait for test files whose imports the daemon does not know
   * yet, any of which may load them (review 0.1.297 B3); absent when none.
   */
  readonly waitingForImports?: { readonly files: number; readonly testFiles: number };
  /** Files by why a loader can have no record. */
  readonly unknown: Readonly<
    Partial<Record<"no-record" | "skipped" | "unkeyed" | "unread", number>>
  >;
  /** `vitest.exclude` globs and `vitest.excludeProjects` names: their test files are not read. */
  readonly notRead?: readonly string[];
}
