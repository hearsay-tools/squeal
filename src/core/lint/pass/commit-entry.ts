import { groupOf } from "../../daemon/check-groups.js";
import { groupView } from "../../scheduler/slow.js";
import type {
  AbsolutePath,
  FileHash,
  Policy,
  RelativePath,
  ResolvedGroup,
  WorktreeId,
} from "../../types/index.js";
import type { LintKnownState, LintTool } from "../../types/lint.js";
import type { LintMetaRepo, LintStore } from "../store/types.js";
import { openForReading, readOrNull, withLint } from "../surface/source.js";
import { lintScope, offKey, releaseKey } from "./records.js";

/*
 * Spec 019 D1, D5 step 1 (row 019-22): a lint group at `commit`. Its tools'
 * checks are keyed at each edit, as every lint check is, and a key with a
 * stored result is taken, but the pass lints none of them until a commit or
 * `squeal run <group>` releases it: the scheduler writes the released paths,
 * each at the blob it may lint, under `lint-release:<scope>`. The pass lints
 * a released path only while its file is that blob, and drops a release once
 * the path is no longer waiting at it.
 */

/** The lint group that owns `tool`'s checks: the first that selects it (D1); `null` with none. */
export function lintGroupOf(policy: Policy, tool: LintTool): ResolvedGroup | null {
  return groupOf(groupView(policy).groups, { kind: "lint", tool, path: "" });
}

/**
 * A check waits to lint: it is pending, or stale, whose outcome is an old
 * one (017 D5). A request releases these, and its wait counts them as not
 * linted (row 019-26, review 0.1.398 B1).
 */
export function waitsToLint(state: Pick<LintKnownState, "outcome" | "stale">): boolean {
  return state.outcome === "pending" || state.stale;
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
  const text = meta.get(releaseKey(scope));
  if (text === null) return new Map();
  try {
    const raw = JSON.parse(text) as unknown;
    if (typeof raw !== "object" || raw === null) return new Map();
    const entries = Object.entries(raw as Record<string, unknown>);
    return new Map(entries.filter((e): e is [string, string] => typeof e[1] === "string"));
  } catch {
    return new Map();
  }
}

function writeReleased(
  meta: LintMetaRepo,
  scope: string,
  released: ReadonlyMap<RelativePath, FileHash>,
): void {
  if (released.size === 0) meta.delete(releaseKey(scope));
  else meta.set(releaseKey(scope), JSON.stringify(Object.fromEntries(released)));
}

/** Releases `paths`, each at its blob, beside what is released already. */
export function release(
  meta: LintMetaRepo,
  scope: string,
  paths: ReadonlyMap<RelativePath, FileHash>,
): void {
  if (paths.size === 0) return;
  writeReleased(meta, scope, new Map([...readReleased(meta, scope), ...paths]));
}

/**
 * For one pass of a tool held for a commit: whether a waiting path may
 * lint now, its release at the blob `blobOf` gives. Releases whose path no
 * longer waits (`waiting`) at their blob are dropped.
 */
export function releasedNow(
  meta: LintMetaRepo,
  scope: string,
  waiting: ReadonlySet<RelativePath>,
  blobOf: (path: RelativePath) => FileHash | null,
): (path: RelativePath) => boolean {
  const released = readReleased(meta, scope);
  const live = new Map(
    [...released].filter(([path, blob]) => waiting.has(path) && blobOf(path) === blob),
  );
  if (live.size !== released.size) writeReleased(meta, scope, live);
  return (path) => live.has(path);
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
): ((path: RelativePath) => boolean) | null {
  if (!heldForCommit(policy, tool)) return null;
  const waiting = new Set(
    store.states
      .list(worktreeId, { tool })
      .filter(waitsToLint)
      .map((state) => state.check.path),
  );
  const released = releasedNow(store.meta, lintScope(worktreeId, tool), waiting, blobOf);
  return (path) => !released(path);
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
      if (heldForCommit(policy, tool)) release(store.meta, lintScope(worktreeId, tool), paths);
    }
    return waiting;
  });
  return readOrNull(read) ?? 0;
}
