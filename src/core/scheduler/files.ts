import { testFileId } from "../keys/index.js";
import type { CheckId, CheckKey, PendingPhase, TestFileRef, Validity } from "../types/index.js";

/** What the scheduler knows about one test file of its worktree. */
export interface FileState {
  readonly ref: TestFileRef;
  readonly id: string;
  /** Key at the current revision; `null` while unkeyed (no environment, untracked path). */
  key: CheckKey | null;
  /** Key of the results last applied for this worktree; `null` when there are none. */
  resultKey: CheckKey | null;
  /** Checks of those results: what the state sink knows for this file. */
  checks: CheckId[];
  /** Whether any of those results is a `fail`. D5 runs these first. */
  failing: boolean;
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
}

export function newFileState(ref: TestFileRef): FileState {
  return {
    ref,
    id: testFileId(ref),
    key: null,
    resultKey: null,
    checks: [],
    failing: false,
    phase: null,
    runningKey: null,
    unknownKey: null,
    discards: 0,
  };
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
 * file's checks `unknown` at this revision.
 */
export function classify(file: FileState): Validity {
  if (file.phase !== null) return "pending";
  if (file.key !== null && file.unknownKey === file.key) return "unknown";
  if (file.key !== null && file.resultKey === file.key) return "current";
  return file.resultKey === null ? "unknown" : "stale";
}

/** Map key of a check. NUL cannot occur in a project name, path or test name. */
export function checkId(check: CheckId): string {
  const name = check.kind === "test" ? check.fullName : "";
  return `${check.kind}\0${check.project}\0${check.testPath}\0${name}`;
}
