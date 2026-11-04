import { groupOf } from "../../daemon/check-groups.js";
import { groupView } from "../../scheduler/slow.js";
import type {
  AbsolutePath,
  EpochMs,
  FileHash,
  Policy,
  RelativePath,
  ResolvedGroup,
  WorktreeId,
} from "../../types/index.js";
import type { LintTool } from "../../types/lint.js";
import type { LintMetaRepo, LintStore } from "../store/types.js";
import { openForReading, readOrNull, withLint } from "../surface/source.js";
import { committedNews, waitsToLint } from "./commit-news.js";
import {
  forgetCommitted,
  heldKey,
  lintScope,
  offKey,
  readBlobs,
  readCommitted,
  releaseKey,
  writeBlobs,
  writeCommitted,
} from "./records.js";

export { waitsToLint };

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
 */

/** The lint group that owns `tool`'s checks: the first that selects it (D1); `null` with none. */
export function lintGroupOf(policy: Policy, tool: LintTool): ResolvedGroup | null {
  return groupOf(groupView(policy).groups, { kind: "lint", tool, path: "" });
}

/** True when `tool`'s checks belong to a lint group at `commit`. */
export function heldForCommit(policy: Policy, tool: LintTool): boolean {
  return lintGroupOf(policy, tool)?.at === "commit";
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

/** Row 019-43: records whether a lint group at `commit` holds the scope's tool, by its name. */
function markHeld(meta: LintMetaRepo, scope: string, group: string | null): void {
  const key = heldKey(scope);
  const now = meta.get(key);
  if (now === group) return;
  if (group === null) meta.delete(key);
  else meta.set(key, group);
}

/**
 * The pass's hold for `tool` (row 019-22): `null` unless a lint group at
 * `commit` owns its checks; else whether a pending or stale path waits for
 * a commit or request, its release not at its blob now.
 */
export function commitHold(
  store: LintStore,
  worktreeId: WorktreeId,
  tool: LintTool,
  policy: Policy,
  blobOf: (path: RelativePath) => FileHash | null,
  now: () => EpochMs = Date.now,
): ((path: RelativePath) => boolean) | null {
  const scope = lintScope(worktreeId, tool);
  const group = lintGroupOf(policy, tool);
  const held = group?.at === "commit";
  markHeld(store.meta, scope, held ? group.name : null);
  if (!held) {
    // Lint runs at each edit again: a commit's paths need no provenance.
    forgetCommitted(store.meta, scope);
    return null;
  }
  const waiting = new Set(
    store.states
      .list(worktreeId, { tool })
      .filter(waitsToLint)
      .map((state) => state.check.path),
  );
  const released = releasedNow(store.meta, scope, waiting, blobOf);
  committedNews(store, worktreeId, tool, released, blobOf, now());
  return (path) => !released.has(path);
}

/**
 * Spec 019 D6 for a lint group (row 019-22): `squeal run <group>` lints
 * now every pending or stale check of the tools the group owns, whatever
 * its moment; a tool held for a commit releases them at the blob `blobOf`
 * gives. Returns how many checks wait to lint; 0 while lint is off or its
 * store cannot be read.
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
      const paths = new Map<RelativePath, FileHash>();
      for (const state of store.states.list(worktreeId, { tool })) {
        if (!waitsToLint(state)) continue;
        waiting += 1;
        const blob = blobOf(state.check.path);
        if (typeof blob === "string") paths.set(state.check.path, blob);
      }
      // A request's release stays quiet: only a commit's is news (row 019-43).
      if (heldForCommit(policy, tool)) {
        add(store.meta, releaseKey(lintScope(worktreeId, tool)), paths);
      }
    }
    return waiting;
  });
  return readOrNull(read) ?? 0;
}
