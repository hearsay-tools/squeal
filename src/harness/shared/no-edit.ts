import { registration, registrationHead, seesEveryChange } from "../../core/delivery/registered.js";
import { runGit } from "../../core/fs/git.js";
import { readTransaction } from "../../core/store/store.js";
import type { AbsolutePath } from "../../core/types/common.js";
import type { HookContext } from "./context.js";

/*
 * Task 004-67 (issue 19, decided by the human 2026-10-17) and row 011-312
 * (gh-153, the human 2026-11-10): the one owner of "this session changed
 * nothing", so it is not held at Stop for checks of files it never
 * touched. The daemon's record of revisions and Git decide, never the
 * agent's claim.
 */

/** What Git says of the worktree in one hook call: the commit `HEAD` names, and an empty status. */
interface Tree {
  readonly head: string | null;
  readonly clean: boolean;
}

/** The Git reading of each hook call (`readTree`): `null` when Git failed or took too long. */
const trees = new WeakMap<HookContext, Tree | null>();

/** How long `readTree` lets `git status` take at most; past it the second proof fails. */
export const NO_EDIT_GIT_TIMEOUT_MS = 1_000;

/**
 * Whether the worktree had no revision since `context`'s consumer
 * registered, and one of two proofs says no change escaped the revisions:
 *
 * 1. The daemon that had finished its start scan at registration is the one
 *    recorded (`seesEveryChange`): an edit made while no daemon ran is in no
 *    revision until a start scan.
 * 2. Row 011-312: Git, as this hook call read it (`readTree`), shows the
 *    commit the registration recorded (`Registration.head`) and an empty
 *    status: no change to a tracked file and no untracked file Git does not
 *    ignore. Without that reading or a recorded `head` it fails.
 *
 * Any revision counts, another session's or the agent's own. Every agent
 * counts, a subagent too. Limit: an edit to a file Git ignores, made while no
 * daemon watched, is in neither proof. Call inside a transaction.
 */
export function unchangedSinceRegistration(context: HookContext): boolean {
  const { store, consumer } = context;
  const r = registration(store, consumer);
  if (r === null) return false;
  if ((store.revisions.latest(consumer.worktreeId)?.number ?? 0) !== r.since) return false;
  if (seesEveryChange(store, consumer.worktreeId, r)) return true;
  const tree = trees.get(context);
  return r.head !== undefined && tree?.clean === true && tree.head === r.head;
}

/**
 * Reads Git for the second proof once per hook call, before the
 * transactions that decide, and only where it can decide: the consumer is
 * registered with a `head`, the worktree had no revision since, and the
 * first proof fails. `timeoutMs` bounds `git status`; at or below 0 it reads
 * nothing.
 */
export async function readTree(
  context: HookContext,
  timeoutMs: number = NO_EDIT_GIT_TIMEOUT_MS,
): Promise<void> {
  if (trees.has(context) || timeoutMs <= 0) return;
  const { store, consumer } = context;
  const needed = readTransaction(store, () => {
    const r = registration(store, consumer);
    if (r?.head === undefined || seesEveryChange(store, consumer.worktreeId, r)) return false;
    return (store.revisions.latest(consumer.worktreeId)?.number ?? 0) === r.since;
  });
  if (needed) trees.set(context, await treeNow(context.root, Math.round(timeoutMs)));
}

/** `HEAD` after `git status`, so a commit made meanwhile reads as a moved `HEAD`. */
async function treeNow(root: AbsolutePath, timeoutMs: number): Promise<Tree | null> {
  try {
    const status = await runGit(
      root,
      ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=all"],
      { timeoutMs },
    );
    return { head: registrationHead(root), clean: status === "" };
  } catch {
    return null;
  }
}
