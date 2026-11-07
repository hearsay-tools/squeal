import type { EpochMs, RelativePath } from "../../types/common.js";
import type { FileChange } from "../../types/revision.js";
import type { Store } from "../../types/store.js";
import { json, num } from "../codec.js";
import { connectionOf } from "../store.js";

/*
 * Spec 015 D11 "Edits" (row 015-109): the store's `watch` revisions in which
 * `HEAD` did not move, over every worktree of the repository, in the window
 * the store keeps. A revision's `HEAD` is compared with the one before it in
 * its worktree; a worktree's first revision has none to compare with and is
 * left out. Read only.
 */

/** One edit: when, and the paths it changed. */
export interface StoredEdit {
  readonly at: EpochMs;
  readonly paths: readonly RelativePath[];
}

export function readEdits(store: Store): StoredEdit[] {
  return connectionOf(store)
    .all(
      `SELECT created_at, changes FROM (
         SELECT created_at, changes, trigger, head,
           lag(head) OVER w AS head_before,
           lag(number) OVER w AS number_before
         FROM revisions
         WINDOW w AS (PARTITION BY worktree_id ORDER BY number)
       )
       WHERE trigger = 'watch' AND number_before IS NOT NULL AND head IS head_before
       ORDER BY created_at`,
    )
    .map((row) => ({
      at: num(row, "created_at"),
      paths: json<FileChange[]>(row, "changes").map((c) => c.path),
    }));
}
