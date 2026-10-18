import { closureChanges } from "../delivery/attribution.js";
import type {
  CheckId,
  KnownState,
  RelativePath,
  RevisionNumber,
  Store,
  WorktreeId,
} from "../types/index.js";

/** The harness session `squeal why` runs in, from its shell (`waitConsumer`); `null` when it names none. */
export interface WhySession {
  readonly session: string | null;
  readonly agent: string | null;
}

/**
 * 011 C5 as amended (gh-32, task 011-18): for a failing check, the closure
 * paths of its test file changed since the shell's session registered, as a
 * delivery names them. The session's main agent is read when the shell names
 * no agent. `undefined` with no failure, no registered consumer of the
 * session, or when the changes are not known.
 */
export function whyClosureChanges(
  store: Store,
  worktreeId: WorktreeId,
  check: CheckId,
  knownState: KnownState | null,
  revision: RevisionNumber | null,
  { session, agent }: WhySession,
): readonly RelativePath[] | undefined {
  if (knownState?.outcome !== "fail" || session === null || revision === null) return undefined;
  const ofSession = store.consumers
    .list(worktreeId)
    .map((r) => r.consumer)
    .filter((c) => c.sessionId === session && (agent === null || c.agentId === agent));
  const consumer = ofSession.find((c) => c.agentId === "main") ?? ofSession[0];
  return consumer === undefined ? undefined : closureChanges(store, consumer, revision)(check);
}
