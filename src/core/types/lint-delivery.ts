import type { RelativePath, RevisionNumber } from "./common.js";
import type { LintFinding, LintOutcome, LintTransitionKind } from "./lint.js";

/*
 * Spec 017 D8: what a delivery, a registration, status and `squeal lint`
 * say about lint checks. Each is absent while `lint.enabled` is off, so
 * every payload is then the one the release before sent (goal 1). A file
 * that is `pending`, `unknown` or stale is never told as a `PASS`.
 */

/** Spec 017 D8, after 015 D6: at most this many lint changes are told in full in one delivery. */
export const LINT_LISTED_MAX = 5;

/** One lint change told in full: from what the consumer was told to the file's state now. */
export interface LintNewsEntry {
  readonly path: RelativePath;
  readonly kind: LintTransitionKind;
  /** The file's findings now; 0 for a pass or a removed file; `null` when its result is not stored. */
  readonly findings: number | null;
  /** Evidence only (D2): what the consumer's own edits added and removed, by rule and message. */
  readonly added: readonly LintFinding[];
  readonly removed: readonly LintFinding[];
  /** The revision of the file's last transition. */
  readonly revision: RevisionNumber;
  /** A FAIL whose key moved since it was linted (D5): its findings are the last known, linted again when idle. */
  readonly stale?: true;
}

/** Spec 017 D8: a first lint of every file, or a config, plugin or ESLint change's, ended. */
export interface LintSummary {
  readonly reason: "first" | "config";
  /** The revision the keying ran at. */
  readonly revision: RevisionNumber;
  /** Files with findings now, not stale. */
  readonly failing: number;
  readonly stale: number;
}

/** Spec 017 D8: the lint part of a delivery; absent when there is none. */
export interface LintNews {
  readonly v: 1;
  /** At most `LINT_LISTED_MAX`: failures first, then passes, then removed files. */
  readonly entries: readonly LintNewsEntry[];
  /** The changes past `entries`: `and N more lint changes`. */
  readonly more: number;
  /** Once the keying's files are linted; the consumer's view is seeded again by count. */
  readonly summary?: LintSummary;
  /** D9: why keying fails, as a config that does not load; told when it starts or changes. */
  readonly failed?: string;
  /** D9: why lint is off; told when it starts or changes. */
  readonly off?: string;
}

/** While a first or config keying's files lint: the files linted and the files with a lint state. */
export interface LintProgress {
  readonly done: number;
  readonly total: number;
}

/** Why the surfaces cannot say more; each absent when it does not hold. */
export interface LintReasons {
  /** D9: lint is off, as no ESLint or ESLint 8, or the worker failed 3 times. */
  readonly off?: string;
  /** D9: the last keying failed, as a config that does not load. */
  readonly failed?: string;
  /** The lint store cannot be read: a newer schema or a damaged file. */
  readonly unreadable?: string;
}

/** Spec 017 D8: the registration's line; `Registration.lint`. */
export interface LintRegistration extends LintReasons {
  readonly v: 1;
  /** Files with findings now, not stale. */
  readonly failing: number;
  readonly stale: number;
  readonly linting?: LintProgress;
}

/** The files `unknown` for one reason (D9). */
export interface LintUnknownReason {
  readonly reason: string;
  readonly files: number;
}

/**
 * Spec 017 D8: `StatusSnapshot.lint`. The counts are of files and apart:
 * `failing`, `pending`, `stale` and `unknown` never hold one file twice,
 * and the rest of `files` pass.
 */
export interface LintStatus extends LintReasons {
  readonly v: 1;
  /** Files with a lint state. */
  readonly files: number;
  /** Files with findings at their current key. */
  readonly failing: number;
  /** Of those, the files that went to `fail` in the session's own revisions (D8 Blocking). */
  readonly sinceRegistration: number;
  /** Whose registration `sinceRegistration` counts from; `null` names none, so it is 0. */
  readonly since: "session" | "oldest" | null;
  readonly pending: number;
  /** Whole-program files whose key moved (D5), their last outcome kept. */
  readonly stale: number;
  readonly unknown: number;
  /** The unknown files by reason, the most first. */
  readonly reasons: readonly LintUnknownReason[];
  readonly linting?: LintProgress;
}

/** One file as `squeal lint` shows it. */
export interface LintFileDetail {
  readonly path: RelativePath;
  readonly outcome: LintOutcome;
  readonly stale: boolean;
  /** The last judged result's findings, in ESLint's order; `null` when its result is not stored. */
  readonly findings: readonly LintFinding[] | null;
  /** The revision that result was linted at; `null` before the first. */
  readonly revision: RevisionNumber | null;
  /** Why the file is `unknown` (D9); `null` otherwise. */
  readonly reason: string | null;
}

/** Spec 017 D8: `squeal lint [<path>...]`, read from the store with no daemon. */
export interface LintDetails extends LintReasons {
  readonly v: 1;
  /** With no path, every file with findings, newest first; with paths, each of them that has a state. */
  readonly files: readonly LintFileDetail[];
  /** Paths asked for that have no lint state: ESLint or the policy does not lint them. */
  readonly notLinted: readonly RelativePath[];
  /** Over the worktree: files not linted at their bytes yet, stale and unknown. */
  readonly pending: number;
  readonly stale: number;
  readonly unknown: number;
  readonly linting?: LintProgress;
}

/** One file `squeal lint --changed` lists: its last transition, and its state now. */
export interface LintChangedEntry {
  readonly path: RelativePath;
  readonly kind: LintTransitionKind;
  readonly added: readonly LintFinding[];
  readonly removed: readonly LintFinding[];
  readonly revision: RevisionNumber;
  /** `null` when the file has no state now: it is gone or not linted. */
  readonly outcome: LintOutcome | null;
  readonly stale: boolean;
  /** The findings now; `null` when none is stored or the file has no state. */
  readonly findings: number | null;
  readonly reason: string | null;
}

/** Spec 017 D8: `squeal lint --changed`, the files whose last change is the session's own. */
export interface LintChanged extends LintReasons {
  readonly v: 1;
  readonly since: "session" | "oldest" | null;
  /** Newest first. */
  readonly entries: readonly LintChangedEntry[];
}

/** One file Stop counts with `lint.blocking` (D8). */
export interface LintStopFile {
  readonly path: RelativePath;
  readonly findings: number | null;
  /** The revision of its transition to `fail`. */
  readonly revision: RevisionNumber;
}

/**
 * Spec 017 D8 Blocking: what Stop's completion check counts with
 * `lint.blocking` on. Only a file failing at its current key that went to
 * `fail` in the consumer's own revisions counts; one failing before, or
 * not linted at its bytes, never does.
 */
export interface LintStopEvidence {
  readonly v: 1;
  readonly files: readonly LintStopFile[];
  /** Over the worktree, files whose outcome now is not known: none of them is counted. */
  readonly notCurrent: {
    readonly pending: number;
    readonly stale: number;
    readonly unknown: number;
  };
}
