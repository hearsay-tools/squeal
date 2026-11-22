import { realpathSync } from "node:fs";
import { daemonAdapters } from "../../src/cli/code-gate-stored.js";
import type { AtDaemons } from "../../src/cli/status-at-daemons.js";
import type { NowAsked } from "../../src/cli/status-at-now-ask.js";
import { withKeyer } from "../../src/core/commit/at-keys-walk.js";
import { squealVersion } from "../../src/core/daemon/version.js";
import { resolveCommonDir, worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { worktreeLiveness } from "../../src/core/presence/heartbeat.js";
import { isStoreOpenFailure, openStore } from "../../src/core/store/open.js";
import type { AbsolutePath, EpochMs, RelativePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";

/*
 * Review wave-23-third B1 (spec 023 D7.3 as amended 2026-11-22): the call
 * asks the working tree's daemon for its side and keys nothing itself.
 * This stand-in plays the daemon's answer for fixture tests: it keys the
 * worktree's test files with the gate's keyer, here in the test, writes
 * them as the daemon's rows (`test_file_keys`), and answers its `sync`
 * with the readers of each named path. A worktree the store shows a live
 * daemon in (`liveDaemon`) is answered from its rows as they are.
 */

/** `AtDaemons.now` as a daemon that keyed the worktree answers it. */
export const keyedNow: AtDaemons["now"] = async (root, paths) => keyNow(root, paths);

async function keyNow(root: AbsolutePath, paths: readonly RelativePath[]): Promise<NowAsked> {
  const tree = realpathSync(root) as AbsolutePath;
  const commonDir = resolveCommonDir(tree);
  if (commonDir === null) return { kind: "unserved", problem: `${tree} is no worktree` };
  const id = worktreeIdFor(tree);
  // As a daemon does: the store is opened for writing, made when there is none yet.
  const store = openStore(commonDir);
  if (isStoreOpenFailure(store)) return { kind: "unserved", problem: store.reason };
  try {
    const rows = store.testFileKeys.list(id);
    const live = worktreeLiveness(store.worktrees.get(id) ?? null, Date.now() as EpochMs);
    if (live.state === "alive" && rows.length > 0)
      return { kind: "read", revision: Math.max(0, ...rows.map((row) => row.revision)) };
    const options = { adapters: daemonAdapters, squealVersion: squealVersion(), env: process.env };
    return await withKeyer(tree, commonDir, store, options, async ({ keyer, listed }) => {
      const all = [...listed.values()];
      const keyed = await keyer.keyed(all);
      const revision = 1;
      store.testFileKeys.upsertMany(
        all.map((testFile) => ({
          worktreeId: id,
          testFile,
          key: keyed.get(testFile)?.key ?? null,
          revision,
          pending: null,
        })),
      );
      const readers = new Map<RelativePath, readonly TestFileRef[]>(
        paths.map((path) => [path, all.filter((ref) => keyed.get(ref)?.loads.includes(path))]),
      );
      return { kind: "read", revision, readers };
    });
  } finally {
    store.close();
  }
}
