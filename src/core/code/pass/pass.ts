import type { ObjectFormat } from "../../hash/index.js";
import type { CodeFile, CodeLanguage } from "../../types/code.js";
import type {
  AbsolutePath,
  EpochMs,
  Policy,
  RelativePath,
  RevisionNumber,
  WorktreeId,
} from "../../types/index.js";
import type { CodeStore } from "../store/index.js";
import { countMissing, type Entry } from "./blobs.js";
import { languagesOf, oldBodies } from "./bodies.js";
import { cursorOf, readCursor, recountReason } from "./cursor.js";
import { type EditFile, type EditPlan, editEnd, judgedFiles } from "./edit.js";
import { dueRetries, type FailedCounts, readUncountable, spentFailure } from "./failed.js";
import {
  changesFrom,
  committedWithHeld,
  type Listing,
  listingMoved,
  nextRecord,
  readListing,
  writeListed,
} from "./listed.js";
import { quietPaths, workEntries } from "./plan.js";
import { partFiles, quietEnd } from "./stage.js";
import { stagedEditEnd } from "./stage-edit.js";
import { writeTooBigEdits } from "./too-big.js";
import type { Counter, PassReport, PassSource } from "./types.js";

export interface PassContext {
  readonly worktreeId: WorktreeId;
  readonly root: AbsolutePath;
  readonly format: ObjectFormat;
  readonly store: CodeStore;
  readonly source: PassSource;
  readonly counter: Counter;
  readonly complexity: Policy["complexity"];
  /** The policy was off earlier in this daemon's life: a first count whatever the cursor says. */
  readonly switchedOn: boolean;
  /** Paths whose bytes no longer had the stat cache's hash; read again at the next pass. */
  readonly retry: Set<RelativePath>;
  readonly now: () => EpochMs;
  readonly log: (text: string) => void;
  readonly sliceFiles?: number;
  /** Files a part of a staged pass reads, judges and stages; default `PART_FILES` (row 015-55). */
  readonly partFiles?: number;
  /** Whether `coverage.exclude` leaves `path` out: a function moved there keeps only complexity (D1). */
  readonly coverageExcluded?: (path: RelativePath) => boolean;
}

/**
 * One pass of spec 015 D4 over a worktree, `null` when nothing is due. With
 * the cursor's policy and counter, it follows the revisions since the
 * cursor: their changed paths, a retry, a failed count due again (row
 * 015-18), and a file a runner now lists. Else it rebuilds every state
 * with no transition (D5) and writes the recount record. Three writes: the
 * files rows, so status can say "counting, N of M"; the blobs no worktree
 * counted yet, in slices with a turn of the event loop between them; then
 * states, transitions, edits and the cursor in one transaction, so a hook
 * never reads half a revision. A first count or a recount stages its states
 * in parts before that transaction, which only adopts them (row 015-48);
 * so does an edit pass over more than one part, its transitions and edits
 * too (row 015-55). Before the last, a
 * revision that moved `HEAD` asks git which files are the committed ones
 * (015-19), and the last records them (015-38). D1 (row 015-52): a file
 * never counted that a revision after the listed one changed waits for its
 * listing, the removals of the pass wait with it (D2, review 0.1.315 B1),
 * a recount waits for it, and a pass runs at each listing; a counted file
 * that a runner now lists leaves quietly.
 */
