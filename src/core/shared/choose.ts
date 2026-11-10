import type { AbsolutePath } from "../types/common.js";
import { type GitCall, gitCall, textOf } from "./git.js";

/*
 * Spec 018 D14, `transport.md` Q4: which export a worktree at `HEAD` takes.
 * M = merge-base(HEAD, <remote>/<default branch>); the nearest first-parent
 * ancestor of M with a results ref, refused unless it is on the default
 * branch's first-parent line. Local git only; each call takes the reader's
 * stop (`GitCall.signal`).
 */

const LOCAL_TIMEOUT_MS = 30_000;

const local = (signal: AbortSignal | undefined): GitCall =>
  signal === undefined ? { timeoutMs: LOCAL_TIMEOUT_MS } : { timeoutMs: LOCAL_TIMEOUT_MS, signal };

/** First-parent ancestors of M looked at for an export: past the retention of any CI. */
export const SEARCH_DEPTH = 1_000;

/** Where main lives: the remote, and its default branch's remote-tracking ref. */
export interface Upstream {
  readonly remote: string;
  /**
   * For example `refs/remotes/origin/main`, from `refs/remotes/<remote>/HEAD`
   * or the remote's advertised `HEAD` (`advertisedUpstream`).
   */
  readonly branch: string;
}

/** The clone's remotes, `origin` first, then the others in git's order. */
async function remotesOf(root: AbsolutePath, signal: AbortSignal | undefined): Promise<string[]> {
  const names = (textOf(await gitCall(root, ["remote"], local(signal))) ?? "")
    .split("\n")
    .filter(Boolean);
  return names.includes("origin") ? ["origin", ...names.filter((n) => n !== "origin")] : names;
}

/**
 * The remote whose `refs/remotes/<remote>/HEAD` names its default branch:
 * `origin` first, then each other remote in git's order; `null` when none
 * does (a clone sets it; `git remote set-head <remote> --auto` does too).
 */
export async function upstreamOf(
  root: AbsolutePath,
  signal?: AbortSignal,
): Promise<Upstream | null> {
  for (const remote of await remotesOf(root, signal)) {
    const args = ["symbolic-ref", "-q", `refs/remotes/${remote}/HEAD`];
    const branch = textOf(await gitCall(root, args, local(signal)));
    if (branch !== null && branch !== "") return { remote, branch };
  }
  return null;
}

/** `git ls-remote --symref`'s line for the remote's `HEAD`: the branch it names. */
const ADVERTISED_HEAD = /^ref: refs\/heads\/(\S+)\tHEAD$/m;

/**
 * Row 018-28 (`research/shared-proof.md` Q3): without a local
 * `refs/remotes/<remote>/HEAD` (a remote removed and added again has none,
 * and a fetch never makes it), the default branch the remote itself
 * advertises, `git ls-remote --symref <remote> HEAD`, for `origin`, else the
 * first remote. `null` when that remote names none, cannot be reached within
 * the caller's timer or stop, or the clone holds no remote-tracking ref of
 * that branch. Writes nothing: no `git remote set-head`.
 */
export async function advertisedUpstream(
  root: AbsolutePath,
  call: Pick<GitCall, "timeoutMs" | "env" | "signal">,
): Promise<Upstream | null> {
  const [remote] = await remotesOf(root, call.signal);
  if (remote === undefined) return null;
  const answer = await gitCall(root, ["ls-remote", "--symref", remote, "HEAD"], call);
  const name = ADVERTISED_HEAD.exec(textOf(answer) ?? "")?.[1];
  if (name === undefined) return null;
  const branch = `refs/remotes/${remote}/${name}`;
  const args = ["rev-parse", "--verify", "-q", `${branch}^{commit}`];
  const held = textOf(await gitCall(root, args, local(call.signal)));
  return held === null || held === "" ? null : { remote, branch };
}

/** M: `git merge-base <head> <branch>`; `null` when they share no history. */
export async function startPoint(
  root: AbsolutePath,
  head: string,
  upstream: Upstream,
  signal?: AbortSignal,
): Promise<string | null> {
  const args = ["merge-base", head, upstream.branch];
  const base = textOf(await gitCall(root, args, local(signal)));
  return base === null || base === "" ? null : base;
}

/** `from` and its first-parent ancestors, nearest first, at most `SEARCH_DEPTH`. */
export async function firstParents(
  root: AbsolutePath,
  from: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const args = ["rev-list", "--first-parent", `--max-count=${SEARCH_DEPTH}`, from];
  return (textOf(await gitCall(root, args, local(signal))) ?? "").split("\n").filter(Boolean);
}

/**
 * Whether `commit` is on `branch`'s first-parent line (`transport.md` Q5):
 * walking first parents from `branch` and stopping at what `commit`'s
 * parents reach, the walk ends at `commit` exactly when it is on the line.
 * This refuses a merge-group commit that never reached main and a pull
 * request branch's commit.
 */
export async function onFirstParentLine(
  root: AbsolutePath,
  branch: string,
  commit: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const args = ["rev-list", "--first-parent", branch, "--not", `${commit}^@`];
  const walked = textOf(await gitCall(root, args, local(signal)));
  if (walked === null) return false;
  return walked.split("\n").filter(Boolean).at(-1) === commit;
}
