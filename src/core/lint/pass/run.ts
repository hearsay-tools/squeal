import type { EpochMs, FileHash, Policy, RelativePath, RevisionNumber } from "../../types/index.js";
import type { LintStore } from "../store/types.js";
import { Keyer } from "./keyer.js";
import { holdsBlob } from "./keys.js";
import { lintParts, type PartsEnd } from "./parts.js";
import { offKey, readCursor, readProgram, writeReason } from "./records.js";
import { type Rekeyed, rekey } from "./rekey.js";
import type { Listing, ProviderSession } from "./session.js";
import type { LintPassOptions, LintPassReport, LintSource, LintSourceFile } from "./types.js";
import type { Unlisted } from "./unlisted.js";

/**
 * Inputs the worker still held at other bytes, through a pass's refreshes
 * or after a lint call, are compared again after this.
 */
const MOVING_RECHECK_MS = 1_000;

/**
 * Key inputs looked up in the listing one by one before it is read whole
 * instead. Each lookup costs about 5 µs, the whole listing of 2300 files
 * about 4 ms (017-04's notes, wave 1.6).
 */
const POINT_LOOKUPS = 64;

/** What one pass works with beside the daemon's options. */
export interface PassState {
  readonly store: LintStore;
  readonly policy: Policy;
  readonly session: ProviderSession;
  /** The key inputs outside the listing, read on disk at each pass (wave 1.6). */
  readonly unlisted: Unlisted;
  readonly nodeMajor: number;
  /** Changed program files not yet fed to the worker (D5). */
  readonly feed: Set<RelativePath>;
  readonly now: () => EpochMs;
  readonly interrupted: () => boolean;
}

/** When the pass should look again, and whether a report grew the closure or the program. */
export interface PassEnd {
  readonly wakeAt: EpochMs | null;
  readonly grew: boolean;
}

/**
 * Spec 017 D7, one pass at the latest revision: the provider made ready
 * (D4) with the unlisted inputs read on disk, the keys of what changed
 * looked up (steps 1 to 3), then the pending files linted in parts (step
 * 4). The provider's off reason is kept for status (D9).
 */
export async function runLintPass(options: LintPassOptions, state: PassState): Promise<PassEnd> {
  const { worktreeId } = options;
  const { store, session, now } = state;
  const { source, blobOf } = onePass(options.source);
  const latest = source.latestRevision();
  const since = readCursor(store.meta, worktreeId)?.revision ?? latest;
  const changed = (after: number) => (after >= latest ? [] : source.changedPaths(after, latest));
  const listing: Listing = {
    blobOf,
    segment: () => {
      const record = readProgram(store.meta, worktreeId);
      if (record.files.length === 0) return null;
      const extensions = new Set(record.extensions);
      return (path) => blobOf(path) !== null && holdsBlob(path, extensions);
    },
  };
  const ready = await session.ready(changed, since, latest, listing);
  writeReason(store.meta, offKey(worktreeId), "off" in ready ? ready.off : null);
  if ("off" in ready) return { wakeAt: null, grew: false };
  for (const path of ready.feed) state.feed.add(path);
  if ("moving" in ready) return { wakeAt: now() + MOVING_RECHECK_MS, grew: false };
  const basis = {
    snapshot: ready.snapshot,
    installed: ready.installed,
    nodeMajor: state.nodeMajor,
  };
  const extensions = new Set(readProgram(store.meta, worktreeId).extensions);
  const keyer = new Keyer(basis, ready.provider, source, state.unlisted, extensions);
  const lint = state.policy.lint;
  const keyed = await rekey({ worktreeId, store, source, lint, now }, keyer, latest);
  for (const path of keyed?.feed ?? []) state.feed.add(path);
  const parts = await lintParts(
    {
      worktreeId,
      root: options.root,
      format: options.format,
      store,
      source,
      session,
      latest,
      now,
      capacity: options.capacity ?? (() => null),
      idleIn: options.idleIn ?? (() => 0),
      interrupted: state.interrupted,
      first: keyed?.first ?? new Set(),
      feed: state.feed,
    },
    keyer,
  );
  if (parts.off !== null) writeReason(store.meta, offKey(worktreeId), parts.off);
  if (keyed !== null || parts.linted > 0 || parts.hits > 0) {
    options.onPass?.(reportOf(latest, keyed, parts));
  }
  // A lint call whose worker held other bytes than its keys stored nothing for them: look again soon.
  const wakeAt = parts.spoiled ? now() + MOVING_RECHECK_MS : parts.wakeAt;
  return { wakeAt, grew: parts.grew };
}

/**
 * `source` with its listing read at most once in the pass, shared by the
 * unlisted inputs' check and the keys, and a listed path's blob: a
 * config's few inputs are looked up one by one, a program's many in the
 * listing, which the program segment reads anyway.
 */
function onePass(source: LintSource): {
  readonly source: LintSource;
  readonly blobOf: (path: RelativePath) => FileHash | null;
} {
  let files: readonly LintSourceFile[] | null = null;
  let blobs: ReadonlyMap<RelativePath, FileHash> | null = null;
  let lookups = 0;
  const list = () => {
    files ??= source.files();
    return files;
  };
  return {
    source: {
      latestRevision: () => source.latestRevision(),
      changedPaths: (after, upTo) => source.changedPaths(after, upTo),
      file: (path) => source.file(path),
      files: list,
      ignored: () => source.ignored(),
    },
    blobOf: (path) => {
      if (blobs === null && ++lookups <= POINT_LOOKUPS) return source.file(path)?.hash ?? null;
      blobs ??= new Map(list().map((f) => [f.path, f.hash]));
      return blobs.get(path) ?? null;
    },
  };
}

/** What the pass did: its keying's counts and its parts'. */
function reportOf(latest: RevisionNumber, keyed: Rekeyed | null, parts: PartsEnd): LintPassReport {
  return {
    revision: latest,
    mode: keyed?.mode ?? "edit",
    keyed: keyed?.keyed ?? 0,
    hits: (keyed?.hits ?? 0) + parts.hits,
    linted: parts.linted,
    stale: keyed?.stale ?? 0,
    transitions: (keyed?.transitions ?? 0) + parts.transitions,
  };
}
