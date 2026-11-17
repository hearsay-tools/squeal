import { isRecord } from "../fs/json.js";
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
 * Row 005-97 (`tasks/005-93/design.md` sections 2 and 4; `docs/vision.md` principle 1, "Silence
 * has to stay readable"): passes stay silent, so an agent hears once when the results for its
 * own edits are late, and once when Squeal has caught up after that. At a tool boundary only:
 * never at Stop, never to an idle agent. A daemon that is stopped, stopping or absent keeps its
 * own liveness message, so no late message is said then.
 *
 * Each consumer keeps the revision its late message named, in its own slot beside its edit
 * state, until caught up is said or a failure delivered during the delay ends the late state.
 * While it is open the own count does not start again (`edits.ts`), so caught up counts every
 * file the late message counted. The paths are tabled in `tasks/005-97/notes.md`.
 */

/** `meta` key of the consumers' late state: the revision each one's late message named. */
export function lateMetaKey(worktreeId: WorktreeId): string {
  return worktreeMetaKey("editsLate", worktreeId);
}

/**
 * A consumer's slot: the revision its open late message named, or `{ ended }`, the latest
 * revision when a delivered failure ended it. Edits at or before `ended` are not late again.
 */
type LateSlot = RevisionNumber | { readonly ended: RevisionNumber } | null;

function readSlotOf(store: Store, consumer: Consumer): LateSlot {
  const value = readSlot(store, lateMetaKey(consumer.worktreeId), consumer);
  if (typeof value === "number") return value;
  return isRecord(value) && typeof value.ended === "number" ? { ended: value.ended } : null;
}

/** The revision a failure ended the late state at; 0 with none. */
const endedAt = (slot: LateSlot) => (slot === null || typeof slot === "number" ? 0 : slot.ended);

function readLate(store: Store, consumer: Consumer): RevisionNumber | null {
  const slot = readSlotOf(store, consumer);
  return typeof slot === "number" ? slot : null;
}

function writeLate(store: Store, consumer: Consumer, slot: LateSlot): void {
  writeSlot(store, lateMetaKey(consumer.worktreeId), consumer, slot);
}

/** Drops `consumer`'s late state. Call inside the unregistration's transaction. */
export function forgetLate(store: Store, consumer: Consumer): void {
  writeLate(store, consumer, null);
}

/** Whether `consumer` was told its results are late and not yet that Squeal caught up. */
export function lateIsOpen(store: Store, consumer: Consumer): boolean {
  return readLate(store, consumer) !== null;
}

/**
 * Review 0.1.530 B1: a delivered new failure ends the late state on every path (a tool
 * boundary, Stop, a peek, the turn start, the idle waiter), whether or not that path may say
 * late or caught up: no caught-up follows it. Call inside the delivery's transaction.
 */
export function endLate(store: Store, consumer: Consumer): void {
  if (!lateIsOpen(store, consumer)) return;
  // The files still owed then are not said late again; a later edit's are.
  writeLate(store, consumer, { ended: store.revisions.latest(consumer.worktreeId)?.number ?? 0 });
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
  /** Records what was said: the late revision, or caught up, which ends the late state. */
  readonly tell: () => void;
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
  const slot = readSlotOf(store, consumer);
  const open = typeof slot === "number" ? slot : null;
  // Nothing can be late without an edit since the count began, and since a failure ended one.
  const after = Math.max(own.since, endedAt(slot));
  if (open === null && own.revision <= after) return null;
  const daemon = headerView(readPresence(store, consumer.worktreeId, at));
  if (open === null) {
    if (daemon.state !== "alive" || daemon.stopping !== undefined) return null;
    const late = lateNow(store, consumer.worktreeId, { ...own, after }, at, lateOf(daemon)?.since);
    if (late === null || quietFor(header())) return null;
    return {
      open: false,
      late: late.kind === "unlisted" ? withRunners(late, header()) : late,
      tell: () => writeLate(store, consumer, late.revision),
    };
  }
  // Design section 2: caught up names the latest revision, refined, with no edit unread.
  const done = own.refined && own.owed.length === 0 && lateOf(daemon) === undefined;
  if (done && own.files === 0) {
    // Review 0.1.530: a late state with nothing to count (its revision affects no test file)
    // ends here, with nothing to say.
    writeLate(store, consumer, null);
    return null;
  }
  const caughtUp = done
    ? { revision: own.revision, files: own.files, unknown: own.unknown }
    : undefined;
  return {
    open: true,
    ...(caughtUp === undefined ? {} : { caughtUp }),
    tell: () => {
      if (caughtUp !== undefined) writeLate(store, consumer, null);
    },
  };
}

/**
 * The late notice now, `null` when results are not late. `unread`: the change feed is late
 * (its own rule, `FEED_LATE_MS`) after the consumer edited. `owed`: the oldest owed edit after
 * `after` is older than the bound of those files (`pastBound`); the line counts every owed file.
 * `unlisted`: the latest revision's runner part is not applied after the bound of no files, and
 * at least the feed's own late time.
 */
function lateNow(
  store: Store,
  worktreeId: WorktreeId,
  own: OwnRead & { readonly after: RevisionNumber },
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
  const owed = own.owed.filter((o) => o.from > own.after);
  const oldest = oldestOwed(store, worktreeId, owed);
  if (oldest === null) return null;
  const ageMs = at - oldest.createdAt;
  const due = owed.map((o) => o.file);
  if (!pastBound(store, worktreeId, due, ageMs)) return null;
  const files = own.owed.map((o) => o.file);
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
 * Whether a late notice is not said beside what `header` says: a hold on validation says no
 * test runs until it ends (row 011-73); with no test group at `edit`, the files wait for their
 * groups' moments (row 019-49), so no form of it is said (review 0.1.530 B5). Row 005-114
 * (review 0.1.554): before the worktree's test files are listed, the header says Squeal is still
 * starting, with its path wait (`noResultsText`); a late notice would say a second one.
 */
function quietFor(header: StatusHeader): boolean {
  return (
    (header.holds?.length ?? 0) > 0 ||
    header.noTestsAtEdit === true ||
    header.testFilesListed === false
  );
}

/**
 * Whether a late message may say the late-feed and unlisted facts at `header`: a live daemon
 * that is not stopping, and no hold and a test group at `edit`. While it may and files are owed,
 * the news header leaves those sentences to the late message (`header.ts`); where it may not,
 * the header keeps them, so no delay goes unsaid.
 */
export function lateMaySay(header: StatusHeader): boolean {
  const { daemon } = header;
  return daemon?.state === "alive" && daemon.stopping === undefined && !quietFor(header);
}

/**
 * Row 005-114: whether the late line carries the delay sentence the news header would say, so
 * the header leaves it out. While files are owed, or in the message that says late, and a late
 * message may say it at `header`; one message never states the delay twice.
 */
export function lateCarriesDelay(
  header: StatusHeader,
  owed: number,
  late: EditsLate | undefined,
): boolean {
  return (owed > 0 || late !== undefined) && lateMaySay(header);
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
