import { testFileId } from "../keys/index.js";
import type {
  CheckId,
  CheckKey,
  PendingPhase,
  ResultRecord,
  RevisionNumber,
  TestFileRef,
  Validity,
} from "../types/index.js";

/** What the scheduler knows about one test file of its worktree. */
export interface FileState {
  readonly ref: TestFileRef;
  readonly id: string;
  /** Key at the current revision; `null` while unkeyed (no environment, untracked path). */
  key: CheckKey | null;
  /**
   * The earliest revision whose change moved the key with no result since
   * (`SettleOptions.keyedAt`), so `status --wait` holds for the files its
   * window's edits re-keyed (task 001-186) until they have one; a later move
   * keeps it, and a result or `unknown` at `key` clears it (task 001-194).
   * `null` when only the baseline, a backlog or a run moved it since.
   */
  keyedAt: RevisionNumber | null;
  /**
   * The latest such revision, so a window that holds only a later move,
   * an environment change after an earlier edit, names the file too.
   */
  lastKeyedAt: RevisionNumber | null;
  /** Key of the results last applied for this worktree; `null` when there are none. */
  resultKey: CheckKey | null;
  /** Checks of those results: what the state sink knows for this file. */
  checks: CheckId[];
  /** Whether any of those results is a `fail`. D5 runs these first. */
  failing: boolean;
  /**
   * Last known run time: the sum of `durationMs` over the results last
   * applied, from this worktree's run or a lookup hit; the file-level check
   * carries the time outside the test cases (`recordsForFile`). `null` when
   * unknown.
   * D5 step 4 runs the shortest first within a class.
   */
  durationMs: number | null;
  phase: PendingPhase | null;
  /** Key of the tier in flight that holds this file. */
  runningKey: CheckKey | null;
  /**
   * Key a run crashed or timed out at (D12). The file is not queued again at
   * this key, so a crashing file cannot loop; any change to its key, or an
   * explicit `run --all`, queues it again.
   */
  unknownKey: CheckKey | null;
  /**
   * Consecutive tiers whose results the stability check discarded at a key
   * that did not move (review S5).
   */
  discards: number;
  /**
   * Key whose new failure was re-run (task 001-171): a failure is re-run
   * once per key, never in a loop.
   */
  rerunKey: CheckKey | null;
  /**
   * The re-run queued at `rerunKey` has not landed yet (review wave 13i,
   * S1): kept in `meta` with it (`writeReruns`), so a restarted daemon
   * queues it again, and dropped when the file's key moves first.
   */
  rerunPending: boolean;
  /**
   * Why the file is `unknown` because a runner call it needs failed (spec 001
   * D5: "A runner call that fails is a state, never a skip"). It is not run
   * until the runner recovers; `null` otherwise.
   */
  blocked: string | null;
  /**
   * The most files a tier that takes this file may hold, after a timed-out
   * tier left it incomplete (task 001-179): half the files it left so, down
   * to one; `null` when no timeout split it. Cleared when its results land.
   */
  tierCap: number | null;
}

export function newFileState(ref: TestFileRef): FileState {
  return {
    ref,
    id: testFileId(ref),
    key: null,
    keyedAt: null,
    lastKeyedAt: null,
    resultKey: null,
    checks: [],
    failing: false,
    durationMs: null,
    phase: null,
    runningKey: null,
    unknownKey: null,
    discards: 0,
    rerunKey: null,
    rerunPending: false,
    blocked: null,
    tierCap: null,
  };
}
/**
 * Task 001-194: `revision`'s change moved the file's key. The earliest
 * revision with no result since stays, so a later move, an edit's or a
 * growth's, never takes the file out of a wait that holds the earlier one.
 */
export function noteKeyedAt(file: FileState, revision: RevisionNumber): void {
  file.keyedAt = file.keyedAt === null ? revision : Math.min(file.keyedAt, revision);
  file.lastKeyedAt = file.lastKeyedAt === null ? revision : Math.max(file.lastKeyedAt, revision);
}

/** The file has a result, or is `unknown`, at its key: it holds no wait (task 001-194). */
export function clearKeyedAt(file: FileState): void {
  file.keyedAt = null;
  file.lastKeyedAt = null;
}

/**
 * Validity of a test file's checks at the current revision. Every check of a
 * file shares it, because they share the file's key.
 *
 * Spec 001 D5: "A stored result is **current** for a check in a worktree at a
 * revision when its key equals the key computed for that check at that
 * revision. Otherwise the check is **stale** (an older result exists under
 * another key) or **unknown** (no result at all). **Pending** means a run that
 * will produce a result for the current key is queued or running." Pending
 * wins over the other classes (`Validity`). D12: a crash or timeout makes the
 * file's checks `unknown` at this revision. D5: "An unkeyed or `unknown` file
 * is always work to do", and a runner failure makes a file `unknown`.
 */
export function classify(file: FileState): Validity {
  if (file.phase !== null) return "pending";
  if (file.key === null || file.blocked !== null) return "unknown";
  if (file.unknownKey === file.key) return "unknown";
  if (file.resultKey === file.key) return "current";
  return file.resultKey === null ? "unknown" : "stale";
}

/** Map key of a check. NUL cannot occur in a project name, path or test name. */
export function checkId(check: CheckId): string {
  const name = check.kind === "test" ? check.fullName : "";
  return `${check.kind}\0${check.project}\0${check.testPath}\0${name}`;
}

/** A file's run time from its results; `null` without results. */
export function durationOf(results: readonly ResultRecord[]): number | null {
  if (results.length === 0) return null;
  return results.reduce((sum, result) => sum + result.durationMs, 0);
}
