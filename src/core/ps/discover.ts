import { readdirSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { resolveCommonDir, worktreeIdFor } from "../fs/index.js";
import { HEARTBEAT_GRACE_INTERVALS } from "../status/index.js";
import { lockFileFor, storePaths } from "../store/index.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../types/index.js";
import type { Discover, Discovery, FoundDaemon, PhaseOf, PsPlaces, SocketFile } from "./model.js";
import type { PsUnknown } from "./shape.js";
import { type LockEntry, type ProcessRow, type PsSource, ticksToMs } from "./source.js";

/*
 * Spec 014 D2: every live daemon of the user, without a registry and without
 * a socket request. One pass over the process table reads the arguments of
 * Node main threads only; a daemon's lock fd names its worktree and store,
 * `/proc/locks` whether it holds that lock, and the socket files are tied to
 * it by worktree id. Its start time never ties it to a store row.
 */

/** `btime` is whole seconds, so a process start read from it is up to 1 s early. */
const START_MARGIN_MS = 1_000;
/** D2 step 1: Node 24 names its main thread `MainThread`; older Node, `node`. */
const NODE_COMMS: ReadonlySet<string> = new Set(["MainThread", "node"]);
const SCRIPT = /(?:^|\/)(?:squeal|squeal\.mjs|squeal\/dist\/cli\/index\.js)$/;
/** `<common-dir>/squeal/locks/<id>.sqlite`; a waiter lock (`waiter-<id>`) does not match. */
const LOCK_FILE = /^(.+)\/squeal\/locks\/([0-9a-f]{16})\.sqlite$/;
const SOCKET_FILE = /^squeal-([0-9a-f]{16})\.sock$/;
/** The `unknown` entry of a lock reading that cannot be read. */
const HOLDERS = "daemon lock holders";
/** `.../{.claude,.codex}/plugins/cache/<marketplace>/squeal/<version>/...`. */
const CACHE_INSTALL = /\/\.(claude|codex)\/plugins\/cache\/[^/]+\/squeal\/([^/]+)\//;
/** The npm packages of the Pi and OpenCode plugins carry no version in their path. */
const PACKAGE_INSTALL = /\/squeal-(pi|opencode)\/dist\/cli\/squeal\.mjs$/;

export const discover: Discover = (source, table, places, locks = source.locks()) => {
  const unknown: PsUnknown[] = [];
  if (locks === null) {
    const why = "they cannot be read: a phase is serving by its heartbeat, or unknown (D10)";
    unknown.push({ what: HOLDERS, why });
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

/**
 * D2 step 3 over the window's two `/proc/locks` readings (`lessons.md` P9),
 * `discovery` being `discover`'s over the first. One read returns a page per
 * `read()`, and a held lock can fall between two pages while other locks
 * change; a read right after the first misses the same lock far more often
 * than chance, so the second is 2 s later. A lock either reading shows is
 * held, and only two readable readings that both miss it prove it absent:
 * after a reading that cannot be read, a lock the other misses is unknown,
 * as without locks (D10), and `unknown` names the reading (`reviews/wave-5.md`
 * B1). A socket file is its daemon's when that daemon holds its lock, or may.
 */
export function lockedAgain(
  source: PsSource,
  discovery: Discovery,
  [first, second]: readonly [readonly LockEntry[] | null, readonly LockEntry[] | null],
): Discovery {
  const both = first !== null && second !== null;
  if (first === null && second === null) return discovery;
  if (both && discovery.daemons.every((d) => d.holdsLock !== false)) return discovery;
  const daemons = discovery.daemons.map((d) => {
    const shown =
      d.holdsLock === true ||
      (second !== null && holds(source, d.row.pid, d.lockPath, second) === true);
    const held = shown ? true : both && d.holdsLock === false ? false : null;
    return held === d.holdsLock ? d : { ...d, holdsLock: held };
  });
  const sockets = discovery.sockets.map((s) =>
    s.daemonPid === null ? { ...s, daemonPid: holderOf(daemons, s.worktreeId) } : s,
  );
  if (both) return { ...discovery, daemons, sockets };
  const [lost, read] = first === null ? ["first", "second"] : ["second", "first"];
  const why = `the window's ${lost} /proc/locks reading cannot be read, so a lock the ${read} misses is unknown, not absent: a phase is serving by its heartbeat, or unknown`;
  const unknown = discovery.unknown.filter((u) => u.what !== HOLDERS);
  return { daemons, sockets, unknown: [...unknown, { what: HOLDERS, why }] };
}

/**
 * Whether a row's start names `daemon`, over `source`'s boot time and tick
 * rate, read once: only when it is no earlier than the process start (less
 * `START_MARGIN_MS`). Its own registration is 1.2 to 12.1 s later, so the
 * start time excludes a predecessor's row and never ties one. `null`
 * without the boot time.
 */
export function ownStartOn(
  source: PsSource,
): (daemon: FoundDaemon, startedAt: EpochMs) => boolean | null {
  const boot = source.bootTime();
  const ticks = source.clockTicks();
  return (daemon, startedAt) =>
    boot === null
      ? null
      : startedAt >= boot + ticksToMs(daemon.row.startTicks, ticks) - START_MARGIN_MS;
}

/**
 * D2's phase table, a row's start read by `ownStartOn`. Without lock state
 * (D10), only its own fresh heartbeat says serving.
 */
export function phaseOn(source: PsSource): PhaseOf {
  const ownStart = ownStartOn(source);
  return (daemon, work, now) => {
    if (daemon.holdsLock === false) return "waiting";
    if (work === null) return "unknown";
    const own = (startedAt: EpochMs): boolean | null => ownStart(daemon, startedAt);
    const record = work.record;
    if (daemon.holdsLock === null) {
      const fresh =
        record !== null &&
        record.heartbeatAt >= now - HEARTBEAT_GRACE_INTERVALS * record.heartbeatIntervalMs;
      return fresh && own(record.startedAt) === true ? "serving" : "unknown";
    }
    // Locked and not yet registered: a fresh worktree has no start, a predecessor's is earlier.
    const recorded = work.recordedStartedAt;
    if (recorded === null) return "starting";
    const mine = own(recorded);
    if (mine === null) return "unknown";
    if (!mine) return "starting";
    return record === null ? "stopping" : "serving";
  };
}

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
      sockets.push({
        path,
        worktreeId,
        mtimeMs: stat.mtimeMs,
        daemonPid: holderOf(daemons, worktreeId),
        listening: listeners === null ? null : listeners.some((l) => l.fileInode === stat.ino),
      });
    }
  }
  return sockets;
}

/** The live daemon of `worktreeId` that holds its lock; where locks cannot be read (D10), any daemon of it. */
function holderOf(daemons: readonly FoundDaemon[], worktreeId: WorktreeId): number | null {
  return daemons.find((d) => d.worktreeId === worktreeId && (d.holdsLock ?? true))?.row.pid ?? null;
}

function names(dir: AbsolutePath): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    // No such directory: no daemon of this user has used it.
    return [];
  }
}
