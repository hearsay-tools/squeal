import type { CodeCheckId, CodeMeasure, CodeTransitionKind } from "./code.js";
import type { EpochMs, RelativePath, RevisionNumber } from "./common.js";

/*
 * Spec 015 D6: what a delivery, a registration and status say about the
 * code. Each is absent while `complexity.enabled` is off, so every payload
 * is then the one the release before sent (goal 1).
 */

/** Spec 015 D6: at most this many code changes are told in full in one delivery. */
export const CODE_LISTED_MAX = 5;

/** One code change told in full (D5's delivered rows). */
export interface CodeDeltaEntry {
  readonly check: CodeCheckId;
  readonly measure: CodeMeasure;
  readonly kind: CodeTransitionKind;
  /** The value now; for `removed`, the last one known, `null` when none was. */
  readonly value: number | null;
  readonly threshold: number | null;
  /** The function's first line now; `null` for `removed`. */
  readonly line: number | null;
  /** The revision the change was recorded at. */
  readonly revision: RevisionNumber;
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

/** Spec 015 D6: the code part of a delivery; `Delta.code`, absent when there is none. */
export interface CodeNews {
  readonly v: 1;
  /** At most `CODE_LISTED_MAX`, failures first. */
  readonly entries: readonly CodeDeltaEntry[];
  /** The changes past `entries`: `and N more complexity changes`. */
  readonly more: number;
  /** A recount since the consumer's view was seeded; the view is seeded again by count. */
  readonly recount?: CodeRecount & { readonly over: number };
  readonly tooBig?: readonly CodeTooBig[];
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
}
