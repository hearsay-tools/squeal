import { isRecord } from "../fs/json.js";
import type { EpochMs } from "../types/common.js";
import type { PresenceNote, PresenceState } from "./state.js";

/*
 * Row 011-295: what a consumer was told about the daemon, kept per consumer
 * (`delivery/liveness.ts`), and whether news has anything new to tell it.
 */

/**
 * What a delivery or a registration told, in the header's words (`toldOf`):
 * the presence state and the notes the header said with it. With the note
 * "handoff ended short", `short` names that daemon (row 011-140), so a
 * release before row 011-295 reads the value as `{ short }`; it reads any
 * other one as `alive`.
 */
export interface ToldPresence {
  readonly state: PresenceState;
  readonly notes: readonly PresenceNote[];
  readonly short?: string;
}

/**
 * What a consumer was last told about the daemon: `ToldPresence`, or
 * `{ startingSince }` after a registration that said a daemon a hook spawned
 * is starting (task 001-156). `alive`, `down` and `{ short }` are what a
 * release before row 011-295 kept; they read as that release read them.
 */
export type ToldLiveness =
  | "alive"
  | "down"
  | { readonly startingSince: EpochMs }
  | { readonly short: string }
  | ToldPresence;

const STATES: ReadonlySet<string> = new Set<PresenceState>([
  "validating",
  "stopping",
  "starting",
  "stopped by request",
  "resting",
  "heartbeat late",
  "gone",
]);
const NOTES: ReadonlySet<string> = new Set<PresenceNote>([
  "last one died",
  "handoff ended short",
  "change feed late",
]);

/**
 * A stored told value. A consumer registered before liveness was tracked was
 * told nothing, which read as a validating daemon: `alive`, as does a value
 * no release wrote.
 */
export function readTold(value: unknown): ToldLiveness {
  if (value === "down") return "down";
  if (!isRecord(value)) return "alive";
  const { state, notes, short, startingSince } = value;
  if (typeof state === "string" && STATES.has(state)) {
    const said = Array.isArray(notes) ? notes.filter((n) => NOTES.has(n)) : [];
    return {
      state: state as PresenceState,
      notes: said as PresenceNote[],
      ...(typeof short === "string" ? { short } : {}),
    };
  }
  if (typeof short === "string") return { short };
  return typeof startingSince === "number" ? { startingSince: startingSince as EpochMs } : "alive";
}

/**
 * Whether `told` already said `now`: the same state, and every note `now`
 * says with it (a note that ends is no news), the short handoff's daemon
 * included. A value a release before row 011-295 kept is read as it read it:
 * `down` already said every state of a daemon that does not validate, and any
 * other value a validating one, except a short handoff it did not name.
 */
export function alreadyTold(told: ToldLiveness, now: ToldPresence): boolean {
  if (typeof told === "object" && "state" in told) {
    const notes = now.notes.every((note) => told.notes.includes(note));
    return (
      told.state === now.state && notes && (now.short === undefined || told.short === now.short)
    );
  }
  if (now.state !== "validating") return told === "down";
  if (now.short === undefined) return told !== "down";
  return typeof told === "object" && "short" in told && told.short === now.short;
}
