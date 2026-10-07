import { isRecord } from "../fs/index.js";
import { testFileId } from "../keys/index.js";
import { readHeader, testFileKeyOf } from "../state/index.js";
import type {
  Consumer,
  DeltaEntry,
  KnownState,
  Store,
  TurnState,
  WorktreeId,
} from "../types/index.js";

/*
 * Each consumer's turn state (task 001-85; lessons, defect 14), the part of
 * its view that says when the idle waiter may speak. A waiter message written
 * mid-turn lands only at the next tool boundary, after PostToolBatch has
 * delivered the same news with a newer header; so the waiter speaks only to
 * an idle agent, and only about the test files it stopped while waiting for.
 *
 * Like told liveness it lives in `meta`, one row per worktree:
 * `{ "<session>\n<agent>": TurnState }`, written inside the delivery's
 * transaction, with consumers no longer registered dropped on every write.
 * Not a `consumers` column: a schema step makes every older hook and daemon
 * sharing the store report "store version newer", and a missing row reads as
 * the state a consumer starts in.
 */

/** `meta` key of a worktree's turn states. */
export function turnMetaKey(worktreeId: WorktreeId): string {
  return `turn:${worktreeId}`;
}

/** A consumer starts idle, waiting for nothing: the waiter is silent until a turn ends. */
export const START_IDLE: TurnState = { turn: "idle", testFiles: [], newTestFiles: false };

const IN_TURN: TurnState = { turn: "in-turn" };

type Turns = Record<string, TurnState>;

const slot = (consumer: Consumer) => `${consumer.sessionId}\n${consumer.agentId}`;

function readAll(store: Store, worktreeId: WorktreeId): Turns {
  const raw = store.meta.get(turnMetaKey(worktreeId));
  if (raw === null) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? (value as Turns) : {};
  } catch {
    return {};
  }
}

function parse(value: unknown): TurnState {
  if (!isRecord(value)) return START_IDLE;
  if (value.turn === "in-turn") return IN_TURN;
  const files = Array.isArray(value.testFiles) ? value.testFiles : [];
  return {
    turn: "idle",
    testFiles: files.filter((f): f is string => typeof f === "string"),
    newTestFiles: value.newTestFiles === true,
  };
}

export function readTurn(store: Store, consumer: Consumer): TurnState {
  return parse(readAll(store, consumer.worktreeId)[slot(consumer)]);
}

/** Records `consumer`'s turn state; `null` forgets it (it starts idle). Call inside a transaction. */
export function writeTurn(store: Store, consumer: Consumer, state: TurnState | null): void {
  const registered = new Set(
    store.consumers.list(consumer.worktreeId).map((r) => slot(r.consumer)),
  );
  const all = readAll(store, consumer.worktreeId);
  const next: Turns = {};
  for (const [key, value] of Object.entries(all)) {
    if (registered.has(key)) next[key] = value;
  }
  if (state === null) delete next[slot(consumer)];
  else next[slot(consumer)] = state;
  if (Object.keys(next).length === 0 && Object.keys(all).length === 0) return;
  store.meta.set(turnMetaKey(consumer.worktreeId), JSON.stringify(next));
}

export function startTurn(store: Store, consumer: Consumer): void {
  writeTurn(store, consumer, IN_TURN);
}

/**
 * Idle, waiting for every test file pending now (a check pending, or a keyed
 * file queued or running) plus `undelivered`, the entries a delivery would
 * make now, so a result that landed while the turn was ending still wakes.
 */
export function endTurn(
  store: Store,
  consumer: Consumer,
  states: readonly KnownState[],
  undelivered: readonly DeltaEntry[],
): void {
  const keys = store.testFileKeys.list(consumer.worktreeId);
  const files = new Set<string>();
  for (const s of states) if (s.validity === "pending") files.add(testFileKeyOf(s.check));
  for (const k of keys) if (k.key !== null && k.pending !== null) files.add(testFileId(k.testFile));
  for (const e of undelivered) files.add(testFileKeyOf(e.check));
  const header = readHeader(store, consumer.worktreeId, states, keys);
  writeTurn(store, consumer, {
    turn: "idle",
    testFiles: [...files].sort(),
    newTestFiles: header.runnerPartPending === true,
  });
}

/**
 * Whether the idle waiter may deliver `entry`: its test file was pending when
 * the turn ended, or it is a check first observed while test files the runner
 * part was adding were not listed yet.
 */
export function waitedFor(state: TurnState, entry: DeltaEntry): boolean {
  if (state.turn !== "idle") return false;
  if (state.testFiles.includes(testFileKeyOf(entry.check))) return true;
  return state.newTestFiles && entry.kind !== "fail-retired" && entry.from === null;
}
