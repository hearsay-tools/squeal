import { isRecord } from "../fs/index.js";
import {
  bootstrappedMetaKey,
  CONSUMER_EXPIRY_MS,
  type Consumer,
  type EpochMs,
  type RelativePath,
  type RevisionNumber,
  type Store,
  type WorktreeId,
} from "../types/index.js";
import { readAll, readSlot, slot, writeSlot } from "./slots.js";

/*
 * Where the changes a consumer is told about start (task 001-91, D6): the revision a consumer
 * registered at. Task 001-94 (review wave 10b): a consumer still registered
 * keeps it (B1); one that left and comes back within `CONSUMER_EXPIRY_MS`
 * keeps it too, minus the revisions made while it was away (N4). Task 001-96
 * (review wave 10c B1, S1): a `start` revision is never the agent's
 * (`changedAfter`), and "none of the files changed here" needs the daemon that was
 * live and past its start scan at registration (`seesEveryChange`).
 */

/** A revision range `(after, upTo]` that is not the consumer's: it was not registered. */
type Gap = readonly [after: RevisionNumber, upTo: RevisionNumber];

/** The revision `consumer`'s changes start after, and the ranges left out since. */
export interface Registration {
  readonly since: RevisionNumber;
  readonly gaps: readonly Gap[];
  /**
   * The `startedAt` of the live daemon whose bootstrap marker was written
   * when the consumer registered; absent when none was.
   */
  readonly scanned?: EpochMs;
}

/** A registration of a consumer that left, kept until `leftTime + CONSUMER_EXPIRY_MS`. */
interface Parked extends Registration {
  readonly leftAt: RevisionNumber;
  readonly leftTime: EpochMs;
}

/** `meta` key of a worktree's registration revisions. */
export function registeredMetaKey(worktreeId: WorktreeId): string {
  return `revision-registered:${worktreeId}`;
}

/** `meta` key of the registrations of consumers that left. */
function parkedMetaKey(worktreeId: WorktreeId): string {
  return `revision-registered-left:${worktreeId}`;
}

const isNumber = (value: unknown): value is number => typeof value === "number";
const isGap = (value: unknown): value is Gap =>
  Array.isArray(value) && value.length === 2 && value.every(isNumber);

function toRegistration(value: unknown): Registration | null {
  if (isNumber(value)) return { since: value, gaps: [] };
  if (!isRecord(value) || !isNumber(value.since) || !Array.isArray(value.gaps)) return null;
  if (!value.gaps.every(isGap)) return null;
  const r = { since: value.since, gaps: value.gaps };
  return isNumber(value.scanned) ? { ...r, scanned: value.scanned } : r;
}

/** A bare number when nothing else is kept: the form 0.1.10 hooks read. */
const stored = (r: Registration): unknown =>
  r.gaps.length === 0 && r.scanned === undefined ? r.since : r;

/** `consumer`'s registration; `null` when none was recorded (0.1.9 or older, or 0.1.12 before the start scan). */
export function registration(store: Store, consumer: Consumer): Registration | null {
  return toRegistration(readSlot(store, registeredMetaKey(consumer.worktreeId), consumer));
}

/** The `startedAt` of the live daemon when it has written its bootstrap marker, else `null`. */
export function scannedDaemon(
  store: Store,
  worktreeId: WorktreeId,
  alive: boolean,
): EpochMs | null {
  const daemon = store.worktrees.get(worktreeId)?.daemon ?? null;
  if (!alive || daemon === null) return null;
  const marker = store.meta.get(bootstrappedMetaKey(worktreeId));
  return marker !== null && Number(marker) === daemon.startedAt ? daemon.startedAt : null;
}

/**
 * Whether every change since `r` registered is in a revision. A daemon's
 * start scan hashes the files it has no hash for without a revision (a new
 * worktree's every file, a file created while no daemon ran), so an agent
 * edit made before a start scan after registration can be in none. True only
 * while the daemon that had finished its start scan at registration is the
 * one recorded; "none of the files changed here" needs it (task 001-96).
 */
export function seesEveryChange(store: Store, worktreeId: WorktreeId, r: Registration): boolean {
  const daemon = store.worktrees.get(worktreeId)?.daemon ?? null;
  return r.scanned !== undefined && daemon?.startedAt === r.scanned;
}

/**
 * Records where a newly registered `consumer`'s changes start: after
 * `revision`, or after its parked registration with `(leftAt, revision]`
 * left out, with `scanned` (`scannedDaemon`). Call inside the registration's
 * transaction, and only for a consumer not registered before.
 */
