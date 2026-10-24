import type { CodeStore } from "../code/store/types.js";
import type { CodeKnownState, CodeMeasure } from "../types/code.js";
import type { Consumer, RevisionNumber, Store, WorktreeId } from "../types/index.js";
import { lastTransition } from "./code-deliver.js";
import { type CodeBound, isOwn } from "./code-delta.js";
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

/** The revisions changes count in (`since` is the one they count after), and whose registration it is. */
export interface CodeSince extends CodeBound {
  readonly scope: "session" | "oldest";
}

/**
 * Lessons round 1, P2 (sq2), and review 0.1.290 B1: the revisions a
 * registration's code changes count in. A registration made before the
 * daemon's start scan (no `scanned`) is followed by the scan's `start`
 * revision, which holds what changed while no daemon ran: that revision is
 * the registration's, not the session's, so the view takes it in by count.
 * That holds at each point the consumer registered: `since`, and the `upTo`
 * of each gap, where it came back from a park. So the scan after a resume
 * joins the gap of the time away, and the session's changes before the
 * pause stay its own. An edit a scan absorbed goes with it, as its
 * attribution is unknown (task 001-96).
 */
function seenUpTo(store: Store, worktreeId: WorktreeId, r: Registration): CodeBound {
  if (r.scanned !== undefined) return { since: r.since, gaps: r.gaps };
  const scan = (at: RevisionNumber) =>
    store.revisions.get(worktreeId, at + 1)?.trigger === "start" ? at + 1 : at;
  return { since: scan(r.since), gaps: r.gaps.map(([after, upTo]) => [after, scan(upTo)]) };
}

/** The revisions `consumer`'s code changes count in (`seenUpTo`); `null` when no registration is recorded. */
export function codeSeenUpTo(store: Store, consumer: Consumer): CodeBound | null {
  const r = registration(store, consumer);
  return r === null ? null : seenUpTo(store, consumer.worktreeId, r);
}

/** The earliest registration of `consumers`, with its gaps; `null` when none has one. */
function earliest(store: Store, consumers: readonly Consumer[]): CodeBound | null {
  const bounds = consumers.flatMap((c) => codeSeenUpTo(store, c) ?? []);
  return bounds.reduce<CodeBound | null>((a, b) => (a === null || b.since < a.since ? b : a), null);
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
  if (session !== null) return { ...session, scope: "session" };
  const oldest = earliest(store, registered);
  return oldest === null ? null : { ...oldest, scope: "oldest" };
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
  return since === null ? null : { ...since, scope: "session" };
}

/**
 * Spec 015 D7: the states of `measures` failing now that went to `fail` in
 * `since`'s revisions, by their last transition, a measure after another.
 * One already failing at registration, or failing since a first count or a
 * recount (no transition), is not among them. Status counts complexity
 * only; Stop, the coverage measures too (row 015-40).
 */
export function wentOverSince(
  code: CodeStore,
  worktreeId: WorktreeId,
  since: CodeBound,
  measures: readonly CodeMeasure[] = ["complexity"],
): CodeKnownState[] {
  return measures.flatMap((measure) =>
    code.states.list(worktreeId, { measure, outcome: "fail" }).filter((s) => {
      const last = lastTransition(code, worktreeId, s.check, measure);
      return last?.to === "fail" && isOwn(since, last.revision);
    }),
  );
}

/** The functions whose state changed in `since`'s revisions, by their last transition, any outcome now. */
export function changedSince(
  code: CodeStore,
  worktreeId: WorktreeId,
  since: CodeBound,
): CodeKnownState[] {
  return code.states.list(worktreeId, { measure: "complexity" }).filter((s) => {
    const last = lastTransition(code, worktreeId, s.check);
    return last !== null && isOwn(since, last.revision);
  });
}
