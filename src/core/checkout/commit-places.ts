import { createHash } from "node:crypto";
import { freemem } from "node:os";
import { join } from "node:path";
import { compare } from "../fs/compare.js";
import type { AbsolutePath } from "../types/common.js";
import { type ListedCheckout, listCheckouts } from "./sweep.js";

/*
 * Spec 023 D7.1, D7.4 (row 023-38): what names a commit worktree, and how
 * many may live at once. A commit fixes every file git holds, so the
 * environment fingerprint covers what D2's environment reads beside them:
 * the Node version, the platform, the architecture and the allow-listed
 * variables the caller passes. The ceiling follows the machine's free
 * memory, 1 GB per commit daemon (the coordinator, 2026-11-21: the research
 * measured 0.7 to 1.8 GB idle), at least 1, unless the caller passes the
 * configured number.
 */

/** The memory one commit daemon is counted at. */
export const COMMIT_DAEMON_BYTES = 1024 ** 3;

/** The fingerprint of this process's environment and of `variables` (the allow-listed ones). */
export function environmentFingerprint(variables: Readonly<Record<string, string>> = {}): string {
  const env = Object.keys(variables)
    .sort(compare)
    .map((name) => [name, variables[name]]);
  const inputs = { node: process.version, platform: process.platform, arch: process.arch, env };
  return createHash("sha256").update(JSON.stringify(inputs)).digest("hex").slice(0, 16);
}

/** The folder name of the commit worktree at `commit` for `fingerprint`, in its repository's dir. */
export function commitFolderName(commit: string, fingerprint: string): string {
  return `commit-${commit}-${fingerprint}`;
}

export interface CeilingInputs {
  /** The configured ceiling; it wins when it is a whole number of at least 1. */
  readonly configured?: number | undefined;
  /** `os.freemem()` by default. */
  readonly freeBytes?: number | undefined;
  readonly perDaemonBytes?: number | undefined;
}

/** D7.4: how many commit worktrees may live at once: free memory over 1 GB, at least 1. */
export function commitWorktreeCeiling(inputs: CeilingInputs = {}): number {
  const { configured } = inputs;
  if (configured !== undefined && Number.isInteger(configured) && configured >= 1)
    return configured;
  const free = inputs.freeBytes ?? freemem();
  return Math.max(1, Math.floor(free / (inputs.perDaemonBytes ?? COMMIT_DAEMON_BYTES)));
}

/** The commit worktrees in `dirs` whose owner is not surely gone; a dir named twice counts once. */
export function liveCommitWorktrees(dirs: readonly AbsolutePath[]): ListedCheckout[] {
  return listCheckouts([...new Set(dirs)]).filter(
    (listed) => listed.marker?.fingerprint !== undefined && listed.owner !== "dead",
  );
}

/** The machine's lock over counting and making commit worktrees, under the cache root. */
export function placesLockPath(cacheRoot: AbsolutePath): AbsolutePath {
  return join(cacheRoot, "commit-places.lock");
}

/** The line a creator says once when the ceiling makes it wait. */
export function waitsLine(live: readonly ListedCheckout[], ceiling: number): string {
  const commits = live.map((listed) => listed.marker?.commit.slice(0, 12) ?? "?").join(", ");
  return `squeal: waiting for a place: ${live.length} of ${ceiling} commit worktrees live (${commits}); one frees when its daemon exits or \`squeal stop --at <commit>\` stops it`;
}
