import { storePaths } from "../../core/store/index.js";
import type { Consumer, WorktreeId } from "../../core/types/index.js";
import type { HookContext } from "./context.js";
import { removeWaiterLock } from "./waiter-lock.js";

/**
 * Unregisters every consumer of `sessionId`, main agent and subagents, in
 * every worktree the store knows plus the hook's own, and with `removeLocks`
 * removes the waiter lock files no waiter holds. Returns the consumers it
 * unregistered.
 *
 * Lessons, defect 5: a session's cwd can move to another worktree of the
 * repository after it registered, so its consumers are looked up by session
 * id in all of them. Store writes only; no daemon is involved. Every consumer
 * is unregistered before any lock file is touched, and a failure on one does
 * not stop the others: the first error is thrown once all were tried.
 */
export async function unregisterSession(
  context: HookContext,
  sessionId: string,
  options: {
    readonly removeLocks: boolean;
    /** Left registered: SessionStart re-registers its own consumer in one transaction. */
    readonly except?: Consumer;
  },
): Promise<Consumer[]> {
  const { store, delivery } = context;
  const worktrees = new Set<WorktreeId>([
    context.consumer.worktreeId,
    ...store.worktrees.list().map((w) => w.id),
  ]);
  const consumers = [...worktrees].flatMap((id) =>
    store.consumers
      .list(id)
      .map((record) => record.consumer)
      .filter((consumer) => consumer.sessionId === sessionId && !same(consumer, options.except)),
  );
  const errors: unknown[] = [];
  const attempt = async (fn: () => unknown) => {
    try {
      await fn();
    } catch (error) {
      errors.push(error);
    }
  };
  for (const consumer of consumers) await attempt(() => delivery.unregister(consumer));
  if (options.removeLocks) {
    const { locksDir } = storePaths(context.commonDir);
    for (const consumer of consumers) await attempt(() => removeWaiterLock(locksDir, consumer));
  }
  if (errors.length > 0) throw errors[0];
  return consumers;
}

function same(a: Consumer, b: Consumer | undefined): boolean {
  return (
    b !== undefined &&
    a.worktreeId === b.worktreeId &&
    a.sessionId === b.sessionId &&
    a.agentId === b.agentId
  );
}
