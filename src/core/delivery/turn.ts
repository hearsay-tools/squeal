import { isRecord } from "../fs/index.js";
import { testFileId } from "../keys/index.js";
import { checkIdentity, readHeader, testFileKeyOf } from "../state/index.js";
import {
  type CheckKey,
  type Consumer,
  type DeltaEntry,
  type EpochMs,
  type KnownState,
  type StopHandoff,
  type Store,
  type TestFileKeyRecord,
  type TestFileRef,
  type TurnState,
  type ViewEntry,
  type WorktreeId,
  worktreeMetaKey,
} from "../types/index.js";
import { isLeaving, markLeaving } from "./leaving.js";
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
  return worktreeMetaKey("turn", worktreeId);
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
    ...withHandoff(value.handoff),
  };
}

function withHandoff(value: unknown): { handoff?: StopHandoff } {
  return isRecord(value) && typeof value.at === "number" ? { handoff: { at: value.at } } : {};
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
 * after wave 10). In the same transaction it clears the consumer's leaving
 * mark, idle or not, since a subagent that calls a tool goes on (review
 * 001-423, B1). Reads first, so a consumer already in a turn and not marked
 * takes no write lock.
 */
export function resumeTurn(store: Store, consumer: Consumer): void {
  if (readTurn(store, consumer).turn !== "idle" && !isLeaving(store, consumer)) return;
  store.transaction(() => {
    if (store.consumers.get(consumer) === null) return;
    if (readTurn(store, consumer).turn === "idle") startTurn(store, consumer);
    markLeaving(store, consumer, null);
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
 * current revision (task 001-89, review wave 10 S3). With `handoffAt`, it
 * records the Stop's `handoff` to the waiting entry (task 001-295).
 */
export function endTurn(
  store: Store,
  consumer: Consumer,
  states: readonly KnownState[],
  undelivered: readonly DeltaEntry[],
  handoffAt: EpochMs | null = null,
): void {
  const keys = store.testFileKeys.list(consumer.worktreeId);
  const files = new Set<string>();
  for (const s of states) if (s.validity === "pending") files.add(testFileKeyOf(s.check));
  for (const k of keys) if (k.key !== null && k.pending !== null) files.add(testFileId(k.testFile));
  for (const e of undelivered) files.add(testFileKeyOf(e.check));
  const header = readHeader(store, consumer.worktreeId, states, keys);
  const current = currentKeys(keys);
  const testFiles = [...files].sort();
  const owed = Object.fromEntries(testFiles.map((f) => [f, current.get(f) ?? null]));
  const newTestFiles = header.runnerPartPending === true;
  const { revision } = header;
  writeTurn(store, consumer, {
    turn: "idle",
    testFiles,
    newTestFiles,
    keys: owed,
    revision,
    ...(handoffAt === null ? {} : { handoff: { at: handoffAt } }),
  });
}

/** Whether `file` is still at the key it was pending at; a file recorded without one always is. */
function atKey(state: Idle, file: string, keys: CurrentKeys): boolean {
  const recorded = state.keys?.[file];
  return recorded === undefined || keys.get(file) === recorded;
}

/** The states and view entries an idle consumer's waiter can deliver or trim. */
export interface OwedScope {
  readonly states: readonly KnownState[];
  readonly view: readonly ViewEntry[];
  readonly keys: readonly TestFileKeyRecord[];
}

/**
 * Task 001-414: what the waiter's poll reads, bounded by what the turn owes,
 * since on a shared store other daemons commit every few seconds and the
 * change marker moves on most polls. `"nothing"` in a turn, or idle with no
 * test file owed and no new one awaited: no entry can pass `waitedFor` and
 * `trimmed` has nothing to trim. Otherwise the owed files' states, view
 * entries and keys, and while new test files are awaited the states never
 * told (`waitedFor` takes only entries from nothing, and keys only of owed
 * files). A delta planned from these
 * and restricted to `waitedFor`, and the trim, are those of the whole worktree.
 */
export function owedScope(store: Store, consumer: Consumer): OwedScope | "nothing" {
  const state = readTurn(store, consumer);
  if (state.turn !== "idle" || (state.testFiles.length === 0 && !state.newTestFiles)) {
    return "nothing";
  }
  const files = state.testFiles.map(fromTestFileId);
  const owed = files.length === 0 ? [] : store.knownStates.list(consumer.worktreeId, files);
  const untold = state.newTestFiles ? store.knownStates.untold(consumer) : [];
  const seen = new Set(owed.map((s) => checkIdentity(s.check)));
  return {
    states: [...owed, ...untold.filter((s) => !seen.has(checkIdentity(s.check)))],
    view: files.length === 0 ? [] : store.views.list(consumer, files),
    keys: files.length === 0 ? [] : store.testFileKeys.list(consumer.worktreeId, files),
  };
}

/** The test file a `testFileId` names. */
function fromTestFileId(id: string): TestFileRef {
  const at = id.indexOf("\0");
  return { project: id.slice(0, at), path: id.slice(at + 1) };
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