export async function runPass(ctx: PassContext): Promise<PassReport | null> {
  const { store, source, worktreeId } = ctx;
  const latest = source.latestRevision();
  const listing = readListing(store, worktreeId, source, latest);
  const cursor = readCursor(store.meta, worktreeId);
  const current = cursorOf(latest, ctx.complexity, ctx.counter.version);
  const reason = ctx.switchedOn ? "first" : recountReason(cursor, current);
  const started = ctx.now();
  const failed = readUncountable(store.meta, worktreeId);
  const due = retriesDue(ctx, failed, started);
  const idle =
    reason === null && cursor?.revision === latest && ctx.retry.size === 0 && due.length === 0;
  if (idle && !listingMoved(listing)) return null;
  const since = reason === null && cursor !== null ? cursor.revision : null;
  const work = workEntries(ctx, since, latest, due, listing);
  if (work === null) return null;
  const { entries, held, waiting } = work;
  // The listing moved and left nothing to read: no pass, so no coverage step either.
  if (idle && entries.length === 0) {
    writeListed(store.meta, worktreeId, nextRecord(listing, since, held, []));
    return null;
  }
  ctx.retry.clear();
  // Row 015-55: an edit pass over more than one part reads its bodies in its parts.
  const parted = reason === null && entries.length > partFiles(ctx);
  const old = readOld(ctx, entries, reason === null, parted);
  // 015-39: each too-big file's last edit, kept apart from the rows a recount writes at its revision.
  // A held file's is older than the cursor (row 015-52).
  const edits =
    reason === "first" || cursor === null
      ? null
      : source.lastChanges(changesFrom(listing, cursor.revision), latest);

  store.transaction(() => {
    writeTooBigEdits(store, worktreeId, edits, entries);
    store.files.removeMany(
      worktreeId,
      entries.filter((e) => e.kind === "gone").map((e) => e.path),
    );
    store.files.upsertMany(worktreeId, filesRows(entries, ctx.counter.version, latest));
  });
  const quiet = reason !== null;
  const { counted, skipped, links } = await countMissing(ctx, entries, failed, {
    now: started,
    quiet,
    threshold: ctx.complexity.threshold,
    edits,
  });
  const end = { latest, reason, current, counted, failed };
  if (reason !== null) {
    const listed = nextRecord(listing, since, held, []);
    return quietEnd(ctx, { ...end, reason, listed }, entries, { skipped, links });
  }
  const seeds = quietPaths(entries, failed, listing);
  const files = judgedFiles(ctx, entries, { skipped, links, failed, seeds });
  const committed = await committedOf(ctx, { listing, since, latest, waiting }, entries, files);
  const plan: EditPlan = {
    files,
    paths: new Set(files.map((f) => f.path)),
    languages: old.languages,
    links,
    committed,
    seeds,
    held,
    entries: entries.length,
    listed: (deferred) => nextRecord(listing, since, held, deferred),
  };
  return parted ? stagedEditEnd(ctx, end, plan) : editEnd(ctx, end, plan, old.bodies);
}

/** 015-19: the paths of `files` whose blob git brought since the cursor; none at a first pass. */
async function committedOf(
  ctx: PassContext,
  {
    listing,
    since,
    latest,
    waiting,
  }: {
    readonly listing: Listing;
    readonly since: RevisionNumber | null;
    readonly latest: RevisionNumber;
    readonly waiting: ReadonlySet<RelativePath>;
  },
  entries: readonly Entry[],
  files: readonly EditFile[],
): Promise<Set<RelativePath>> {
  if (since === null) return new Set();
  const blobs = new Map(entries.map((e) => [e.path, e.kind === "gone" ? null : e.file.hash]));
  return committedWithHeld(
    ctx,
    { since, held: changesFrom(listing, since), upTo: latest },
    files.map((f) => ({ path: f.path, blob: blobs.get(f.path) ?? null })),
    waiting,
  );
}

/**
 * Row 015-18: the failed counts due again. A retry whose time came, and a
 * spent one whose blob a pass has counted since, as another worktree's may.
 */
function retriesDue(ctx: PassContext, failed: FailedCounts, now: EpochMs): RelativePath[] {
  const spent = [...failed].flatMap(([path, f]) => (f.retryAt === null ? [path] : []));
  const counted =
    spent.length === 0
      ? []
      : ctx.store.files
          .list(ctx.worktreeId, spent)
          .filter(
            (f) =>
              spentFailure(failed, f) !== null &&
              ctx.store.counts.get(f.blob, f.language, ctx.counter.version) !== null,
          );
  return [...dueRetries(failed, now), ...counted.map((f) => f.path)];
}

function filesRows(
  entries: readonly Entry[],
  counterVersion: number,
  revision: RevisionNumber,
): CodeFile[] {
  return entries.flatMap((e) =>
    e.kind === "gone"
      ? []
      : [
          {
            path: e.path,
            blob: e.file.hash,
            language: e.language,
            counterVersion,
            size: e.file.size,
            revision,
            ...(e.kind === "big" ? { tooBig: true } : {}),
          },
        ],
  );
}

/**
 * D2: before the pass writes the files rows, an edit pass's old body hashes;
 * one in parts reads them in its parts, so only its languages here. A quiet
 * pass reads neither.
 */
function readOld(ctx: PassContext, entries: readonly Entry[], edit: boolean, parted: boolean) {
  const paths = edit ? entries.map((e) => e.path) : [];
  const { store, worktreeId } = ctx;
  return {
    languages: parted
      ? languagesOf(store, worktreeId, paths)
      : new Map<RelativePath, CodeLanguage>(),
    bodies: parted
      ? new Map<string, string>()
      : oldBodies(store, worktreeId, paths, ctx.counter.version),
  };
}
