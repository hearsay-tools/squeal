import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { blobHash, type ObjectFormat } from "../../hash/index.js";
import { CAPACITY_RECHECK_MS, WAIT_FOR_CAPACITY } from "../../scheduler/capacity.js";
import type {
  AbsolutePath,
  EpochMs,
  RelativePath,
  RevisionNumber,
  WorktreeId,
} from "../../types/index.js";
import type { LintStore } from "../store/types.js";
import type { Keyer } from "./keyer.js";
import { type LintedPart, lintFiles, type PartFile, unknownPart } from "./lint-part.js";
import { readProgram, readQuiet, writeQuiet } from "./records.js";
import type { ProviderSession } from "./session.js";
import type { LintCapacity, LintSource } from "./types.js";

/** Spec 017 D7 step 4: files a part lints at most. */
export const PART_FILES = 16;

/**
 * Whose part it is, for its slot of the user's pool (011 C10, agreed
 * 2026-10-26): `edit`, an edit's own changed files, runs as an edit's tier
 * does; `backlog`, a first or config keying's files, and `stale`, the
 * whole-program files re-linted when idle (D5), take a backlog lease.
 */
type PartKind = "edit" | "backlog" | "stale";

export interface PartsContext {
  readonly worktreeId: WorktreeId;
  readonly root: AbsolutePath;
  readonly format: ObjectFormat;
  readonly store: LintStore;
  readonly source: LintSource;
  readonly session: ProviderSession;
  readonly latest: RevisionNumber;
  readonly now: () => EpochMs;
  /** The scheduler's pool; `null` with none, and lint runs ungranted. */
  readonly capacity: () => LintCapacity | null;
  /** Milliseconds until stale files may lint: 004's slow trigger (D5); 0 now. */
  readonly idleIn: () => number;
  /** A nudge came: the pass ends after its part, so a new revision is keyed first. */
  readonly interrupted: () => boolean;
  /** Paths whose parts go first (D7 step 4). */
  readonly first: ReadonlySet<RelativePath>;
  /** Changed program files not fed to the worker yet; a part's lint call takes them (D5). */
  readonly feed: Set<RelativePath>;
}

/** What the parts did, and when the pass should look again. */
export interface PartsEnd extends LintedPart {
  /** The pass's one timer: capacity refused, or stale files wait for idle. */
  readonly wakeAt: EpochMs | null;
}

/**
 * D7 step 4: the pending files in parts of at most `PART_FILES`. An edit's
 * changed program files come first, fed to the worker in its lint calls
 * (017-04's contract), then its other changed files, then a first or config
 * keying's files, then stale files once idle. Each part holds its slot only
 * while it reads, keys and lints (011 C10 as agreed): `running(1)` for an
 * edit's part, a backlog lease for the others. A refused lease ends the
 * pass with a wake at `CAPACITY_RECHECK_MS`, stale files that wait for idle
 * with a wake when it may come. A lint report that grew the closure or the
 * program ends it too: the next pass keys again.
 */
export async function lintParts(ctx: PartsContext, keyer: Keyer): Promise<PartsEnd> {
  const done = {
    linted: 0,
    hits: 0,
    transitions: 0,
    off: null as string | null,
    grew: false,
    spoiled: false,
  };
  const end = (wakeAt: EpochMs | null): PartsEnd => ({ ...done, wakeAt });
  const quiet = readQuiet(ctx.store.meta, ctx.worktreeId);
  try {
    return await partsOf(ctx, keyer, readQueue(ctx, quiet), done, end);
  } finally {
    writeQuiet(ctx.store.meta, ctx.worktreeId, quiet);
  }
}

/** The parts in turn, until none is left or the pass must end. */
async function partsOf(
  ctx: PartsContext,
  keyer: Keyer,
  first: Queue,
  done: {
    linted: number;
    hits: number;
    transitions: number;
    off: string | null;
    grew: boolean;
    spoiled: boolean;
  },
  end: (wakeAt: EpochMs | null) => PartsEnd,
): Promise<PartsEnd> {
  let queue = first;
  for (;;) {
    const part = nextPart(ctx, queue);
    if (part === null) return end(null);
    if (part.kind === "stale") {
      const wait = ctx.idleIn();
      if (wait > 0) return end(ctx.now() + wait);
    }
    const slot = takeSlot(ctx.capacity(), part.kind);
    if (slot === WAIT_FOR_CAPACITY) return end(ctx.now() + CAPACITY_RECHECK_MS);
    try {
      const files = await readTexts(ctx, keyer, part.paths);
      const did =
        "unknown" in files
          ? unknownPart(ctx, part.paths, files.unknown)
          : await lintFiles(ctx, keyer, files, part.judged, queue.quiet);
      done.linted += did.linted;
      done.hits += did.hits;
      done.transitions += did.transitions;
      done.off = did.off;
      done.grew = did.grew;
      done.spoiled ||= did.spoiled;
    } finally {
      slot();
    }
    if (done.off !== null || done.grew || ctx.interrupted()) return end(null);
    // A part fed before every changed program file left its misses pending: read them again.
    queue = part.judged ? queue.without(part.paths) : readQueue(ctx, queue.quiet);
    await nextTurn();
  }
}

interface Part {
  readonly kind: PartKind;
  readonly paths: RelativePath[];
  /** Every changed program file is fed by the end of this part's call: its results count. */
  readonly judged: boolean;
}

