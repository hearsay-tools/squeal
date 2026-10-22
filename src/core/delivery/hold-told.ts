import { isRecord } from "../fs/index.js";
import { type KeyedHold, readKeyedHolds } from "../status/holds.js";
import {
  type Consumer,
  type EpochMs,
  type HoldChange,
  type HoldEnded,
  type StatusHeader,
  type StatusHold,
  type Store,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";
import { worktreeLiveness } from "./liveness.js";
import { readSlot, writeSlot } from "./slots.js";

/*
 * Row 011-73 (spec 011 C8 as amended 2026-10-21): a hold's start and end are
 * told as liveness is, once per change and in one line each. What each
 * consumer was last told is each hold's id (`KeyedHold`: `merge`, or a
 * command hold's token) and what names its end, so a change says which hold
 * started or ended, and two holds of one command stay two (review 0.1.269,
 * B2). Holds are judged only while the daemon is alive: a merge hold is
 * trusted from a live daemon alone, and a daemon going down is liveness's
 * news, not the end of a hold.
 */

/** `meta` key of the holds each consumer of a worktree was last told. */
export function holdToldMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("holdTold", worktreeId);
}

/** One hold a consumer was told: its id, and how its end is named. */
interface ToldHold {
  readonly id: string;
  readonly ended: HoldEnded;
}

/** The changes since a consumer was last told: the holds now, those that ended, and those that started. */
export interface HoldsChange {
  readonly now: readonly KeyedHold[];
  readonly ended: readonly HoldEnded[];
  readonly started: readonly StatusHold[];
}

function endedOf(hold: StatusHold): HoldEnded {
  return hold.cause === "merge"
    ? { cause: "merge" }
    : { cause: "command", command: hold.command, pid: hold.pid };
}

function isEnded(value: unknown): value is HoldEnded {
  if (!isRecord(value)) return false;
  if (value.cause === "merge") return true;
  const pid = value.pid;
  return (
    value.cause === "command" &&
    typeof value.command === "string" &&
    (pid === undefined || pid === null || typeof pid === "number")
  );
}

/** The holds `consumer` was last told; none when it was told none, or by an older Squeal. */
function toldHolds(store: Store, consumer: Consumer): ToldHold[] {
  const value = readSlot(store, holdToldMetaKey(consumer.worktreeId), consumer);
  if (!Array.isArray(value)) return [];
  return value.flatMap((v: unknown) =>
    isRecord(v) && typeof v.id === "string" && isEnded(v.ended)
      ? [{ id: v.id, ended: v.ended }]
      : [],
  );
}

/** The holds on the worktree's validation now, each with its id, as status reads them at `at`. */
export function heldNow(store: Store, worktreeId: WorktreeId, at: EpochMs): KeyedHold[] {
  const worktree = store.worktrees.get(worktreeId);
  return readKeyedHolds(store, worktree, worktreeLiveness(worktree, at), at);
}

/** Records `holds` as told to `consumer`; none, or `null`, forgets it. Call inside a transaction. */
export function tellHolds(
  store: Store,
  consumer: Consumer,
  holds: readonly KeyedHold[] | null,
): void {
  const told = (holds ?? []).map(({ id, hold }): ToldHold => ({ id, ended: endedOf(hold) }));
  writeSlot(store, holdToldMetaKey(consumer.worktreeId), consumer, told.length === 0 ? null : told);
}

/**
 * The holds that ended and started since `consumer` was last told, by id,
 * else `null`; none while the daemon is not alive. Call inside a transaction.
 */
export function holdsChange(store: Store, consumer: Consumer, at: EpochMs): HoldsChange | null {
  const worktree = store.worktrees.get(consumer.worktreeId);
  const live = worktreeLiveness(worktree, at);
  if (live.state !== "alive") return null;
  const now = readKeyedHolds(store, worktree, live, at);
  const before = toldHolds(store, consumer);
  const ids = new Set(now.map((k) => k.id));
  const told = new Set(before.map((t) => t.id));
  const ended = before.filter((t) => !ids.has(t.id)).map((t) => t.ended);
  const started = now.filter((k) => !told.has(k.id)).map((k) => k.hold);
  return ended.length === 0 && started.length === 0 ? null : { now, ended, started };
}

/**
 * The delivered changes, ends first, then starts, one line each: an end
 * while holds remain, or before another end, is `ended`; the last end when
 * none remains is `resumed`, with the test files now waiting to run, from
 * `header`.
 */
export function holdChanges(change: HoldsChange, header: StatusHeader): HoldChange[] {
  const holds = change.now.map((k) => k.hold);
  const last = holds.length === 0 ? change.ended.length - 1 : -1;
  const ends = change.ended.map(
    (ended, i): HoldChange =>
      i === last
        ? {
            kind: "resumed",
            ended,
            queued: header.testFilesByPhase?.queued ?? 0,
            running: header.testFilesByPhase?.running ?? 0,
          }
        : { kind: "ended", ended, holds },
  );
  return [...ends, ...change.started.map((hold): HoldChange => ({ kind: "on-hold", hold }))];
}
