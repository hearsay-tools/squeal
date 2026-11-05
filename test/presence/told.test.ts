import { describe, expect, it } from "vitest";
import { livenessMetaKey, tellLiveness, toldLiveness } from "../../src/core/delivery/liveness.js";
import { readSlot } from "../../src/core/delivery/slots.js";
import { isRecord } from "../../src/core/fs/index.js";
import {
  alreadyTold,
  type ToldLiveness,
  type ToldPresence,
  toldOf,
} from "../../src/core/presence/index.js";
import type { DaemonLiveness, EpochMs } from "../../src/core/types/index.js";
import { at, SELF, scratch, VERSION } from "./fixture.js";

/*
 * Row 011-295: what a consumer was told holds the presence state and the
 * notes the header said. A value a release before this row stored reads as
 * that release read it; that release reads a value this one stores without
 * error. `previous` is 0.1.404's reader and its news rule, copied verbatim
 * from `delivery/liveness.ts` and `presence/views.ts` at 45eb4b8a1.
 */

type PreviousTold =
  | "alive"
  | "down"
  | { readonly startingSince: EpochMs }
  | { readonly short: string };

const previous = {
  /** 0.1.404's `toldLiveness` after its `readSlot`. */
  read(told: unknown): PreviousTold {
    if (told === "down") return "down";
    if (isRecord(told) && typeof told.short === "string") return { short: told.short };
    const since = isRecord(told) ? told.startingSince : undefined;
    return typeof since === "number" ? { startingSince: since as EpochMs } : "alive";
  },
  /** 0.1.404's `newsChange` after its start and rest rules: whether `live` is no news. */
  same(told: PreviousTold, live: DaemonLiveness): boolean {
    if (live.state === "alive" && live.short !== undefined) {
      return typeof told === "object" && "short" in told && told.short === live.short.of;
    }
    const was = typeof told === "object" ? "alive" : told;
    return live.state === was;
  },
};

const alive = { state: "alive", lastHeartbeatAt: at(-2_000) } as const;
const stale = { state: "down", since: at(-12_000) } as const;
const short = { of: SELF, version: VERSION, claimed: "0.1.401", since: at(-50_000) };
const stopping = { from: VERSION, since: at(-12_000), overdue: false };

/** One delivered liveness for each presence state and note news tells, as the header has it. */
const lives: readonly (readonly [string, DaemonLiveness, ToldPresence])[] = [
  ["validating", alive, { state: "validating", notes: [] }],
  [
    "a short handoff",
    { ...alive, short },
    { state: "validating", notes: ["handoff ended short"], short: SELF },
  ],
  ["stopping, its heartbeat current", { ...alive, stopping }, { state: "validating", notes: [] }],
  ["stopping", { ...stale, stopping }, { state: "stopping", notes: [] }],
  ["stopped by request", { ...stale, stopped: true }, { state: "stopped by request", notes: [] }],
  [
    "stopped until start, the last one died",
    { ...stale, stopped: true, untilStart: true, died: { runs: [] } },
    { state: "stopped by request", notes: [] },
  ],
  [
    "starting, the last one died",
    { ...stale, died: { runs: [] }, startingSince: at(-1_000) },
    { state: "starting", notes: ["last one died"] },
  ],
  ["resting", { ...stale, resting: true }, { state: "resting", notes: [] }],
  [
    "heartbeat late",
    { ...stale, heartbeatLate: { ageMs: 12_000 } },
    { state: "heartbeat late", notes: [] },
  ],
  ["gone", stale, { state: "gone", notes: [] }],
  [
    "gone, the last one died",
    { ...stale, died: { runs: [] } },
    { state: "gone", notes: ["last one died"] },
  ],
];

/** Each value a release before row 011-295 stored, and none. */
const stored: readonly (readonly [string, unknown])[] = [
  ["nothing", undefined],
  ["alive", "alive"],
  ["down", "down"],
  ["a short handoff", { short: SELF }],
  ["another short handoff", { short: `${VERSION}@1#other` }],
  ["a start", { startingSince: at(-3_000) }],
  ["a value no release wrote", { since: 1 }],
];

/** `value` stored as the consumer's told value, and the store to read it from. */
function storedTold(value: ToldLiveness) {
  const { store, id, release } = scratch({ heartbeat: -2_000 });
  const consumer = { worktreeId: id, sessionId: "s1", agentId: "main" };
  store.consumers.register(consumer, at(0));
  store.transaction(() => tellLiveness(store, consumer, value));
  const raw = () => readSlot(store, livenessMetaKey(id), consumer);
  return { store, consumer, raw, release };
}

describe("what a consumer was told, across releases (row 011-295)", () => {
  it.each(lives)("says %s in the header's words", (_name, live, told) => {
    expect(toldOf(live)).toEqual(told);
    expect(alreadyTold(told, told)).toBe(true);
  });

  it.each(stored)("reads %s, stored by the previous release, as that release did", (_n, value) => {
    const told = storedTold(value as ToldLiveness);
    try {
      const now = toldLiveness(told.store, told.consumer);
      const then = previous.read(told.raw());
      expect(now).toEqual(value === undefined ? "alive" : previous.read(value));
      for (const [, live] of lives) {
        expect(alreadyTold(now, toldOf(live))).toBe(previous.same(then, live));
      }
    } finally {
      told.release();
    }
  });

  it.each(lives)("is read by the previous release without error: %s", (_name, live, told) => {
    const kept = storedTold(told);
    try {
      expect(toldLiveness(kept.store, kept.consumer)).toEqual(told);
      const then = previous.read(kept.raw());
      // A validating daemon reads as it did; any other state as `alive`, so that release tells it once more.
      expect(then).toEqual(told.short === undefined ? "alive" : { short: told.short });
      expect(previous.same(then, live)).toBe(live.state === "alive");
    } finally {
      kept.release();
    }
  });
});
