/*
 * Row 011-293 (`research/daemon-presence.md`, decision 3): the states daemon
 * presence is in, and their notes. Row 005-118: `toldOf` (`views.ts`) decides
 * which one a liveness tells, the one place that does.
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
export type PresenceNote =
  | "last one died"
  | "handoff ended short"
  | "change feed late"
  | "start slow"
  | "start stopped";
