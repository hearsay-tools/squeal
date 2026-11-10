import { existsSync } from "node:fs";
import { join } from "node:path";
import { blobsOfTree, LS_TREE_TIMEOUT_MS, lsTreeArgs } from "../commit/tree.js";
import { resolveCommonDir } from "../fs/git-layout.js";
import { readGitHead } from "../status/git-head.js";
import type { AbsolutePath, RelativePath } from "../types/common.js";
import type { FileHash } from "../types/keys.js";
import { gitCall, textOf } from "./git.js";

/*
 * Spec 018 D14 (row 018-23, review `wave-5-0.1.422-r2.md` N1): the reader's
 * two local reads besides choosing an export, `HEAD` and the blobs of the
 * export's commit. Each takes the reader's stop and a kill timer, as every
 * other git call of the reader does (`gitCall`), so a stop leaves no git
 * running. The helpers the daemon shares (`gitHead`, `committedBlobs`) keep
 * their own behaviour.
 */

/** The kill timer of `HEAD` read through git, which only a reftable needs. */
export const HEAD_TIMEOUT_MS = 5_000;

export interface LocalCall {
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

/**
 * `HEAD` of the worktree at `root`, or `null` when it is unborn or cannot be
 * read. From the git dir without spawning (`readGitHead`); through
 * `git rev-parse` only when the refs are in a reftable, which the git dir
 * does not show. A files repository whose `HEAD` the git dir does not
 * resolve has an unborn `HEAD`: no git starts.
 */
export async function headOf(root: AbsolutePath, call: LocalCall): Promise<string | null> {
  const head = readGitHead(root);
  if (head !== null) return head;
  const common = resolveCommonDir(root);
  if (common === null || !existsSync(join(common, "reftable"))) return null;
  const answer = await gitCall(root, ["rev-parse", "--verify", "-q", "HEAD"], call);
  const text = textOf(answer)?.trim() ?? "";
  return text === "" ? null : text;
}

/** The blob of each file `commit` holds (`committedBlobs`); `null` when git fails or is stopped. */
export async function blobsAt(
  root: AbsolutePath,
  commit: string,
  signal: AbortSignal,
): Promise<Map<RelativePath, FileHash> | null> {
  const answer = await gitCall(root, lsTreeArgs(commit), {
    timeoutMs: LS_TREE_TIMEOUT_MS,
    signal,
  });
  return answer.code === 0 ? blobsOfTree(answer.stdout.toString("utf8")) : null;
}
