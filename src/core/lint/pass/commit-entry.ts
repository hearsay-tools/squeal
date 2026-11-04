import { groupOf } from "../../daemon/check-groups.js";
import { groupView } from "../../scheduler/slow.js";
import type { FileHash, Policy, RelativePath, ResolvedGroup } from "../../types/index.js";
import type { LintTool } from "../../types/lint.js";
import type { LintMetaRepo } from "../store/types.js";
import { offKey } from "./records.js";

/*
 * Spec 019 D1, D5 step 1 (row 019-22): a lint group at `commit`. Its tools'
 * checks are keyed at each edit, as every lint check is, and a key with a
 * stored result is taken, but the pass lints none of them until a commit or
 * `squeal run <group>` releases it: the scheduler writes the released paths,
 * each at the blob it may lint, under `lint-release:<scope>`. The pass lints
 * a released path only while its file is that blob, and drops a release once
 * the path is no longer waiting at it.
 */

/** `meta` key of a tool's released paths in one worktree. */
export const releaseKey = (scope: string) => `lint-release:${scope}`;

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
