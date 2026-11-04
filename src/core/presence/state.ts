import type { Presence } from "./decide.js";

/*
 * Row 011-293 (`research/daemon-presence.md`, decision 3): the one state
 * daemon presence is in, with its notes, from the findings `decidePresence`
 * made. The priority order replaces the scattered "a start wins over a stop"
 * rules.
 */

/** The presence states, highest priority first (`GLOSSARY.md`). */
export type PresenceState =
  | "validating"
  | "stopping"
  | "starting"
  | "stopped by request"
  | "resting"
  | "heartbeat late"
  | "gone";

/** The notes that may come with a presence state. */
export type PresenceNote = "last one died" | "handoff ended short" | "change feed late";

/** The state `presence` is in, and its notes, highest priority first (decision 3). */
export function presenceState(presence: Presence): {
  readonly state: PresenceState;
  readonly notes: readonly PresenceNote[];
} {
  const notes: PresenceNote[] = [];
  if (presence.died() !== null) notes.push("last one died");
  if (presence.short !== null) notes.push("handoff ended short");
  if (presence.late !== null) notes.push("change feed late");
  return { state: stateOf(presence), notes };
}

function stateOf(p: Presence): PresenceState {
  if (p.heartbeat.state === "alive" && p.stopping === null) return "validating";
  if (p.stopping !== null) return "stopping";
  const quiet = p.rest?.kind === "quiet" ? p.rest : null;
  if (p.start !== null || quiet?.spawnedAt !== undefined) return "starting";
  if (p.stopped) return "stopped by request";
  if (quiet !== null) return "resting";
  return p.heartbeatLate() === null ? "gone" : "heartbeat late";
}
