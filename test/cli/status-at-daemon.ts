import { realpathSync } from "node:fs";
import { join } from "node:path";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { Store } from "../../src/core/types/store.js";
import type { Fixture } from "../commit/at-keys-fixture.js";

/*
 * Rows 023-19 and its wave-13 repair: a live daemon in a `status --at`
 * fixture's worktree, as the store shows one: a fresh heartbeat and its
 * listing, each file at key `daemon-<path>`, revision 2.
 */

/** A live daemon in the fixture's worktree, with `rows` as its listing. */
export function liveDaemon(f: Fixture, store: Store, rows: readonly TestFileRef[]): string {
  const id = worktreeIdFor(f.root);
  store.worktrees.upsert({
    id,
    root: f.root,
    commonDir: realpathSync(join(f.root, ".git")) as AbsolutePath,
    isMain: true,
    registeredAt: 1,
    daemon: {
      socketPath: join(f.dir, "d.sock") as AbsolutePath,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
      heartbeatIntervalMs: 60_000,
      squealVersion: "0.0.0",
    },
  });
  store.testFileKeys.upsertMany(
    rows.map((testFile) => ({
      worktreeId: id,
      testFile,
      key: `daemon-${testFile.path}`,
      revision: 2,
      pending: null,
    })),
  );
  return id;
}
