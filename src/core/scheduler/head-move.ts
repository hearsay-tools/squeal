import { gitHead } from "../status/git-head.js";
import { type HeadMove, headMoveMetaKey, parseHeadMove } from "../types/index.js";
import type { SchedulerContext } from "./context.js";
import type { Ledger } from "./ledger.js";

/**
 * Task 001-406: a reconciliation pass that made no revision records `HEAD`
 * when it moved since the last revision or record (a commit, a partial one
 * included), with the dirty flag then. `HEAD` is read from the git dir's
 * files, else from git (row 011-239: a reftable repository); `git status`
 * runs only on a move.
 */
export async function recordHeadMove(context: SchedulerContext, ledger: Ledger): Promise<void> {
  const { store, worktreeId } = context;
  const key = headMoveMetaKey(worktreeId);
  const { number, head } = ledger.revision;
  const recorded = parseHeadMove(store.meta.get(key));
  const known = recorded !== null && recorded.revision >= number ? recorded.head : head;
  if ((await gitHead(context.root)) === known) return;
  const seen = await context.head();
  const move: HeadMove = { head: seen.head, dirty: seen.dirty, revision: ledger.revision.number };
  store.meta.set(key, JSON.stringify(move));
}
