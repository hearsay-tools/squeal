import { resolveCommonDir, worktreeIdFor } from "../../../src/core/fs/git-layout.js";
import { claimForUse } from "../../../src/core/runner-host/remote/machines-store.js";
import { isStoreOpenFailure, openStore } from "../../../src/core/store/open.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";

/*
 * Row 026-43 (review 0.1.667): a daemon of a worktree, as its own process,
 * for `prune-claim.test.ts`. argv: action, worktree root, state directory.
 * `heartbeat` writes the worktree's store row with a fresh daemon record;
 * `claim` does that, then claims the worktree's `command` machine record
 * as a daemon does before it reuses it, and prints the status it found
 * or wrote (`null`: none).
 */

const [action, root, state] = process.argv.slice(2) as [string, AbsolutePath, string];
const commonDir = resolveCommonDir(root);
if (commonDir === null) throw new Error(`${root} is not a repository`);
const store = openStore(commonDir);
if (isStoreOpenFailure(store)) throw new Error(`store: ${store.reason}`);
const now = Date.now();
store.worktrees.upsert({
  id: worktreeIdFor(root),
  root,
  commonDir,
  isMain: true,
  registeredAt: now,
  daemon: {
    socketPath: "/tmp/sq-prune-claim.sock" as AbsolutePath,
    startedAt: now - 30 * 3_600_000,
    heartbeatAt: now,
    heartbeatIntervalMs: 5_000,
    squealVersion: "0.0.0-test",
    token: "tok",
  },
});
store.close();
if (action === "claim") {
  const key = { provider: "command", worktreeId: worktreeIdFor(root) };
  const found = await claimForUse(key, Date.now(), { XDG_STATE_HOME: state, HOME: state });
  process.stdout.write(JSON.stringify(found?.status ?? null));
}