export function tellRegistered(
  store: Store,
  consumer: Consumer,
  revision: RevisionNumber,
  { at, scanned }: { readonly at: EpochMs; readonly scanned: EpochMs | null },
): void {
  const parked = unpark(store, consumer, at);
  const next = parked === null ? fresh(revision, scanned) : back(parked, revision, scanned);
  writeSlot(store, registeredMetaKey(consumer.worktreeId), consumer, stored(next));
}

function fresh(since: RevisionNumber, scanned: EpochMs | null): Registration {
  return scanned === null ? { since, gaps: [] } : { since, gaps: [], scanned };
}

/**
 * A parked registration taken up at `revision`: what changed while it was
 * away is left out. It keeps `scanned` only when the same daemon is live
 * and scanned now: another one's start scan may have seeded an edit.
 */
function back(parked: Parked, revision: RevisionNumber, scanned: EpochMs | null): Registration {
  const away: Gap = [parked.leftAt, revision];
  const r = {
    since: parked.since,
    gaps: revision > parked.leftAt ? [...parked.gaps, away] : parked.gaps,
  };
  return scanned !== null && parked.scanned === scanned ? { ...r, scanned } : r;
}

/**
 * Forgets `consumer`'s registration and parks it, with the revision it left
 * at, for a registration of the same session and agent to take up (N4).
 * Call inside the unregistration's transaction.
 */
export function park(store: Store, consumer: Consumer, at: EpochMs): void {
  const key = registeredMetaKey(consumer.worktreeId);
  const current = registration(store, consumer);
  if (readSlot(store, key, consumer) !== undefined) writeSlot(store, key, consumer, null);
  if (current === null) return;
  const leftAt = store.revisions.latest(consumer.worktreeId)?.number ?? 0;
  writeParked(store, consumer, at, { ...current, leftAt, leftTime: at });
}

/** Takes `consumer`'s parked registration out of the row; `null` when none is kept. */
function unpark(store: Store, consumer: Consumer, at: EpochMs): Parked | null {
  const value = readAll(store, parkedMetaKey(consumer.worktreeId))[slot(consumer)];
  if (value === undefined) return null;
  writeParked(store, consumer, at, null);
  const r = toRegistration(value);
  if (r === null || !isRecord(value) || !isNumber(value.leftAt) || !isNumber(value.leftTime)) {
    return null;
  }
  return value.leftTime < at - CONSUMER_EXPIRY_MS
    ? null
    : { ...r, leftAt: value.leftAt, leftTime: value.leftTime };
}

/** Writes `consumer`'s parked value, `null` to drop it; drops every entry older than the expiry. */
function writeParked(store: Store, consumer: Consumer, at: EpochMs, value: Parked | null): void {
  const key = parkedMetaKey(consumer.worktreeId);
  const all = readAll(store, key);
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(all)) {
    if (isRecord(v) && isNumber(v.leftTime) && v.leftTime >= at - CONSUMER_EXPIRY_MS) next[k] = v;
  }
  if (value === null) delete next[slot(consumer)];
  else next[slot(consumer)] = value;
  if (Object.keys(next).length === 0 && Object.keys(all).length === 0) return;
  store.meta.set(key, JSON.stringify(next));
}

/**
 * What revisions after `r.since` up to `revision` changed, gaps left out, in
 * one query (N3). `changed` holds the paths of revisions the daemon saw as
 * they happened. `unknown` holds the paths of `start` revisions: a start
 * scan records what changed while no daemon ran, and absorbs an edit made
 * before it ran, so whose they are is not known (task 001-96, review wave
 * 10c B1). That includes `r.since` when it is one and the registration has
 * no `scanned`: only a registration made before the scan can have an edit
 * in it (task 001-99, review wave 10d S1).
 */
export function changedAfter(
  store: Store,
  worktreeId: WorktreeId,
  r: Registration,
  revision: RevisionNumber,
): Changed {
  const changed = new Set<RelativePath>();
  const unknown = new Set<RelativePath>();
  for (const { number, trigger, changes } of store.revisions.range(
    worktreeId,
    Math.max(r.since - 1, 0),
    revision,
  )) {
    if (r.gaps.some(([after, upTo]) => number > after && number <= upTo)) continue;
    const start = trigger === "start";
    if (number === r.since && (!start || r.scanned !== undefined)) continue;
    for (const change of changes) (start ? unknown : changed).add(change.path);
  }
  return { changed, unknown };
}

/** `changedAfter`'s answer. */
export interface Changed {
  readonly changed: ReadonlySet<RelativePath>;
  readonly unknown: ReadonlySet<RelativePath>;
}
