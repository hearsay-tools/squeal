import { type KeysAt, type KeysAtOptions, keysAtCommit } from "../core/commit/at-keys.js";
import type { KeyingOptions } from "../core/commit/at-keys-walk.js";
import { committedBlobs } from "../core/commit/tree.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { RelativePath, WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { RunnerAdapter } from "../core/types/runner.js";
import { selects } from "./status-at-now.js";
import { commitState, type SideState } from "./status-at-report.js";

/*
 * Spec 023 D1 and D3 (row 023-06, review wave-6 B4 and B5): the commit
 * side. Paths are expanded against the commit's own listing: the adapters
 * in the checkout list only the files the paths select, so a test deleted
 * since the commit is still asked, under its project there. A file the
 * commit side has no entry for reads `absent` only when the commit's tree
 * lacks it; when the checkout failed, every other file reads not determined.
 */

export interface CommitSide {
  /** The test files the commit lists that the paths select. */
  readonly refs: readonly TestFileRef[];
  readonly state: (ref: TestFileRef) => SideState;
  readonly checkoutMs: number | null;
  /** Why the checkout gave no keys; `null` when it did, or none was needed. */
  readonly failure: string | null;
}

export type CommitSideOptions = KeysAtOptions & {
  /** Relative to the root; `null` for every test file. */
  readonly paths: readonly RelativePath[] | null;
  readonly worktreeId: WorktreeId;
};

/**
 * Each selected test file at `options.commit`: the named `files` when
 * given, else every file the commit lists that `paths` select.
 */
export async function commitSide(options: CommitSideOptions): Promise<CommitSide> {
  const { paths, worktreeId, root, commit } = options;
  const tree = await committedBlobs(root, commit);
  const asked = paths === null || [...tree.keys()].some((path) => selects(paths, path));
  // Named files go as they are (CI's export can settle them); a folder is listed in the
  // checkout, narrowed to what the paths select.
  const asIs = paths === null || options.files !== undefined;
  // No committed path is selected: every named file is absent there, with no checkout.
  const at: KeysAt = asked
    ? await keysAtCommit({
        ...options,
        ...(asIs ? {} : { adapters: narrowed(options.adapters, paths) }),
      })
    : { commit, files: new Map(), failure: null, checkoutMs: null, store: true };
  const failure = at.failure === null ? null : `${at.failure.reason}: ${at.failure.detail}`;
  const refs = [...at.files.keys()]
    .map((id) => {
      const [project = "", path = ""] = id.split("\0");
      return { project, path };
    })
    // CI's export may settle files beyond the paths.
    .filter((ref) => paths === null || selects(paths, ref.path));
  const state = (ref: TestFileRef): SideState => {
    const found = at.files.get(testFileId(ref));
    if (found !== undefined) return commitState(found, worktreeId);
    // The commit's tree proves absence; B4: a failed checkout's empty listing proves nothing.
    if (!tree.has(ref.path)) return { state: "absent" };
    if (failure !== null) return { state: "not determined", reason: failure };
    return { state: "not determined", reason: `no runner lists it at ${commit.slice(0, 9)}` };
  };
  return { refs, state, checkoutMs: at.checkoutMs, failure };
}

/** `adapters`, each listing only the test files `paths` select; keying is theirs unchanged. */
function narrowed(
  adapters: KeyingOptions["adapters"],
  paths: readonly RelativePath[],
): KeyingOptions["adapters"] {
  return async (root, policy, tempDir) =>
    (await adapters(root, policy, tempDir)).map((adapter) => listingOnly(adapter, paths));
}

function listingOnly(adapter: RunnerAdapter, paths: readonly RelativePath[]): RunnerAdapter {
  return new Proxy(adapter, {
    get(target, name) {
      if (name === "testFiles") {
        return async () => (await target.testFiles()).filter((ref) => selects(paths, ref.path));
      }
      const value: unknown = Reflect.get(target, name, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
