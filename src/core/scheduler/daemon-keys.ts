import { readHead } from "../daemon-loop/head.js";
import { readObjectFormat } from "../hash/git-index.js";
import { createFsHasher, type Hasher } from "../hash/hasher.js";
import { hostNow } from "./clock.js";
import { type KeyingOptions, WorktreeKeys } from "./keying.js";

/**
 * The daemon's `WorktreeKeys` of a worktree over `store`, bootstrapped as at
 * a daemon's start, with the hasher behind them: what `ci export` (018 D9)
 * and the gate's stores lookup (spec 020 D11.7) key a checkout's test files
 * with, as a daemon there would.
 */
export async function openDaemonKeys(
  options: Pick<KeyingOptions, "root" | "worktreeId" | "store" | "policy" | "squealVersion"> & {
    /** Allow-listed variables are read from here, as the daemon reads its own. */
    readonly env: NodeJS.ProcessEnv;
  },
): Promise<{ readonly keys: WorktreeKeys; readonly hasher: Hasher }> {
  const { root, worktreeId, store, policy, squealVersion, env } = options;
  const objectFormat = await readObjectFormat(root);
  const hasher = createFsHasher(root, objectFormat);
  const keys = new WorktreeKeys({
    root,
    worktreeId,
    store,
    hasher,
    objectFormat,
    policy,
    squealVersion,
    env,
    onExtraFiles: () => {},
    // No scheduler on this path (`ci export`, the gate's lookup): environment records stamp the host's time.
    now: hostNow,
  });
  await keys.bootstrap(() => readHead(root));
  return { keys, hasher };
}
