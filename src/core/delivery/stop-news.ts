import type { DaemonLiveness } from "../types/index.js";
import type { HoldsChange } from "./hold-told.js";

/*
 * Row 011-215 (gh-93; 002 D3 and 011 C8 as amended 2026-10-25): news at Stop
 * costs a continuation, so a liveness or hold change with no test transition
 * is news there only when it names an action. The others wait for the next
 * tool or prompt boundary, which tells them.
 */

/**
 * Whether a liveness change names an action at Stop: a daemon down with no
 * successor, a handoff past its bound (`squeal start` finishes it) and a
 * handoff that ended short (row 011-140) do; a handover to a named successor
 * within its bound and a daemon validating again do not.
 */
export function actsAtStop(live: DaemonLiveness): boolean {
  if (live.stopping !== undefined) return live.stopping.overdue || live.stopping.to === undefined;
  return live.state === "down" || live.short !== undefined;
}

/**
 * Whether a hold change names an action at Stop: a merge hold's start does
 * (resolve the paths, or abort); a command hold the agent started and a
 * hold's end do not (the coordinator's reading of the row, 2026-10-25).
 */
export function holdActsAtStop(change: HoldsChange): boolean {
  return change.started.some((hold) => hold.cause === "merge");
}

/** The liveness and hold changes a delivery tells now. */
export interface ChangesTold {
  readonly live: DaemonLiveness | null;
  readonly held: HoldsChange | null;
}

/**
 * `changes`, or at a Stop with no transition and no change that names an
 * action, none: they stay untold, so the next boundary tells them. With one
 * that does, the Stop speaks and tells them all.
 */
export function toldAtStop(
  { stop, transitions }: { readonly stop: boolean; readonly transitions: boolean },
  changes: ChangesTold,
): ChangesTold {
  if (!stop || transitions) return changes;
  const { live, held } = changes;
  const acts = (live !== null && actsAtStop(live)) || (held !== null && holdActsAtStop(held));
  return acts ? changes : { live: null, held: null };
}
