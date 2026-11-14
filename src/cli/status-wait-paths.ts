import type { AbsolutePath } from "../core/types/common.js";
import type { StatusSnapshot } from "../core/types/status.js";
import { anyFailed } from "./status-wait-focus.js";
import { resultCode, selectionResult } from "./verdict.js";
import type { NamedWait, NamedWaitOptions } from "./wait/named-types.js";
import { statusWait } from "./wait/wait.js";

export type { NamedWait, NamedWaitOptions } from "./wait/named-types.js";
export type { NamedWaitOutcome } from "./wait/status-table.js";

/**
 * Spec 005 D2: waits until every test file `paths` select has a result for
 * its current key at the current revision, or the deadline. Once its
 * selection is decided, it asks the daemon to promote the test files named
 * by their own paths (spec 011 C15), nothing more. The selection is decided
 * at a revision that holds every edit made before the wait and whose test
 * files the runner listed (the daemon's `sync` pass, lessons defect 30), so
 * a test file written just before the wait is found; a daemon that cannot
 * sync falls back to the settle time. A deadline before that revision is a timeout, never the old
 * results' verdict (review wave-1, B1); a read ready at the deadline gives
 * its verdict. It is read again
 * at every poll, since an edit can change a closure. A store that cannot be
 * read at the first read or the last ends the wait; one in between is skipped.
 * A stale heartbeat ends it only once `watchDaemon` finds no daemon: a cleared
 * record, or a socket dead for `downMs` (task 004-66, issue 12).
 *
 * Task 004-78 (research `atomic-flags-0215.md` 4): a selected slow file that
 * runs only on a pause (`pauseOnlyIds`) is left out of what the wait holds
 * for, decided at each ready read for the files not yet left out and kept
 * for the rest of the wait, so a wait over fast and slow files gives the
 * fast verdict at once and one over slow files alone returns `slow`.
 *
 * Row 011-146 (C15 as amended 2026-10-23): with `checks`, it sends `focus`
 * beside the promotion for the files named by their own paths the daemon
 * focuses, and returns `focused` once each has a focused run ended at its
 * current key or a result stored there. A file current before that gives
 * the named wait's verdict; an unknown or stale file that nothing queues
 * waits for its focused answer (review 0.1.286 B6). `focusOutcome` decides
 * it. A daemon that does not know the request leaves it a named wait.
 */
export function waitForNamed(
  cwd: AbsolutePath,
  paths: readonly string[],
  options: NamedWaitOptions,
): Promise<NamedWait> {
  // Row 011-331: the wait module's named wait polls and decides.
  return statusWait({ wait: "named", cwd, paths, options });
}

/**
 * Row 011-206 (011 C15): the selected files' result word and, without a
 * verdict, why, from `selectionResult`; the exit code, the JSON and the
 * verdict line read it. Row 011-63 (gh-59): a path that selects nothing
 * leaves no clean verdict, but a known failure among the files the others
 * select is still `fail`. Row 011-146 (C15): a focused answer is not the
 * file's verdict: `fail` when a selected check failed, else none.
 */
export function namedResult(wait: Extract<NamedWait, { result: StatusSnapshot }>) {
  return selectionResult({
    outcome: wait.outcome,
    verdict: wait.verdict,
    sync: wait.sync,
    ...(wait.snapshot === true ? { snapshot: true } : {}),
    ...(wait.lapsed === true ? { lapsed: true } : {}),
    ...(wait.lapseCovered === true ? { lapseCovered: true } : {}),
    focusFailed: wait.focus !== undefined && anyFailed(wait.focus.files),
    unmatched: wait.selection.unmatched.length,
    notRun: wait.selection.paths.filter((p) => p.kind === "not-run").length,
  });
}

/** Spec 005 D1 for the selected files: `namedResult` as 0, 1 or 3. */
export function namedCode(wait: Extract<NamedWait, { result: StatusSnapshot }>): 0 | 1 | 3 {
  return resultCode(namedResult(wait));
}
