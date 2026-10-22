import type { ResultRecord, Store } from "../../src/core/types/index.js";

/**
 * A `test_file_keys` row for each record's test file in the worktree that
 * produced it, at the record's key, as a daemon that lists the file holds.
 * `squeal failures` marks a failure without one `not a test file here now`
 * (row 011-79).
 */
export function keyTestFiles(store: Store, records: readonly ResultRecord[]): void {
  store.testFileKeys.upsertMany(
    records.map((r) => ({
      worktreeId: r.provenance.worktreeId,
      testFile: { project: r.check.project, path: r.check.testPath },
      key: r.key,
      revision: r.provenance.revision,
      pending: null,
    })),
  );
}
