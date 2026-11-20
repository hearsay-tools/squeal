import { existsSync } from "node:fs";
import { join } from "node:path";
import type { KeyedFile, WhileOpen } from "../core/commit/at-keys-checkout.js";
import { committedBlobs } from "../core/commit/tree.js";
import { runGit } from "../core/fs/git.js";
import { createDeclaredInputs } from "../core/keys/closure.js";
import { testFileId } from "../core/keys/reverse-index.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { SideState } from "./status-at-report.js";

/*
 * Spec 023 D4.5 and D4.9 (row 023-07, review wave-7 B2, B4, B6): which
 * files with no result `--run` runs. Selection is 020 D3.1's, asked of the
 * keyer's adapters in the checkout while they are open: a test file the
 * diff `<commit>..HEAD` changes, one the runner's `affected` names (its
 * imports, and every file of a project whose config or setup changed), and
 * one a changed declared input names. A file whose closure needs a path git
 * does not hold at the commit is not run (D4.9). The gate runs a path under
 * every project that lists it, so a path runs only when each of its
 * projects may run.
 */

/** What the selection decided for each file with no result. */
export interface Selection {
  /** The files to run, by full identity. */
  readonly run: readonly KeyedFile[];
  /** The states of files with no result that are not run for a reason of their own. */
  readonly states: ReadonlyMap<string, SideState>;
  /**
   * Row 023-29 (R8): the files with no result the change did not select, by
   * `testFileId`; empty with `--all-missing`. Absent: no selection was made.
   */
  readonly unselected?: ReadonlySet<string>;
  /**
   * Row 023-29 (R1): what the change selects, for the working tree's side:
   * the ids the diff selects at the commit (`null` with `--all-missing`:
   * every file) and the paths the diff changes (a test file new since the
   * commit is one of them).
   */
  readonly selects?: {
    readonly ids: ReadonlySet<string> | null;
    readonly paths: ReadonlySet<RelativePath>;
  };
}

/** A file with a key and no stored result at it. */
export const noResult = (f: KeyedFile) => "key" in f.at && f.at.stored.length === 0;

/**
 * D4.5: the files with no result the diff selects (all of them with
 * `allMissing`), through the open adapters; D4.9: those that need a path
 * git does not hold are refused, with the other projects of their path.
 */
export function selector(
  input: {
    readonly root: AbsolutePath;
    readonly commit: string;
    readonly allMissing: boolean;
    /**
     * Row 023-29 (row 023-32's finding): the test files the call names
     * itself, relative to the root; each runs, selected by the change or not.
     */
    readonly named?: ReadonlySet<RelativePath>;
  },
  into: (selection: Selection) => void,
): WhileOpen {
  return async (open, keyed) => {
    const missing = keyed.filter(noResult);
    const named = input.named ?? new Set<RelativePath>();
    const chosen = input.allMissing ? null : await diffSelected(input, open);
    const wanted = missing.filter(
      (f) => chosen === null || chosen.has(testFileId(f.ref)) || named.has(f.ref.path),
    );
    const unselected = new Set(
      missing.filter((f) => !wanted.includes(f)).map((f) => testFileId(f.ref)),
    );
    // The working tree's side runs what the change selects and what the call names (R1).
    const changed = input.allMissing ? [] : await changedSince(input.root, input.commit);
    const paths = new Set([...changed, ...named]);
    const selects = { ids: chosen, paths };
    into({ ...(await refuse({ ...input, tree: open.tree }, keyed, wanted)), unselected, selects });
  };
}

/**
 * D4.5 (020 D3.1): the test files, by `testFileId`, the diff
 * `<commit>..HEAD` selects through the open adapters: a changed test file,
 * one a changed declared input names, one the runner's `affected` names.
 */
export async function diffSelected(
  input: { readonly root: AbsolutePath; readonly commit: string },
  { adapters, policy }: Parameters<WhileOpen>[0],
): Promise<ReadonlySet<string>> {
  const changed = await changedSince(input.root, input.commit);
  const ids = new Set<string>();
  if (changed.length === 0) return ids;
  const named = new Set(changed);
  const declared = createDeclaredInputs(policy.inputs, changed);
  for (const adapter of adapters) {
    for (const ref of await adapter.testFiles()) {
      if (named.has(ref.path) || declared.for(ref.path).length > 0) ids.add(testFileId(ref));
    }
    const affected = await adapter.affected(changed);
    for (const ref of [...affected.direct, ...affected.transitive]) ids.add(testFileId(ref));
  }
  return ids;
}

/** D4.9 over `wanted`, and B2: a path runs only when none of its projects is refused. */
export async function refuse(
  input: { readonly root: AbsolutePath; readonly commit: string; readonly tree: AbsolutePath },
  keyed: readonly KeyedFile[],
  wanted: readonly KeyedFile[],
): Promise<Selection> {
  const needs = await needsOf(input);
  const states = new Map<string, SideState>();
  const refused = new Map<RelativePath, { ref: TestFileRef; why: string }>();
  for (const file of keyed) {
    const path = needs(file);
    if (path === null) continue;
    const why = `needs ${path}`;
    if (!refused.has(file.ref.path)) refused.set(file.ref.path, { ref: file.ref, why });
    states.set(testFileId(file.ref), { state: "not comparable", reason: why });
  }
  const run: KeyedFile[] = [];
  for (const file of wanted) {
    const id = testFileId(file.ref);
    const sibling = refused.get(file.ref.path);
    if (states.has(id)) continue;
    if (sibling === undefined) run.push(file);
    else {
      const project =
        sibling.ref.project === "" ? "the default project" : `project ${sibling.ref.project}`;
      const reason = `it runs with ${project}'s ${file.ref.path}: ${sibling.why}`;
      states.set(id, { state: "not comparable", reason });
    }
  }
  // A refused file the selection did not want keeps `no result`.
  const asked = new Set(wanted.map((f) => testFileId(f.ref)));
  for (const id of [...states.keys()]) if (!asked.has(id)) states.delete(id);
  return { run, states };
}

/**
 * D4.9 (review wave-7 B6): the first path a file's closure reads that git
 * does not hold at the commit and that is there to read: in the checkout
 * (the install made it), or in the user's worktree untracked at `HEAD` (a
 * generated input the checkout lacks). A path absent from both, a
 * resolution candidate or a snapshot not written yet, reads absent at the
 * commit as here: no reason. `null` when none. Row 023-08: `copied`
 * names the paths a proof side wrote into the checkout on purpose.
 */
export async function needsOf(input: {
  readonly root: AbsolutePath;
  readonly commit: string;
  readonly tree: AbsolutePath;
  readonly copied?: ReadonlySet<RelativePath>;
}): Promise<(file: KeyedFile) => string | null> {
  const { root, tree } = input;
  const atCommit = await committedBlobs(root, input.commit);
  const atHead = await committedBlobs(root, "HEAD");
  return (file) => {
    if (!("key" in file.at)) return null;
    for (const path of file.at.loads ?? []) {
      if (atCommit.has(path) || input.copied?.has(path) === true) continue;
      const generated = !atHead.has(path) && existsSync(join(root, path));
      if (existsSync(join(tree, path)) || generated) return path;
    }
    return null;
  };
}

/** The paths the diff `<commit>..HEAD` changes, renames as both sides. */
async function changedSince(root: AbsolutePath, commit: string): Promise<RelativePath[]> {
  const out = await runGit(root, ["diff", "--name-only", "--no-renames", "-z", commit, "HEAD"]);
  return out.split("\0").filter((path) => path !== "");
}
