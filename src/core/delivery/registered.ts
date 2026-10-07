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
 * Where "your changes" start (task 001-91, D6): the revision a consumer
 * registered at. Task 001-94 (review wave 10b): a consumer still registered
 * keeps it (B1); one that left and comes back within `CONSUMER_EXPIRY_MS`
 * keeps it too, minus the revisions made while it was away (N4); and none is
 * recorded before the daemon's start scan, whose `start` revision holds
 * changes made while no daemon ran (B2).
 */

/** A revision range `(after, upTo]` that is not the consumer's: it was not registered. */
type Gap = readonly [after: RevisionNumber, upTo: RevisionNumber];

/** The revision `consumer`'s changes start after, and the ranges left out since. */
export interface Registration {
  readonly since: RevisionNumber;
  readonly gaps: readonly Gap[];
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
  return value.gaps.every(isGap) ? { since: value.since, gaps: value.gaps } : null;
}

/** A bare number when nothing is left out: the form 0.1.10 hooks read. */
const stored = (r: Registration): unknown => (r.gaps.length === 0 ? r.since : r);

/** `consumer`'s registration; `null` when none was recorded (0.1.9 or older, or before the start scan). */
export function registration(store: Store, consumer: Consumer): Registration | null {
  return toRegistration(readSlot(store, registeredMetaKey(consumer.worktreeId), consumer));
}

/** Whether the live daemon `alive` describes has finished its start scan. */
export function bootstrapped(store: Store, worktreeId: WorktreeId, alive: boolean): boolean {
  const daemon = store.worktrees.get(worktreeId)?.daemon ?? null;
  if (!alive || daemon === null) return false;
  const marker = store.meta.get(bootstrappedMetaKey(worktreeId));
  return marker !== null && Number(marker) === daemon.startedAt;
}

/**
 * Records where a newly registered `consumer`'s changes start: after
 * `revision`, or after its parked registration with `(leftAt, revision]`
 * left out. Before the start scan nothing is recorded. Call inside the
 * registration's transaction, and only for a consumer not registered before.
 */
export function tellRegistered(
  store: Store,
  consumer: Consumer,
  revision: RevisionNumber,
  { at, bootstrapped }: { readonly at: EpochMs; readonly bootstrapped: boolean },
): void {
  const parked = unpark(store, consumer, at);
  let next: Registration | null = null;
  if (bootstrapped) next = parked === null ? { since: revision, gaps: [] } : back(parked, revision);
  writeSlot(store, registeredMetaKey(consumer.worktreeId), consumer, next && stored(next));
}

/** A parked registration taken up at `revision`: what changed while it was away is left out. */
function back(parked: Parked, revision: RevisionNumber): Registration {
  const away: Gap = [parked.leftAt, revision];
  return {
    since: parked.since,
    gaps: revision > parked.leftAt ? [...parked.gaps, away] : parked.gaps,
  };
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

/** The paths revisions after `r.since` up to `revision` changed, gaps left out, in one query (N3). */
export function changedAfter(
  store: Store,
  worktreeId: WorktreeId,
  r: Registration,
  revision: RevisionNumber,
): ReadonlySet<RelativePath> {
  const paths = new Set<RelativePath>();
  for (const { number, changes } of store.revisions.range(worktreeId, r.since, revision)) {
    if (r.gaps.some(([after, upTo]) => number > after && number <= upTo)) continue;
    for (const change of changes) paths.add(change.path);
  }
  return paths;
}
