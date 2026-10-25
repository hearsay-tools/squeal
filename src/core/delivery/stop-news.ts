import type { DaemonLiveness } from "../types/index.js";
import type { HoldsChange } from "./hold-told.js";

/**
 * Row 011-215 (gh-93; 002 D3 and 011 C8 as amended 2026-10-25): news at Stop
 * costs a continuation, so a liveness change is news there on its own only
 * when it names an action. A daemon down with no successor, a handoff past
 * its bound (`squeal start` finishes it) and a handoff that ended short (row
 * 011-140) do; a handover to a named successor within its bound and a daemon
 * validating again do not, and wait for the next tool or prompt boundary, as
 * a hold change does.
 */
export function actsAtStop(live: DaemonLiveness): boolean {
  if (live.stopping !== undefined) return live.stopping.overdue || live.stopping.to === undefined;
  return live.state === "down" || live.short !== undefined;
}

/** The liveness and hold changes a delivery tells now. */
export interface ChangesTold {
  readonly live: DaemonLiveness | null;
  readonly held: HoldsChange | null;
}

/**
 * `changes`, or at a Stop with no transition and no liveness change that
 * `actsAtStop`, none: they stay untold, so the next boundary tells them.
 */
export function toldAtStop(
  { stop, transitions }: { readonly stop: boolean; readonly transitions: boolean },
  changes: ChangesTold,
): ChangesTold {
  const waits = stop && !transitions && (changes.live === null || !actsAtStop(changes.live));
  return waits ? { live: null, held: null } : changes;
}
