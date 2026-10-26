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
import type { LintKnownState } from "../../types/lint.js";
import type { LintStore } from "../store/types.js";
import type { Keyer } from "./keyer.js";
import { type LintedPart, lintFiles, type PartFile, unknownPart } from "./lint-part.js";
import { readQuiet } from "./records.js";
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
  const skipped = new Set<RelativePath>();
  const done = { linted: 0, hits: 0, transitions: 0, off: null as string | null, grew: false };
  const end = (wakeAt: EpochMs | null): PartsEnd => ({ ...done, wakeAt });
  for (;;) {
    const part = nextPart(ctx, skipped);
    if (part === null) return end(null);
    if (part.kind === "stale") {
      const wait = ctx.idleIn();
      if (wait > 0) return end(ctx.now() + wait);
    }
    const slot = takeSlot(ctx.capacity(), part.kind);
    if (slot === WAIT_FOR_CAPACITY) return end(ctx.now() + CAPACITY_RECHECK_MS);
    try {
      const files = await readTexts(ctx, keyer, part.paths, skipped);
      const did =
        "unknown" in files
          ? unknownPart(ctx, part.paths, files.unknown)
          : await lintFiles(ctx, keyer, files, part.judged);
      done.linted += did.linted;
      done.hits += did.hits;
      done.transitions += did.transitions;
      done.off = did.off;
      done.grew = did.grew;
    } finally {
      slot();
    }
    if (done.off !== null || done.grew || ctx.interrupted()) return end(null);
    await nextTurn();
  }
}

interface Part {
  readonly kind: PartKind;
  readonly paths: RelativePath[];
  /** Every changed program file is fed by the end of this part's call: its results count. */
  readonly judged: boolean;
}

/** The next part's files: the feed and an edit's files, then the backlog, then stale ones. */
function nextPart(ctx: PartsContext, skipped: ReadonlySet<RelativePath>): Part | null {
  const { store, worktreeId } = ctx;
  const open = (s: LintKnownState) => !skipped.has(s.check.path) && !ctx.feed.has(s.check.path);
  const pending = store.states.list(worktreeId, { outcome: "pending" }).filter(open);
  const quiet = readQuiet(store.meta, worktreeId);
  const feed = [...ctx.feed].sort();
  const edit = pending.filter((s) => !quiet.has(s.check.path));
  if (feed.length > 0 || edit.length > 0) {
    const paths = [...feed, ...firstOf(ctx, edit)].slice(0, PART_FILES);
    return { kind: "edit", paths, judged: feed.length <= PART_FILES };
  }
  const backlog = pending.filter((s) => quiet.has(s.check.path));
  if (backlog.length > 0) return { kind: "backlog", paths: firstOf(ctx, backlog), judged: true };
  const stale = store.states.list(worktreeId).filter((s) => s.stale && open(s));
  if (stale.length > 0) return { kind: "stale", paths: firstOf(ctx, stale), judged: true };
  return null;
}

/** At most a part's paths of `states`, those of `ctx.first` first. */
function firstOf(ctx: PartsContext, states: readonly LintKnownState[]): RelativePath[] {
  const paths = states.map((s) => s.check.path);
  const first = paths.filter((p) => ctx.first.has(p));
  return [...first, ...paths.filter((p) => !ctx.first.has(p))].slice(0, PART_FILES);
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
  skipped: Set<RelativePath>,
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
    const blob = keyed?.blob ?? (ctx.feed.has(path) ? keyer.blobOf(path) : null);
    const bytes = blob === null ? null : await readFile(join(ctx.root, path)).catch(() => null);
    if (bytes === null || blobHash(bytes, ctx.format) !== blob) {
      skipped.add(path);
      ctx.feed.delete(path);
      continue;
    }
    files.push({ path, text: bytes.toString("utf8"), blob, key: keyed?.key ?? null });
  }
  return files;
}
