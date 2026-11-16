import { readPresence } from "../presence/decide.js";
import { headerView } from "../presence/views.js";
import { FEED_LATE_MS, lateOf } from "../status/feed-late.js";
import type { EpochMs, RevisionNumber, WorktreeId } from "../types/common.js";
import type { CaughtUp, Consumer, EditsLate } from "../types/delivery.js";
import type { TestFileRef } from "../types/keys.js";
import type { StatusHeader } from "../types/status.js";
import { type Store, worktreeMetaKey } from "../types/store.js";
import { pastBound } from "./late-timings.js";
import { readSlot, writeSlot } from "./slots.js";

/*
 * Row 005-93, parts 2 and 3 (design sections 2 and 4; `docs/vision.md` principle 1, "Silence
 * has to stay readable"): passing results stay silent, so an agent hears once when the results
 * for its own edits are late, and once when Squeal has caught up after that. At a tool boundary
 * only: never at Stop, never to an idle agent. A daemon that is stopped, stopping or absent
 * keeps its own liveness message, so no late message is said then.
 *
 * Each consumer keeps the revision its late message named, in its own slot beside its edit
 * state, until caught up is said or a failure delivered during the delay ends the late state.
 */

/** `meta` key of the consumers' late state: the revision each one's late message named. */
export function lateMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("editsLate", worktreeId);
}

function readLate(store: Store, consumer: Consumer): RevisionNumber | null {
  const value = readSlot(store, lateMetaKey(consumer.worktreeId), consumer);
  return typeof value === "number" ? value : null;
}

function writeLate(store: Store, consumer: Consumer, revision: RevisionNumber | null): void {
  writeSlot(store, lateMetaKey(consumer.worktreeId), consumer, revision);
}

/** Drops `consumer`'s late state. Call inside the unregistration's transaction. */
export function forgetLate(store: Store, consumer: Consumer): void {
  writeLate(store, consumer, null);
}

/** One file the consumer's edits affect with no result yet, and the revision of its edit. */
export interface OwedFile {
  readonly file: TestFileRef;
  readonly from: RevisionNumber;
}

/** What the consumer's edits since its count began read at the latest revision (`edits.ts`). */
export interface OwnRead {
  readonly since: RevisionNumber;
  readonly revision: RevisionNumber;
  /** Whether the latest revision's runner part is applied; until then its files have no key. */
  readonly refined: boolean;
  /** The test files the edits affect; empty while not `refined`. */
  readonly files: number;
  readonly owed: readonly OwedFile[];
  /** Of `files`, those with an unknown check: no result. */
  readonly unknown: number;
}

/** What a tool boundary says of lateness, and what saying it records. */
export interface LateNotes {
  /** Whether a late state was open before this boundary. */
  readonly open: boolean;
  readonly late?: EditsLate;
  readonly caughtUp?: CaughtUp;
  /** Records what was said; `failed`: the delivery carries a new failure, which ends the late state. */
  readonly tell: (failed: boolean) => void;
}

/** The test files the late line names, at most. */
const NAMED_MAX = 3;

/**
 * The late or caught-up notice at a tool boundary, `null` with none and no late state open.
 * `header` is read only when a late notice may go out (`quietFor`).
 */
export function lateNotes(
  store: Store,
  consumer: Consumer,
  own: OwnRead,
  at: EpochMs,
  header: () => StatusHeader,
): LateNotes | null {
  const open = readLate(store, consumer);
  // Nothing can be late without an edit since the count began.
  if (open === null && own.revision <= own.since) return null;
  const daemon = headerView(readPresence(store, consumer.worktreeId, at));
  if (open === null) {
    if (daemon.state !== "alive" || daemon.stopping !== undefined) return null;
    const late = lateNow(store, consumer.worktreeId, own, at, lateOf(daemon)?.since);
    if (late === null || quietFor(late, header())) return null;
    return {
      open: false,
      late: late.kind === "unlisted" ? withRunners(late, header()) : late,
      tell: (failed) => writeLate(store, consumer, failed ? null : late.revision),
    };
  }
  // Design section 2: caught up names the latest revision, refined, with no edit unread.
  const done = own.refined && own.owed.length === 0 && lateOf(daemon) === undefined;
  const caughtUp =
    done && own.files > 0
      ? { revision: own.revision, files: own.files, unknown: own.unknown }
      : undefined;
  return {
    open: true,
    ...(caughtUp === undefined ? {} : { caughtUp }),
    tell: (failed) => {
      if (failed || caughtUp !== undefined) writeLate(store, consumer, null);
    },
  };
}

/**
 * The late notice now, `null` when results are not late. `unread`: the change feed is late
 * (its own rule, `FEED_LATE_MS`) after the consumer edited. `owed`: the oldest owed edit is
 * older than the bound of the owed files (`pastBound`). `unlisted`: the latest revision's runner
 * part is not applied after the bound of no files, and at least the feed's own late time.
 */
function lateNow(
  store: Store,
  worktreeId: WorktreeId,
  own: OwnRead,
  at: EpochMs,
  unreadSince: EpochMs | undefined,
): EditsLate | null {
  const { revision } = own;
  if (unreadSince !== undefined) return { kind: "unread", revision, since: unreadSince };
  if (!own.refined) {
    const age = at - (store.revisions.get(worktreeId, revision)?.createdAt ?? at);
    return age > FEED_LATE_MS && pastBound(store, worktreeId, [], age)
      ? { kind: "unlisted", revision }
      : null;
  }
  const oldest = oldestOwed(store, worktreeId, own.owed);
  if (oldest === null) return null;
  const ageMs = at - oldest.createdAt;
  const files = own.owed.map((o) => o.file);
  if (!pastBound(store, worktreeId, files, ageMs)) return null;
  return {
    kind: "owed",
    revision,
    owed: own.owed.length,
    files: own.files,
    editRevision: oldest.from,
    ageMs,
    ...(files.length <= NAMED_MAX ? { named: files.map((f) => f.path) } : {}),
  };
}

/**
 * Whether `late` is not said beside what `header` says: a hold on validation says no test runs
 * until it ends (row 011-73); with no test group at `edit`, owed files wait for their groups'
 * moments (row 019-49), so they are not late.
 */
function quietFor(late: EditsLate, header: StatusHeader): boolean {
  if ((header.holds?.length ?? 0) > 0) return true;
  return late.kind === "owed" && header.noTestsAtEdit === true;
}

/** The unlisted notice with the runners that list a revision's files, as the header names them. */
function withRunners(
  late: Extract<EditsLate, { kind: "unlisted" }>,
  header: StatusHeader,
): EditsLate {
  const runners = header.listingRunners;
  return runners === undefined ? late : { ...late, runners };
}

/** The owed file whose edit is oldest, with its revision's time; `null` with none owed. */
function oldestOwed(
  store: Store,
  worktreeId: WorktreeId,
  owed: readonly OwedFile[],
): { readonly from: RevisionNumber; readonly createdAt: EpochMs } | null {
  if (owed.length === 0) return null;
  const from = Math.min(...owed.map((o) => o.from));
  const createdAt = store.revisions.get(worktreeId, from)?.createdAt;
  return createdAt === undefined ? null : { from, createdAt };
}
