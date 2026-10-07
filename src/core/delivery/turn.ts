import { isRecord } from "../fs/index.js";
import { testFileId } from "../keys/index.js";
import { readHeader, testFileKeyOf } from "../state/index.js";
import type {
  CheckKey,
  Consumer,
  DeltaEntry,
  KnownState,
  Store,
  TestFileKeyRecord,
  TurnState,
  WorktreeId,
} from "../types/index.js";
import { readSlot, writeSlot } from "./slots.js";

/*
 * Each consumer's turn state (task 001-85; lessons, defect 14), the part of
 * its view that says when the idle waiter may speak. A waiter message written
 * mid-turn lands only at the next tool boundary, after PostToolBatch has
 * delivered the same news with a newer header; so the waiter speaks only to
 * an idle agent, and only about the test files it stopped while waiting for.
 *
 * Like told liveness it lives in `meta` (`slots.ts`); a missing row reads
 * as the state a consumer starts in.
 */

/** `meta` key of a worktree's turn states. */
export function turnMetaKey(worktreeId: WorktreeId): string {
  return `turn:${worktreeId}`;
}

/** A consumer starts idle, waiting for nothing: the waiter is silent until a turn ends. */
export const START_IDLE: TurnState = { turn: "idle", testFiles: [], newTestFiles: false };

const IN_TURN: TurnState = { turn: "in-turn" };

function parse(value: unknown): TurnState {
  if (!isRecord(value)) return START_IDLE;
  if (value.turn === "in-turn") return IN_TURN;
  const files = Array.isArray(value.testFiles) ? value.testFiles : [];
  const keys = isRecord(value.keys)
    ? Object.entries(value.keys).filter(
        (e): e is [string, CheckKey | null] => typeof e[1] === "string" || e[1] === null,
      )
    : null;
  return {
    turn: "idle",
    testFiles: files.filter((f): f is string => typeof f === "string"),
    newTestFiles: value.newTestFiles === true,
    ...(keys === null ? {} : { keys: Object.fromEntries(keys) }),
    ...(typeof value.revision === "number" ? { revision: value.revision } : {}),
  };
}

export function readTurn(store: Store, consumer: Consumer): TurnState {
  return parse(readSlot(store, turnMetaKey(consumer.worktreeId), consumer));
}

/** Records `consumer`'s turn state; `null` forgets it (it starts idle). Call inside a transaction. */
export function writeTurn(store: Store, consumer: Consumer, state: TurnState | null): void {
  writeSlot(store, turnMetaKey(consumer.worktreeId), consumer, state);
}

export function startTurn(store: Store, consumer: Consumer): void {
  writeTurn(store, consumer, IN_TURN);
}

/**
 * Puts a registered consumer left idle in a turn (task 001-93): a tool call
 * means the agent works, whatever the last Stop said, because another Stop
 * hook can continue a turn Squeal's silent Stop ended (lessons, defect 14
 * after wave 10). Reads first, so a consumer already in a turn takes no write
 * lock.
 */
export function resumeTurn(store: Store, consumer: Consumer): void {
  if (readTurn(store, consumer).turn !== "idle") return;
  store.transaction(() => {
    if (store.consumers.get(consumer) === null) return;
    if (readTurn(store, consumer).turn === "idle") startTurn(store, consumer);
  });
}

type Idle = Extract<TurnState, { turn: "idle" }>;

/** Each listed test file's current key, by `testFileId`. */
export type CurrentKeys = ReadonlyMap<string, CheckKey | null>;

export function currentKeys(keys: readonly TestFileKeyRecord[]): CurrentKeys {
  return new Map(keys.map((k) => [testFileId(k.testFile), k.key]));
}

/**
 * Idle, waiting for every test file pending now (a check pending, or a keyed
 * file queued or running) plus `undelivered`, the entries a delivery would
 * make now, so a result that landed while the turn was ending still wakes.
 * Each file is waited for at its current key, and new test files up to the
 * current revision (task 001-89, review wave 10 S3).
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
  const current = currentKeys(keys);
  const testFiles = [...files].sort();
  writeTurn(store, consumer, {
    turn: "idle",
    testFiles,
    newTestFiles: header.runnerPartPending === true,
    keys: Object.fromEntries(testFiles.map((f) => [f, current.get(f) ?? null])),
    revision: header.revision,
  });
}

/** Whether `file` is still at the key it was pending at; a file recorded without one always is. */
function atKey(state: Idle, file: string, keys: CurrentKeys): boolean {
  const recorded = state.keys?.[file];
  return recorded === undefined || keys.get(file) === recorded;
}

/**
 * Whether the idle waiter may deliver `entry`: its test file was pending when
 * the turn ended and is still at the key it was pending at, or it is a check
 * first observed, at or before the revision the turn ended at, while test
 * files the runner part was adding were not listed yet. A result of a later
 * key comes from an edit made after the turn, so it waits for the next prompt.
 */
export function waitedFor(state: TurnState, entry: DeltaEntry, keys: CurrentKeys): boolean {
  if (state.turn !== "idle") return false;
  const file = testFileKeyOf(entry.check);
  if (state.testFiles.includes(file)) return atKey(state, file, keys);
  return (
    state.newTestFiles &&
    entry.kind !== "fail-retired" &&
    entry.from === null &&
    (state.revision === undefined || entry.observedAt <= state.revision)
  );
}

/**
 * `state` without the test files whose result is no longer owed (review wave
 * 10, S3): a file moved to another key, or one whose result at its key has
 * landed (no check of it pending and the file not queued or running), told
 * or not. `null` when every file is still owed. Without this, a later result
 * of a file whose own result was quiet would wake the agent.
 */
export function trimmed(
  state: TurnState,
  states: readonly KnownState[],
  keys: readonly TestFileKeyRecord[],
): Idle | null {
  if (state.turn !== "idle" || state.testFiles.length === 0) return null;
  const current = currentKeys(keys);
  const pending = new Set<string>();
  for (const s of states) if (s.validity === "pending") pending.add(testFileKeyOf(s.check));
  for (const k of keys) if (k.pending !== null) pending.add(testFileId(k.testFile));
  const owed = state.testFiles.filter((f) => pending.has(f) && atKey(state, f, current));
  if (owed.length === state.testFiles.length) return null;
  const { keys: recorded, ...rest } = state;
  const kept = Object.entries(recorded ?? {}).filter(([f]) => owed.includes(f));
  return {
    ...rest,
    testFiles: owed,
    ...(recorded === undefined ? {} : { keys: Object.fromEntries(kept) }),
  };
}
