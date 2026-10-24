import type { CodeStore } from "../code/store/types.js";
import type { CodeKnownState } from "../types/code.js";
import type { Consumer, RevisionNumber, Store, WorktreeId } from "../types/index.js";
import { lastTransition } from "./code-deliver.js";
import { type Registration, registration } from "./registered.js";

/*
 * Spec 015 D6, D7: "since this session started" for status, Stop's check
 * and `squeal code --changed`, which read the store with no consumer of
 * their own. The session is the shell's (`waitConsumer`, 011 C6), else the
 * oldest registration of a consumer still registered in the worktree.
 */

/** The shell a command runs in: its harness session, and the agent when the shell names one. */
export interface ShellSession {
  readonly session: string | null;
  readonly agent: string | null;
}

/** The revision changes count from, and whose registration it is. */
export interface CodeSince {
  readonly since: RevisionNumber;
  readonly scope: "session" | "oldest";
}

/**
 * Lessons round 1, P2 (sq2): the revision a registration's code changes
 * count after. A registration made before the daemon's start scan (no
 * `scanned`) is followed by the scan's `start` revision, which holds what
 * changed while no daemon ran: that revision is the registration's, not the
 * session's, so the view takes it in by count. An edit the scan absorbed
 * goes with it, as its attribution is unknown (task 001-96).
 */
function seenUpTo(store: Store, worktreeId: WorktreeId, r: Registration): RevisionNumber {
  if (r.scanned !== undefined) return r.since;
  const next = store.revisions.get(worktreeId, r.since + 1);
  return next?.trigger === "start" ? next.number : r.since;
}

/** `consumer`'s code changes count after this revision (`seenUpTo`); `null` when no registration is recorded. */
export function codeSeenUpTo(store: Store, consumer: Consumer): RevisionNumber | null {
  const r = registration(store, consumer);
  return r === null ? null : seenUpTo(store, consumer.worktreeId, r);
}

/** The earliest registration of `consumers`; `null` when none has one. */
function earliest(store: Store, consumers: readonly Consumer[]): RevisionNumber | null {
  const revisions = consumers.flatMap((c) => codeSeenUpTo(store, c) ?? []);
  return revisions.length === 0 ? null : Math.min(...revisions);
}

/** The consumers registered in the worktree, and those of them that are the shell's session. */
function registeredOf(store: Store, worktreeId: WorktreeId, shell: ShellSession | null) {
  const registered = store.consumers.list(worktreeId).map((r) => r.consumer);
  const own = registered.filter(
    (c) =>
      shell?.session != null &&
      c.sessionId === shell.session &&
      (shell.agent === null || c.agentId === shell.agent),
  );
  return { registered, own };
}

/**
 * Where "since this session started" starts in the worktree: the shell's
 * session's registration, else the oldest registered consumer's; `null`
 * when no consumer is registered.
 */
export function codeSince(
  store: Store,
  worktreeId: WorktreeId,
  shell: ShellSession | null,
): CodeSince | null {
  const { registered, own } = registeredOf(store, worktreeId, shell);
  const session = earliest(store, own);
  if (session !== null) return { since: session, scope: "session" };
  const oldest = earliest(store, registered);
  return oldest === null ? null : { since: oldest, scope: "oldest" };
}

/** Whose code views `squeal code --told` reads (row 015-27). */
export interface ToldTo {
  readonly consumers: readonly Consumer[];
  readonly scope: "session" | "worktree";
}

/**
 * The shell's session's registered consumers, else every consumer
 * registered in the worktree; `null` when none is registered.
 */
export function toldTo(
  store: Store,
  worktreeId: WorktreeId,
  shell: ShellSession | null,
): ToldTo | null {
  const { registered, own } = registeredOf(store, worktreeId, shell);
  if (own.length > 0) return { consumers: own, scope: "session" };
  return registered.length === 0 ? null : { consumers: registered, scope: "worktree" };
}

/** `consumer`'s registration as a `CodeSince`; `null` when none is recorded. */
export function consumerSince(store: Store, consumer: Consumer): CodeSince | null {
  const since = codeSeenUpTo(store, consumer);
  return since === null ? null : { since, scope: "session" };
}

/**
 * Spec 015 D7: the functions failing now that went to `fail` after `since`,
 * by their last transition. One already failing at registration, or failing
 * since a first count or a recount (no transition), is not among them.
 */
export function wentOverSince(
  code: CodeStore,
  worktreeId: WorktreeId,
  since: RevisionNumber,
): CodeKnownState[] {
  return code.states.list(worktreeId, { measure: "complexity", outcome: "fail" }).filter((s) => {
    const last = lastTransition(code, worktreeId, s.check);
    return last?.to === "fail" && last.revision > since;
  });
}

/** The functions whose state changed after `since`, by their last transition, any outcome now. */
export function changedSince(
  code: CodeStore,
  worktreeId: WorktreeId,
  since: RevisionNumber,
): CodeKnownState[] {
  return code.states.list(worktreeId, { measure: "complexity" }).filter((s) => {
    const last = lastTransition(code, worktreeId, s.check);
    return last !== null && last.revision > since;
  });
}
