import type {
  AbsolutePath,
  EpochMs,
  FileHash,
  Policy,
  RelativePath,
  WorktreeId,
} from "../../types/index.js";
import type { LintTool } from "../../types/lint.js";
import type { LintMetaRepo, LintStore } from "../store/types.js";
import { openForReading, readOrNull, withLint } from "../surface/source.js";
import { committedNews, waitsToLint } from "./commit-news.js";
import { heldBy, lintGroupOf, markHeld, pauseReleases } from "./moment.js";
import {
  forgetCommitted,
  lintScope,
  offKey,
  readBlobs,
  readCommitted,
  releaseKey,
  writeBlobs,
  writeCommitted,
} from "./records.js";

export { lintGroupOf, waitsToLint };

/*
 * Spec 019 D1, D5 step 1 (row 019-22): a lint group at `commit`. Its tools'
 * checks are keyed at each edit, as every lint check is, and a key with a
 * stored result is taken, but the pass lints none of them until a commit or
 * `squeal run <group>` releases it: the scheduler writes the released paths,
 * each at the blob it may lint, under `lint-release:<scope>`. The pass lints
 * a released path only while its file is that blob, and drops a release once
 * the path is no longer waiting at it. A commit's release is news (row
 * 019-43, lessons Round 3 P12, review 0.1.402 B1): `commit-news.ts` gives
 * its result a transition, as an edit's.
 *
 * Row 019-45 (D1 as amended 2026-11-05): a lint group at `pause` or `stop`
 * holds its checks the same way, and the agent's pause releases every path
 * that waits, each at its blob then. An edit's result is news by itself, so
 * that release keeps no provenance. Row 019-47: a lint group at `manual`
 * holds them too, and only `squeal run <group>` releases them.
 */

/** True when `tool`'s checks belong to a lint group at `commit`. */
export function heldForCommit(policy: Policy, tool: LintTool): boolean {
  return heldBy(policy, tool)?.at === "commit";
}

/** True while the scope's pass is off (D9): it keys and lints nothing. */
export function passOff(meta: LintMetaRepo, scope: string): boolean {
  return meta.get(offKey(scope)) !== null;
}

/** The released paths of one scope, each with the blob it may lint at. */
export function readReleased(meta: LintMetaRepo, scope: string): Map<RelativePath, FileHash> {
  return readBlobs(meta, releaseKey(scope));
}

/** Adds `paths`, each at its blob, to the record under `key`. */
function add(meta: LintMetaRepo, key: string, paths: ReadonlyMap<RelativePath, FileHash>): void {
  if (paths.size > 0) writeBlobs(meta, key, new Map([...readBlobs(meta, key), ...paths]));
}

/**
 * A commit releases `paths`, each at its blob, beside what is released
 * already. Its results are news (row 019-43): each path is a commit's
 * (`committedNews`) until its file is no longer that blob.
 */
export function release(
  meta: LintMetaRepo,
  scope: string,
  paths: ReadonlyMap<RelativePath, FileHash>,
): void {
  if (paths.size === 0) return;
  add(meta, releaseKey(scope), paths);
  const fresh = [...paths].map(([path, blob]) => [path, { blob, seq: 0 }] as const);
  writeCommitted(meta, scope, new Map([...readCommitted(meta, scope), ...fresh]));
}

/**
 * For one pass of a tool held for a commit: the waiting paths that may
 * lint now, each at its release's blob, which `blobOf` gives. Releases whose
 * path no longer waits (`waiting`) at their blob are dropped.
 */
function releasedNow(
  meta: LintMetaRepo,
  scope: string,
  waiting: ReadonlySet<RelativePath>,
  blobOf: (path: RelativePath) => FileHash | null,
): Map<RelativePath, FileHash> {
  const released = readReleased(meta, scope);
  const live = new Map(
    [...released].filter(([path, blob]) => waiting.has(path) && blobOf(path) === blob),
  );
  if (live.size !== released.size) writeBlobs(meta, releaseKey(scope), live);
  return live;
}

