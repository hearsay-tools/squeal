import { readdirSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { resolveCommonDir, worktreeIdFor } from "../fs/index.js";
import { lockFileFor, storePaths } from "../store/index.js";
import type { AbsolutePath, WorktreeId } from "../types/index.js";
import type { Discover, FoundDaemon, PhaseOf, PsPlaces, SocketFile } from "./model.js";
import type { PsUnknown } from "./shape.js";
import type { LockEntry, ProcessRow, PsSource } from "./source.js";

/*
 * Spec 014 D2: every live daemon of the user, without a registry and without
 * a socket request. One pass over the process table reads the arguments of
 * Node main threads only; a daemon's lock fd names its worktree and store,
 * `/proc/locks` whether it holds that lock, and the socket files are tied to
 * it by worktree id. Its start time never ties it to a store row.
 */

/** D2 step 1: Node 24 names its main thread `MainThread`; older Node, `node`. */
const NODE_COMMS: ReadonlySet<string> = new Set(["MainThread", "node"]);
const SCRIPT = /(?:^|\/)(?:squeal|squeal\.mjs|squeal\/dist\/cli\/index\.js)$/;
/** `<common-dir>/squeal/locks/<id>.sqlite`; a waiter lock (`waiter-<id>`) does not match. */
const LOCK_FILE = /^(.+)\/squeal\/locks\/([0-9a-f]{16})\.sqlite$/;
const SOCKET_FILE = /^squeal-([0-9a-f]{16})\.sock$/;
/** `.../{.claude,.codex}/plugins/cache/<marketplace>/squeal/<version>/...`. */
const CACHE_INSTALL = /\/\.(claude|codex)\/plugins\/cache\/[^/]+\/squeal\/([^/]+)\//;
/** The npm packages of the Pi and OpenCode plugins carry no version in their path. */
const PACKAGE_INSTALL = /\/squeal-(pi|opencode)\/dist\/cli\/squeal\.mjs$/;

export const discover: Discover = (source, table, places) => {
  const unknown: PsUnknown[] = [];
  const locks = source.locks();
  if (locks === null) {
    unknown.push({ what: "daemon phases", why: "the lock holders cannot be read" });
  }
  const daemons: FoundDaemon[] = [];
  for (const row of table.values()) {
    if (!NODE_COMMS.has(row.comm)) continue;
    // A uid the source cannot give (D10) is not another user's.
    if (row.uid !== null && row.uid !== places.uid) continue;
    const args = source.cmdline(row.pid);
    const at = args === null ? -1 : daemonVerbAt(args);
    if (args === null || at < 0) continue;
    const daemon = found(source, row, args, at, locks);
    if (daemon.worktreeId === null) {
      const why =
        daemon.root === null
          ? "no lock file is open and the root in its arguments is relative"
          : `no lock file is open and its root ${daemon.root} cannot be read`;
      unknown.push({ what: `daemon ${row.pid} worktreeId`, why });
    }
    daemons.push(daemon);
  }
  return { daemons, sockets: socketFiles(source, places, daemons), unknown };
};

/** D2's phase table. Without a readable store, a lock holder may be serving or stopping. */
export const phaseOf: PhaseOf = (daemon, work) => {
  if (daemon.holdsLock === null) return "unknown";
  if (!daemon.holdsLock) return "waiting";
  if (work === null) return "unknown";
  return work.record === null ? "stopping" : "serving";
};

/** The index of `daemon` right after a Squeal script; `-1` when the arguments are not a daemon's. */
function daemonVerbAt(args: readonly string[]): number {
  for (let k = 1; k < args.length; k++) {
    if (args[k] === "daemon" && SCRIPT.test(args[k - 1] ?? "")) return k;
  }
  return -1;
}

function found(
  source: PsSource,
  row: ProcessRow,
  args: readonly string[],
  at: number,
  locks: readonly LockEntry[] | null,
): FoundDaemon {
  const script = args[at - 1] ?? "";
  const given = args[at + 1];
  const root = given !== undefined && isAbsolute(given) ? given : null;
  const fromFd = lockFd(source.fds(row.pid));
  const lock = fromFd ?? (root === null ? null : lockOfRoot(root));
  const commonDir = lock?.commonDir ?? null;
  const lockPath = lock?.lockPath ?? null;
  return {
    row,
    script,
    root,
    awaitLock: args.slice(at + 2).includes("--await-lock"),
    ...installOf(script),
    worktreeId: lock?.worktreeId ?? null,
    idFrom: lock === null ? null : fromFd === null ? "root-hash" : "lock-fd",
    lockPath,
    commonDir,
    storePath: commonDir === null ? null : storePaths(commonDir).database,
    holdsLock: holds(source, row.pid, lockPath, locks),
  };
}

interface LockOf {
  readonly worktreeId: WorktreeId;
  readonly commonDir: AbsolutePath | null;
  readonly lockPath: AbsolutePath | null;
}

/** D2 step 2: the daemon lock among its open files. */
function lockFd(fds: readonly string[] | null): LockOf | null {
  for (const target of fds ?? []) {
    const m = LOCK_FILE.exec(target);
    if (m !== null) return { worktreeId: m[2] ?? "", commonDir: m[1] ?? "", lockPath: target };
  }
  return null;
}

/** D2 step 2's fallback: `worktreeIdFor` of the root, and the lock in its common dir. */
function lockOfRoot(root: AbsolutePath): LockOf | null {
  try {
    const worktreeId = worktreeIdFor(root);
    const commonDir = resolveCommonDir(root);
    return {
      worktreeId,
      commonDir,
      lockPath: commonDir === null ? null : lockFileFor(commonDir, worktreeId),
    };
  } catch {
    // A root that is gone or cannot be read: the caller names the id unknown.
    return null;
  }
}

/** D2 step 3: a held `POSIX WRITE` lock of `pid` on its lock file; `null` when that cannot be told. */
function holds(
  source: PsSource,
  pid: number,
  lockPath: AbsolutePath | null,
  locks: readonly LockEntry[] | null,
): boolean | null {
  if (locks === null || lockPath === null) return null;
  const file = source.fileKey(lockPath);
  return locks.some((l) => l.pid === pid && l.file === file && l.access === "write" && !l.blocked);
}

function installOf(script: string): Pick<FoundDaemon, "version" | "harness"> {
  const cache = CACHE_INSTALL.exec(script);
  if (cache !== null) return { harness: cache[1] ?? null, version: cache[2] ?? null };
  return { harness: PACKAGE_INSTALL.exec(script)?.[1] ?? null, version: null };
}

/**
 * D2 step 4: the `squeal-<id>.sock` files of the runtime dir and of
 * `/tmp/squeal-<uid>`, each with the live daemon of its id that holds its
 * lock. Where locks cannot be read (D10), any daemon of its id is it.
 */
function socketFiles(
  source: PsSource,
  places: PsPlaces,
  daemons: readonly FoundDaemon[],
): SocketFile[] {
  const listeners = source.unixListeners();
  const dirs = new Set([places.runtimeDir, join(places.tempDir, `squeal-${places.uid}`)]);
  const sockets: SocketFile[] = [];
  for (const dir of dirs) {
    if (dir === null) continue;
    for (const name of names(dir)) {
      const worktreeId = SOCKET_FILE.exec(name)?.[1];
      if (worktreeId === undefined) continue;
      const path = join(dir, name);
      let stat: { ino: number; mtimeMs: number };
      try {
        stat = statSync(path);
      } catch {
        // Removed since the listing: there is no file to report.
        continue;
      }
      const daemon = daemons.find((d) => d.worktreeId === worktreeId && (d.holdsLock ?? true));
      sockets.push({
        path,
        worktreeId,
        mtimeMs: stat.mtimeMs,
        daemonPid: daemon?.row.pid ?? null,
        listening: listeners === null ? null : listeners.some((l) => l.fileInode === stat.ino),
      });
    }
  }
  return sockets;
}

function names(dir: AbsolutePath): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    // No such directory: no daemon of this user has used it.
    return [];
  }
}
