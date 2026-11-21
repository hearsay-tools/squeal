import { withStores } from "../core/commit/at-keys-checkout.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import { idOf } from "./status-at-after.js";
import type { AtDaemons, CommitDaemonInput } from "./status-at-daemons.js";
import type { SideState } from "./status-at-report.js";

/*
 * Spec 023 D7.3 (row 023-40; research `run-wait-model.md` Q7, replacing
 * T5's refusal): `status --at <commit> --wait` without `--run` joins the
 * work already queued at the commit and starts none: the files of the
 * call with no result there that the commit daemon has queued or runs.
 * No commit worktree, or none for this environment: nothing to join.
 */

export interface Joined {
  /** The commit worktree whose daemon runs them; `null` when there is none. */
  readonly tree: AbsolutePath | null;
  readonly files: readonly TestFileRef[];
}

export async function joinCommit(
  daemons: AtDaemons,
  input: CommitDaemonInput,
  refs: readonly TestFileRef[],
  keyed: (ref: TestFileRef) => SideState,
  commonDir: AbsolutePath,
): Promise<Joined> {
  const tree = daemons.find(input);
  if (tree === null) return { tree, files: [] };
  const id = idOf(tree);
  const pending = await withStores(commonDir, async (main) => {
    const rows = main?.testFileKeys.list(id) ?? [];
    return new Set(rows.filter((row) => row.pending !== null).map((row) => testFileId(row.testFile)));
  });
  const files = refs.filter(
    (ref) => keyed(ref).state === "no result" && pending.has(testFileId(ref)),
  );
  return { tree, files };
}
