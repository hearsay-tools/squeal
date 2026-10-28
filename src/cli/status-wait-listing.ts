import { connectionOf } from "../core/store/store.js";
import type { StatusHeader, Store, WorktreeId } from "../core/types/index.js";

/**
 * The snapshot's listing evidence, even when the poll read only held files.
 * The header already includes completed empty checkpoints, except during an
 * install wait. If it has no evidence, check for any worktree key on the same
 * connection and in the poll's read transaction, without loading every row.
 */
export function testFilesListed(store: Store, id: WorktreeId, header: StatusHeader): boolean {
  return (
    header.testFilesListed === true ||
    connectionOf(store).get("SELECT 1 FROM test_file_keys WHERE worktree_id = ? LIMIT 1", id) !==
      null
  );
}
