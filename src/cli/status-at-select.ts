import type { WhileOpen } from "../core/commit/at-keys-checkout.js";
import { squealVersion } from "../core/daemon/version.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { AbsolutePath, RelativePath, WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import { daemonAdapters } from "./code-gate-stored.js";
import type { AtOptions } from "./status-at.js";
import { type CommitSide, commitSide } from "./status-at-commit.js";
import { closureOf } from "./status-at-commit-run.js";
import { type Reached, reachedBy, uncommitted } from "./status-at-dirty.js";
import type { SideState } from "./status-at-report.js";
import { type Selection, selector } from "./status-at-run-select.js";

/*
 * Spec 023 D4.5 and D7.3 (row 023-40): the commit side of `--run` on the
 * commit daemon. The keys come from the gate's keyer in a temporary
 * checkout at the commit, as without `--run` (D2), so the keys this call
 * compares at are D2's. While its adapters are open, the selection is made
 * as before (`selector`, D4.5 unchanged, `--all-missing` unchanged); then
 * the checkout is removed and nothing runs in it. The files the selection
 * chose run in the commit daemon (`status-at-queue.ts`).
 */

export interface SelectInput {
  readonly root: AbsolutePath;
  readonly worktreeId: WorktreeId;
  readonly commit: string;
  /** The paths relative to the root; `null` for every test file. */
  readonly paths: readonly RelativePath[] | null;
  readonly allMissing: boolean;
  readonly env: NodeJS.ProcessEnv;
  readonly note: (text: string) => void;
  readonly options: Pick<AtOptions, "cacheRoot" | "install">;
}

export interface Selected {
  readonly at: CommitSide;
  /** What the change selects; `null` when the checkout gave no keys. */
  readonly selection: Selection | null;
  /** Each file's commit side as keyed, marked when the change did not select it (R8, T2). */
  readonly state: (ref: TestFileRef) => SideState;
}

/** The commit side's keys, and the selection made while the checkout's adapters were open. */
export async function commitSelect(input: SelectInput): Promise<Selected> {
  const { root, commit } = input;
  let selection: Selection | null = null;
  const choose = selector(
    { root, commit, allMissing: input.allMissing, named: new Set(input.paths ?? []) },
    (chosen) => {
      selection = chosen;
    },
  );
  // Row 023-35 (T2): each node:test project's files with an incomplete static closure.
  const lists = new Map<string, ReadonlySet<RelativePath>>();
  const adapters: typeof daemonAdapters = (tree, policy, tempDir) =>
    daemonAdapters(tree, policy, tempDir, (project, files) =>
      lists.set(project, new Set(files.map(([path]) => path))),
    );
  // Review wave-20 B5: the test files the working tree's uncommitted paths reach.
  let reached: Reached = "all";
  const dirty = await uncommitted(root);
  const whileOpen: WhileOpen = async (open, files) => {
    await choose(open, files);
    reached = await reachedBy(dirty, open);
  };
  const at = await commitSide({
    adapters,
    squealVersion: squealVersion(),
    env: input.env,
    ...input.options,
    root,
    commit,
    paths: input.paths,
    worktreeId: input.worktreeId,
    note: input.note,
    whileOpen,
  });
  const chosen = selection as Selection | null;
  const state = (ref: TestFileRef): SideState => {
    const keyed = at.state(ref);
    const id = testFileId(ref);
    const own = chosen?.states.get(id);
    if (own !== undefined) return own;
    const unselected = keyed.state === "no result" && chosen?.unselected?.has(id) === true;
    return closureOf(lists, reached, ref, unselected ? { ...keyed, notSelected: true } : keyed);
  };
  return { at, selection: chosen, state };
}