/**
 * The files waiting to lint, read once per pass: this worktree's states have
 * no other writer. A part's files leave it, linted, unknown or skipped; one
 * skipped waits for the revision that moved its bytes.
 */
class Queue {
  constructor(
    readonly edit: readonly RelativePath[],
    readonly backlog: readonly RelativePath[],
    readonly stale: readonly RelativePath[],
    /** The quiet set, kept in memory while the pass lints and written when it ends. */
    readonly quiet: Set<RelativePath>,
  ) {}

  without(paths: readonly RelativePath[]): Queue {
    const gone = new Set(paths);
    const keep = (list: readonly RelativePath[]) => list.filter((p) => !gone.has(p));
    return new Queue(keep(this.edit), keep(this.backlog), keep(this.stale), this.quiet);
  }
}

/**
 * The pending files, an edit's apart from a first or config keying's, and
 * the stale ones. The quiet set keeps only files still `pending` or
 * `unknown`: one a pass that ended early linted leaves it here.
 */
function readQueue(ctx: PartsContext, quiet: Set<RelativePath>): Queue {
  const { store, worktreeId } = ctx;
  const pending = store.states.list(worktreeId, { outcome: "pending" }).map((s) => s.check.path);
  const unknown = store.states.list(worktreeId, { outcome: "unknown" }).map((s) => s.check.path);
  const waiting = new Set([...pending, ...unknown]);
  for (const path of quiet) if (!waiting.has(path)) quiet.delete(path);
  // Stale files are whole-program files (D5): only those states are read.
  const whole = readProgram(store.meta, worktreeId).files;
  const stale =
    whole.length === 0
      ? []
      : store.states
          .list(worktreeId, { paths: whole })
          .filter((s) => s.stale && s.outcome !== "pending")
          .map((s) => s.check.path);
  return new Queue(
    firstOf(
      ctx,
      pending.filter((p) => !quiet.has(p)),
    ),
    firstOf(
      ctx,
      pending.filter((p) => quiet.has(p)),
    ),
    firstOf(ctx, stale),
    quiet,
  );
}

/** The next part's files: the feed and an edit's files, then the backlog, then stale ones. */
function nextPart(ctx: PartsContext, queue: Queue): Part | null {
  const feed = [...ctx.feed].sort();
  if (feed.length > 0 || queue.edit.length > 0) {
    const edit = queue.edit.filter((p) => !ctx.feed.has(p));
    const paths = [...feed, ...edit.slice(0, PART_FILES)].slice(0, PART_FILES);
    return { kind: "edit", paths, judged: feed.length <= PART_FILES };
  }
  if (queue.backlog.length > 0) {
    return { kind: "backlog", paths: queue.backlog.slice(0, PART_FILES), judged: true };
  }
  if (queue.stale.length > 0) {
    return { kind: "stale", paths: queue.stale.slice(0, PART_FILES), judged: true };
  }
  return null;
}

/** `paths` sorted, those of `ctx.first` first. */
function firstOf(ctx: PartsContext, paths: readonly RelativePath[]): RelativePath[] {
  const sorted = [...paths].sort();
  return [...sorted.filter((p) => ctx.first.has(p)), ...sorted.filter((p) => !ctx.first.has(p))];
}

/**
 * The part's slot (agreed with 011, 2026-10-26): an edit's part runs one
 * worker wide without a grant; another takes one backlog permit of the slow
 * lane, or waits. With no pool, or one that failed, it runs ungranted. The
 * function returned gives the slot back.
 */
function takeSlot(
  capacity: LintCapacity | null,
  kind: PartKind,
): (() => void) | typeof WAIT_FOR_CAPACITY {
  if (capacity === null) return () => {};
  if (kind === "edit") return capacity.running(1);
  const lease = capacity.take(1, "slow", 1, "backlog");
  if (lease === WAIT_FOR_CAPACITY) return WAIT_FOR_CAPACITY;
  return () => lease?.release();
}

/**
 * The part's files at the bytes they are keyed at; a feed file ESLint does
 * not lint has no key. A file gone, or whose bytes moved since, is skipped:
 * the revision that moved it keys it again. Inputs the provider refuses
 * (D9) give their reason.
 */
async function readTexts(
  ctx: PartsContext,
  keyer: Keyer,
  paths: readonly RelativePath[],
): Promise<PartFile[] | { readonly unknown: string }> {
  let keys: Awaited<ReturnType<Keyer["keys"]>>;
  try {
    keys = await keyer.keys(paths);
  } catch (error) {
    return { unknown: error instanceof Error ? error.message : String(error) };
  }
  const files: PartFile[] = [];
  for (const path of paths) {
    const keyed = keys.get(path) ?? null;
    const blob = keyed?.blob ?? (ctx.feed.has(path) ? keyer.inputBlobOf(path) : null);
    const bytes = blob === null ? null : await readFile(join(ctx.root, path)).catch(() => null);
    if (bytes === null || blobHash(bytes, ctx.format) !== blob) {
      ctx.feed.delete(path);
      continue;
    }
    files.push({
      path,
      text: bytes.toString("utf8"),
      blob,
      key: keyed?.key ?? null,
      wholeProgram: keyed?.wholeProgram ?? false,
    });
  }
  return files;
}
