import { readHolds } from "../status/holds.js";
import {
  type Consumer,
  type HoldChange,
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
 * consumer was last told is one label a hold, `merge` or the command's text,
 * so the line at the end names what ended. Holds are judged only while the
 * daemon is alive: a merge hold is trusted from a live daemon alone, and a
 * daemon going down is liveness's news, not the end of a hold.
 */

/** `meta` key of the holds each consumer of a worktree was last told. */
export function holdToldMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("holdTold", worktreeId);
}

const COMMAND = "command:";

/** One label a hold, in `holds`' order. */
function labels(holds: readonly StatusHold[]): string[] {
  return holds.map((hold) => (hold.cause === "merge" ? "merge" : `${COMMAND}${hold.command}`));
}

/**
 * The labels `consumer` was last told, for `holdChangeOf`; none when it was
 * told none or by an older Squeal. Call inside a transaction.
 */
export function toldHolds(store: Store, consumer: Consumer): readonly string[] {
  const value = readSlot(store, holdToldMetaKey(consumer.worktreeId), consumer);
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Records `holds` as told to `consumer`; none, or `null`, forgets it. Call inside a transaction. */
export function tellHolds(
  store: Store,
  consumer: Consumer,
  holds: readonly StatusHold[] | null,
): void {
  const now = holds === null ? [] : labels(holds);
  writeSlot(store, holdToldMetaKey(consumer.worktreeId), consumer, now.length === 0 ? null : now);
}

/**
 * The holds now when they differ from what `consumer` was told, else `null`;
 * none while the daemon is not alive. Call inside a transaction.
 */
export function holdsChange(
  store: Store,
  consumer: Consumer,
  at: number,
): readonly StatusHold[] | null {
  const worktree = store.worktrees.get(consumer.worktreeId);
  const live = worktreeLiveness(worktree, at);
  if (live.state !== "alive") return null;
  const now = readHolds(store, worktree, live, at);
  const before = toldHolds(store, consumer);
  const after = labels(now);
  return after.length === before.length && after.every((label, i) => label === before[i])
    ? null
    : now;
}

/**
 * The delivered change from `holds`, the holds now, read after the
 * consumer was last told `before`: the first hold, or what ended and the
 * test files now waiting to run, from `header`.
 */
export function holdChangeOf(
  holds: readonly StatusHold[],
  before: readonly string[],
  header: StatusHeader,
): HoldChange {
  const [first] = holds;
  if (first !== undefined) return { kind: "on-hold", hold: first };
  const last = before[0] ?? "merge";
  return {
    kind: "resumed",
    ended: last.startsWith(COMMAND)
      ? { cause: "command", command: last.slice(COMMAND.length) }
      : { cause: "merge" },
    queued: header.testFilesByPhase?.queued ?? 0,
    running: header.testFilesByPhase?.running ?? 0,
  };
}