/** What the pass holds for the moment of a tool's lint group (rows 019-22, 019-45). */
export interface MomentHold {
  /** A path that waits for its group's moment: no release names it at its blob now; `null`, none waits. */
  readonly held: ((path: RelativePath) => boolean) | null;
  /** At `pause` or `stop`, milliseconds until the agent pauses while a path waits for it; else `null`. */
  readonly pauseIn: number | null;
}

/**
 * The pass's hold for `tool`: none unless a lint group at `pause`, `stop`,
 * `commit` or `manual` owns its checks; else whether a pending or stale
 * path waits for its moment, its release not at its blob now. At `pause`
 * and `stop`, while `pauseIn` reads 0 (the agent paused; absent, at once),
 * every waiting path is released at its blob first (row 019-45).
 */
export function momentHold(
  store: LintStore,
  worktreeId: WorktreeId,
  tool: LintTool,
  policy: Policy,
  blobOf: (path: RelativePath) => FileHash | null,
  pauseIn: (() => number) | undefined,
  now: () => EpochMs = Date.now,
): MomentHold {
  const scope = lintScope(worktreeId, tool);
  const held = heldBy(policy, tool);
  markHeld(store.meta, scope, held);
  // A commit's paths need provenance only while a group at `commit` holds them.
  if (held?.at !== "commit") forgetCommitted(store.meta, scope);
  if (held === null) return { held: null, pauseIn: null };
  const waiting = new Set(
    store.states
      .list(worktreeId, { tool })
      .filter(waitsToLint)
      .map((state) => state.check.path),
  );
  const pause = pauseReleases(held.at) && waiting.size > 0 ? (pauseIn?.() ?? 0) : null;
  if (pause !== null && pause <= 0) add(store.meta, releaseKey(scope), blobsOf(waiting, blobOf));
  const released = releasedNow(store.meta, scope, waiting, blobOf);
  if (held.at === "commit") committedNews(store, worktreeId, tool, released, blobOf, now());
  const waits = [...waiting].some((path) => !released.has(path));
  return {
    held: (path) => !released.has(path),
    pauseIn: waits && pause !== null && pause > 0 ? pause : null,
  };
}

/** `paths`, each at its blob now; a path with none is left out. */
function blobsOf(
  paths: Iterable<RelativePath>,
  blobOf: (path: RelativePath) => FileHash | null | undefined,
): Map<RelativePath, FileHash> {
  const blobs = new Map<RelativePath, FileHash>();
  for (const path of paths) {
    const blob = blobOf(path);
    if (typeof blob === "string") blobs.set(path, blob);
  }
  return blobs;
}

/**
 * Spec 019 D6 for a lint group (row 019-22): `squeal run <group>` lints
 * now every pending or stale check of the tools the group owns, whatever
 * its moment; a tool its group holds (`commit`, `pause` or `stop`, row
 * 019-45, and `manual`, row 019-47) releases them at the blob `blobOf`
 * gives. Stop's waiting entry
 * asks the same for a group at `stop` (D4 step 1). Returns how many checks
 * wait to lint; 0 while lint is off or its store cannot be read.
 */
export function releaseLintGroup(
  commonDir: AbsolutePath,
  policy: Policy,
  worktreeId: WorktreeId,
  group: string,
  blobOf: (path: RelativePath) => FileHash | null | undefined,
): number {
  const { lint } = policy;
  const tools = lint.tools.filter((tool) => lintGroupOf(policy, tool)?.name === group);
  const source = {
    policy: () => (lint.enabled ? lint : null),
    open: () => openForReading(commonDir, lint),
  };
  const read = withLint(source, ({ store }) => {
    let waiting = 0;
    for (const tool of tools) {
      const paths = store.states
        .list(worktreeId, { tool })
        .filter(waitsToLint)
        .map((state) => state.check.path);
      waiting += paths.length;
      // A request's release stays quiet: only a commit's is news (row 019-43).
      if (heldBy(policy, tool) !== null) {
        add(store.meta, releaseKey(lintScope(worktreeId, tool)), blobsOf(paths, blobOf));
      }
    }
    return waiting;
  });
  return readOrNull(read) ?? 0;
}
