import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { commitFolderName } from "../core/checkout/commit-identity.js";
import { environmentFingerprint } from "../core/checkout/commit-places.js";
import {
  cacheCheckoutsDir,
  cacheCheckoutsRoot,
  gitCheckoutsDir,
} from "../core/checkout/location.js";
import { treePath } from "../core/checkout/marker.js";
import { withStores } from "../core/commit/at-keys-checkout.js";
import { selects } from "../core/commit/at-keys-narrow.js";
import { runGit } from "../core/fs/git.js";
import type { AbsolutePath, RelativePath } from "../core/types/common.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { AtArgs } from "./status-at.js";
import { idOf } from "./status-at-after.js";
import type { CallInput } from "./status-at-call.js";
import { askCommit, type CommitAsked, joinCommit } from "./status-at-commit-ask.js";
import type { AtDaemons, CommitDaemonInput } from "./status-at-daemons.js";
import { uncommitted } from "./status-at-dirty.js";
import type { NowSide } from "./status-at-now.js";
import { type SideQueue, worktreeTwice } from "./status-at-queue.js";

/*
 * Spec 023 D7.3 as amended 2026-11-21 (row 023-40c): the two sides of a
 * `status --at` call. With `--run`: the commit daemon's one ask with the
 * change and the named paths, and the working tree's files in its own
 * daemon, those the change and the call name at once, then those the
 * commit daemon selected (R1). With `--wait` alone: the commit daemon's
 * kept asks and the call's files it lists pending, found also once its
 * tree is gone while the store holds its rows.
 */

/**
 * `--run`: the commit side's ask and the working tree's side together. The
 * working tree runs at once the files the change and the call name with no
 * result now, then those the commit daemon selected, once it queued them
 * (R1).
 */
export async function queueBoth(
  input: CallInput,
  side: {
    readonly daemons: AtDaemons;
    readonly commit: CommitDaemonInput;
    readonly now: NowSide;
    readonly bound: number;
    readonly askBy: number;
    readonly run: NonNullable<AtArgs["run"]>;
  },
): Promise<[CommitAsked, SideQueue]> {
  const { root, commit, paths } = input.place;
  const { daemons, bound, askBy, now } = side;
  const changed = await changedPaths(root, commit);
  const owner = randomUUID();
  const withoutNow = now.refs.filter((ref) => now.state(ref).state === "no result");
  const named = (ref: TestFileRef) => paths !== null && selects(paths, ref.path);
  const first = side.run.allMissing
    ? withoutNow
    : withoutNow.filter((ref) => changed.includes(ref.path) || named(ref));
  let selected: (files: readonly TestFileRef[]) => void = () => {};
  const later = new Promise<readonly TestFileRef[]>((resolve) => {
    selected = resolve;
  });
  const atPaths = new Set<string>();
  const queue = {
    daemons,
    deadline: bound,
    askBy: () => askBy,
    call: { owner, lead: paths !== null },
    ask: true,
    files: first,
  };
  return Promise.all([
    askCommit({
      daemons,
      commit: side.commit,
      owner,
      changed,
      named: paths ?? [],
      allMissing: side.run.allMissing,
      askBy,
      deadline: bound,
      queued: (files) => {
        for (const ref of files) atPaths.add(ref.path);
        selected(withoutNow.filter((ref) => atPaths.has(ref.path)));
      },
    }).finally(() => selected([])),
    worktreeTwice(queue, root, later),
  ]);
}

/** D4.5's input: the paths `<commit>..HEAD` changes and the working tree's changes since HEAD. */
async function changedPaths(root: AbsolutePath, commit: string): Promise<RelativePath[]> {
  const out = await runGit(root, ["diff", "--name-only", "--no-renames", "-z", commit, "HEAD"]);
  const committed = out.split("\0").filter((path) => path !== "") as RelativePath[];
  return [...new Set([...committed, ...((await uncommitted(root)) ?? [])])];
}

/**
 * `--wait` alone: the commit worktree that serves this commit and
 * environment, or the one that did, gone now, whose daemon's rows the
 * store still holds; `null` when neither.
 */
async function joinedTree(
  daemons: AtDaemons,
  input: CommitDaemonInput,
  commonDir: AbsolutePath,
): Promise<AbsolutePath | null> {
  return daemons.find(input) ?? (await formerTree(input, commonDir));
}

/** `--wait` alone, the commit side: the daemon's asks and the call's files it lists pending. */
export async function joinedCommit(
  daemons: AtDaemons,
  input: CommitDaemonInput,
  commonDir: AbsolutePath,
  paths: readonly RelativePath[] | null,
  bound: number,
): Promise<CommitAsked> {
  const tree = await joinedTree(daemons, input, commonDir);
  if (tree === null) return joinCommit(daemons, null, bound);
  const listed = await withStores(commonDir, async (main) =>
    (main?.testFileKeys.list(idOf(tree)) ?? [])
      .filter((row) => row.pending !== null && row.pending !== undefined)
      .map((row) => row.testFile)
      .filter((ref) => paths === null || selects(paths, ref.path)),
  );
  return joinCommit(daemons, tree, bound, listed);
}

/** A commit worktree of this commit and environment whose tree is gone, if the store still holds its daemon's rows. */
async function formerTree(
  input: CommitDaemonInput,
  commonDir: AbsolutePath,
): Promise<AbsolutePath | null> {
  const name = commitFolderName(input.commit, environmentFingerprint(input.environment));
  const cacheRoot = input.cacheRoot ?? cacheCheckoutsRoot();
  const dirs = [cacheCheckoutsDir(cacheRoot, commonDir), gitCheckoutsDir(commonDir)];
  const trees = dirs.map((dir) => treePath(join(dir, name)));
  return withStores(commonDir, async (main) => {
    if (main === null) return null;
    return trees.find((tree) => main.testFileKeys.list(idOf(tree)).length > 0) ?? null;
  });
}
