import { worktreeIdFor } from "../core/fs/git-layout.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { testFileKeyOf } from "../core/state/derive.js";
import { fileClassOf } from "../core/state/file-class.js";
import { CLI_READ_RETRY_MS, withStatusStore } from "../core/status/open.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { KnownState } from "../core/types/state.js";

/*
 * Review 0.1.616 B5 (spec 026 D4.4, repair 026-r3): each selected file's
 * final verdict after `squeal run <group> --base <ref> --wait`, apart from
 * how the request first found it. One read of the worktree's store, in one
 * read transaction, so every file's verdict comes from the same committed
 * state; each file is its project and path, never its path alone, so two
 * projects that list the same test path keep their own verdicts.
 */

/** How the request first found a selected file: its covered-files record, or the narrow run's `notRun`. */
export type InitialState = "queued" | "current" | "not-queued" | "not-run" | null;

/**
 * `passed`/`failed`: a current result at its key, with no failing check or
 * with one; `not-finished`: still queued or running when the wait ended;
 * `unknown`: no current result and none on its way, or the store could not
 * be read.
 */
export type FinalVerdict = "passed" | "failed" | "not-finished" | "unknown";

/**
 * Where a current result came from: `store`, it was current when the request
 * was taken (a stored or imported result); `run`, the request queued it and
 * it ran. `null` without a verdict or when the request's record is missing.
 */
export type VerdictFrom = "store" | "run" | null;

export interface FileVerdict {
  readonly verdict: FinalVerdict;
  readonly from: VerdictFrom;
}

/** Each of `files`' final verdict, in their order; every one `unknown` when the store cannot be read. */
export function finalVerdicts(
  root: AbsolutePath,
  files: readonly { readonly ref: TestFileRef; readonly initial: InitialState }[],
): FileVerdict[] {
  const worktreeId = worktreeIdFor(root);
  const refs = files.map((file) => file.ref);
  const read = withStatusStore(root, { busyRetryMs: CLI_READ_RETRY_MS }, ({ store }) => ({
    states: store.knownStates.list(worktreeId, refs),
    keys: store.testFileKeys.list(worktreeId, refs),
  }));
  if ("available" in read) return files.map(() => ({ verdict: "unknown", from: null }));
  const checks = new Map<string, KnownState[]>();
  for (const state of read.states) {
    const id = testFileKeyOf(state.check);
    checks.set(id, [...(checks.get(id) ?? []), state]);
  }
  const rows = new Map(read.keys.map((row) => [testFileId(row.testFile), row]));
  return files.map(({ ref, initial }) => {
    const id = testFileId(ref);
    const own = checks.get(id) ?? [];
    switch (fileClassOf(rows.get(id), own)) {
      case "current": {
        const failed = own.some((state) => state.outcome === "fail");
        return { verdict: failed ? "failed" : "passed", from: fromOf(initial) };
      }
      case "pending":
        return { verdict: "not-finished", from: null };
      default:
        return { verdict: "unknown", from: null };
    }
  });
}

/** `store` for a file current when the request was taken, `run` for one it queued. */
function fromOf(initial: InitialState): VerdictFrom {
  if (initial === "current") return "store";
  return initial === "queued" ? "run" : null;
}
