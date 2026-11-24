import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { join } from "node:path";
import { lastScannedHead } from "../core/daemon/bootstrapped.js";
import { splitNul } from "../core/fs/git.js";
import { worktreeIdFor } from "../core/fs/git-layout.js";
import { sameStat } from "../core/hash/stat-cache.js";
import { worktreeLiveness } from "../core/presence/heartbeat.js";
import { readRevisionCommit } from "../core/state/revision-commit.js";
import { readGitHead } from "../core/status/git-head.js";
import { CLI_READ_RETRY_MS, type StatusContext, withStatusStore } from "../core/status/open.js";
import { listPaths, plural, utcTimeText } from "../core/text.js";
import type { AbsolutePath, EpochMs, RelativePath } from "../core/types/common.js";
import type { Revision } from "../core/types/revision.js";
import type { StatusResult } from "../core/types/status.js";
import type { FileHashRecord } from "../core/types/store-records.js";

/*
 * Spec 026 D2.4 (row 026-09, vision principle 2): `squeal status`, `code`
 * and `lint` answer from the stores with no daemon, which a short-lived
 * daemon (D2.2) makes the common case between edit bursts. When no daemon
 * validates the worktree and what git sees differs from what the last pass
 * saw, they say so in one line. "Differs" is cheap: `HEAD` against the one
 * recorded with the latest revision, each path the daemon cached
 * (`file_hashes`) against its stat on disk, and each path `git status`
 * lists that the cache does not hold (a new file).
 */

/** How long the check may take git; past it, no notice: unknown is not stale. */
export const STALE_GIT_TIMEOUT_MS = 1_000;

/** Variables that would point git at another repository than the worktree (`runGit`'s). */
const REPOSITORY_VARIABLES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
];

/**
 * The one-line notice for the worktree at `cwd`, or `null`: a daemon
 * validates, nothing changed, or no answer. `command` names the CLI as
 * status text does (`statusCommand`).
 */
export function noDaemonNotice(cwd: AbsolutePath, now: EpochMs, command: string): string | null {
  const read = withStatusStore(cwd, { busyRetryMs: CLI_READ_RETRY_MS }, (context) =>
    staleness(context, now, command),
  );
  return typeof read === "string" ? read : null;
}

/** `squeal status`'s lead: the notice and a line break while no daemon validates, else empty. */
export function statusLead(
  result: StatusResult,
  cwd: AbsolutePath,
  now: EpochMs,
  command: string,
): string {
  if (!result.available || result.daemon.state === "alive") return "";
  const notice = noDaemonNotice(cwd, now, command);
  return notice === null ? "" : `${notice}\n`;
}

/**
 * What `noDaemonNotice` reads from an open store. With no revision the
 * results are the start scan's, revision 0. With nothing in the stat
 * cache, no pass saw the worktree, which status says already.
 */
export function staleness(
  { store, root }: StatusContext,
  now: EpochMs,
  command: string,
): string | null {
  const id = worktreeIdFor(root);
  if (worktreeLiveness(store.worktrees.get(id), now).state === "alive") return null;
  const cached = new Map(store.fileHashes.list(id).map((record) => [record.path, record]));
  if (cached.size === 0) return null;
  const listed = gitStatusPaths(root);
  if (listed === null) return null;
  const latest = store.revisions.latest(id);
  const commit = readRevisionCommit(store, id, latest);
  // Revision 0 (row 026-w2-r3): the `HEAD` the start scan saw.
  const was = (commit ?? latest)?.head ?? (latest === null ? lastScannedHead(store, id) : null);
  const head = readGitHead(root);
  const changed = changedPaths(root, cached, listed);
  const moved = was != null && head !== null && head !== was;
  const what = [
    ...(moved ? [`the commit now at HEAD (${head?.slice(0, 7)})`] : []),
    ...(changed.length > 0
      ? [`changes on disk to ${plural(changed.length, "file")} (${listPaths(changed)})`]
      : []),
  ];
  return what.length === 0 ? null : noticeText(latest, what.join(" and "), command);
}

/**
 * The paths whose stat differs from the daemon's cache: each cached one
 * (an edit since committed has no `git status` line), then each path git
 * lists that the cache does not hold (a new file).
 */
function changedPaths(
  root: AbsolutePath,
  cached: ReadonlyMap<RelativePath, FileHashRecord>,
  listed: readonly RelativePath[],
): RelativePath[] {
  const changed = [...cached.values()]
    .filter((record) => !seen(record, root, record.path))
    .map((record) => record.path);
  const added = listed.filter((path) => !cached.has(path) && !seen(null, root, path));
  return [...changed, ...added].sort();
}

function noticeText(latest: Revision | null, what: string, command: string): string {
  const revision = latest === null ? "0" : `${latest.number} (${utcTimeText(latest.createdAt)})`;
  return (
    `No daemon is running for this worktree, so these results are as of revision ${revision}, ` +
    `before ${what}; the next hook or \`${command} start\` brings them up to date.`
  );
}

/** Whether the daemon's stat cache holds `path` as it is on disk now; a file gone is seen when the cache has none. */
function seen(record: FileHashRecord | null, root: AbsolutePath, path: RelativePath): boolean {
  let stat: ReturnType<typeof lstatSync> | undefined;
  try {
    stat = lstatSync(join(root, path));
  } catch {
    return record === null;
  }
  if (record === null) return false;
  return sameStat(record, {
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    size: stat.size,
    inode: stat.ino,
  });
}

/** The paths `git status` lists, untracked ones included; `null` when git fails or is late. */
function gitStatusPaths(root: AbsolutePath): RelativePath[] | null {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
  for (const name of REPOSITORY_VARIABLES) delete env[name];
  const result = spawnSync(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignore-submodules=all"],
    { cwd: root, env, encoding: "utf8", timeout: STALE_GIT_TIMEOUT_MS },
  );
  if (result.status !== 0 || typeof result.stdout !== "string") return null;
  const fields = splitNul(result.stdout);
  const paths: RelativePath[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i] ?? "";
    paths.push(field.slice(3));
    // A rename or copy is followed by its source field, which is not a path on disk.
    if (field[0] === "R" || field[0] === "C") i++;
  }
  return paths;
}
