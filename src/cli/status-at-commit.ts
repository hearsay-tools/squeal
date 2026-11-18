import { type KeysAt, type KeysAtOptions, keysAtCommit } from "../core/commit/at-keys.js";
import { narrowedOrAll, selects } from "../core/commit/at-keys-narrow.js";
import { type Changed, changedText } from "../core/commit/at-keys-walk.js";
import { committedBlobs } from "../core/commit/tree.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { RelativePath, WorktreeId } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
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
  readonly inputCheckMs: number | null;
  /** Row 023-07: the first path the install changed in the checkout; `null` when none. */
  readonly changed: Changed | null;
  /** Why the checkout gave no keys; `null` when it did, or none was needed. */
  readonly failure: string | null;
  /**
   * Row 023-19 (P4): the paths that select no test file the commit lists,
   * each with the files whose closure at the commit holds it.
   */
  readonly sources: ReadonlyMap<RelativePath, readonly TestFileRef[]>;
}

export type CommitSideOptions = Omit<KeysAtOptions, "files"> & {
  /** Relative to the root; `null` for every test file. */
  readonly paths: readonly RelativePath[] | null;
  readonly worktreeId: WorktreeId;
};

/**
 * Every test file the commit lists that `paths` select, under each
 * project that lists it there: a named file and its folder give the same
 * files (review wave-6 re-review B5; the human, 2026-11-17, dropped the
 * named-file shortcut). CI's export still applies inside `keysAtCommit`.
 */
export async function commitSide(options: CommitSideOptions): Promise<CommitSide> {
  const { paths, worktreeId, root, commit } = options;
  const tree = await committedBlobs(root, commit);
  const asked = paths === null || [...tree.keys()].some((path) => selects(paths, path));
  // P4: a path no listed test file matches is a source path; then every file is keyed.
  let named: readonly RelativePath[] = [];
  const hear = (found: readonly RelativePath[]) => {
    named = found;
  };
  // No committed path is selected: every named file is absent there, with no checkout.
  const at: KeysAt = asked
    ? await keysAtCommit({
        ...options,
        ...(paths === null
          ? {}
          : { adapters: narrowedOrAll(options.adapters, paths, (path) => tree.has(path), hear) }),
      })
    : { commit, files: new Map(), failure: null, checkoutMs: null, store: true };
  const sources = new Map<RelativePath, TestFileRef[]>(named.map((path) => [path, []]));
  for (const [id, found] of at.files) {
    if (!("key" in found)) continue;
    for (const path of named)
      if (found.loads?.includes(path) === true) sources.get(path)?.push(refOf(id));
  }
  const bySource = new Set([...sources.values()].flat().map(testFileId));
  const failure = at.failure === null ? null : `${at.failure.reason}: ${at.failure.detail}`;
  const refs = [...at.files.keys()]
    .map(refOf)
    // CI's export may settle files beyond the paths; P4: a source path selects by closure.
    .filter((ref) => paths === null || selects(paths, ref.path) || bySource.has(testFileId(ref)));
  const changed = at.changed ?? null;
  const state = (ref: TestFileRef): SideState => {
    const found = at.files.get(testFileId(ref));
    // Row 023-07 ("Whole-checkout check"): a key from a changed checkout is not the commit's.
    if (found !== undefined && "key" in found && changed !== null)
      return { state: "not comparable", reason: changedText(changed) };
    if (found !== undefined) return commitState(found, worktreeId);
    // The commit's tree proves absence; B4: a failed checkout's empty listing proves nothing.
    if (!tree.has(ref.path)) return { state: "absent" };
    if (failure !== null) return { state: "not determined", reason: failure };
    return { state: "not determined", reason: `no runner lists it at ${commit.slice(0, 9)}` };
  };
  return {
    refs,
    state,
    checkoutMs: at.checkoutMs,
    inputCheckMs: at.inputCheckMs ?? null,
    changed,
    failure,
    sources,
  };
}

/** A file's reference from its `testFileId`. */
function refOf(id: string): TestFileRef {
  const [project = "", path = ""] = id.split("\0");
  return { project, path };
}
