import { createHash } from "node:crypto";
import {
  type Dirent,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { join } from "node:path";
import { storePaths } from "../store/index.js";
import type { AbsolutePath } from "../types/index.js";
import { dateOf } from "./flags-text.js";
import type { PsModel } from "./model.js";
import { bytes as sizeText } from "./render-units.js";
import type { PsFileFlag, PsUnknown } from "./shape.js";

/*
 * Spec 014 D7 `leftover-temp` (tasks 014-10, 014-22, 014-25, 014-23): the
 * temp directories Squeal made that no live daemon's key names and no
 * process uses, and their size with `--full`. Read by `readdir`, `lstat`
 * and the source alone; nothing here removes a file. A directory is listed
 * only when every use read held; otherwise `unknown` names it
 * (`reviews/wave-4.md` B2). `flags-files.ts` groups it with the other file
 * flags.
 */

/** D7 `leftover-temp`: an mtime older than this, so no test or daemon is making it now. */
const LEFTOVER_AGE_MS = 60 * 60_000;
/**
 * The entries the size walk reads at most (the coordinator, 2026-10-21):
 * 3,500 leftover directories of one file each cost 120 to 140 ms CPU at
 * load 56, about half of it the walk, against goal 6's 0.3 s for the whole
 * snapshot. Past it the size is unknown, never a partial sum; the count
 * needs no walk. The walk runs with `--full` only (014-23): no check that
 * reads nothing tells whether it will finish, and in 014-15 it passed the
 * bound in every sample, for 125 ms each (`lessons.md` P3).
 */
export const SIZE_WALK_ENTRIES = 10_000;
/** The command `unknown` gives for the size the walk did not sum. */
const DU = "`squeal ps --leftovers | xargs -d '\\n' du -sch --` sums them";
/** A key directory, `<key>`, or one moved aside, `<key>.old-<8 hex>` (`daemon/scratch.ts`). */
const KEY_DIR = /^([0-9a-f]{16})(?:\.old-[0-9a-f]{8})?$/;
/**
 * The other names Squeal makes under the temp directory, each `mkdtemp`'s
 * six letters and digits after its prefix: `squeal-e2e-` (`test/e2e/harness.ts`),
 * `squeal-e2e-oc-` (`test/e2e/opencode-fixture.ts`), `squeal-e2e-pi-`
 * (`test/e2e/pi-fixture.ts`) and `squeal-update-` (`cli/update.ts`). Never
 * `squeal-e2e-cache`, `squeal-evals-<uid>` or an agent's `squeal-review-*`.
 */
const MADE = /^squeal-(?:e2e-(?:oc-|pi-)?|update-)[A-Za-z0-9]{6}$/;

export interface FileFlagOptions {
  /** `--full`: the size walk of `leftover-temp` runs; without it the size is unknown. */
  readonly full?: boolean;
  /** Bounds the size walk; tests lower it. */
  readonly sizeEntries?: number;
}

export interface Leftovers {
  readonly flag: PsFileFlag | null;
  readonly paths: AbsolutePath[];
}

/**
 * D7 `leftover-temp`: a directory of this user with a name Squeal makes, a
 * key directory of `<temp>/squeal-<uid>/tmp/`, a daemon's fallback
 * `<temp>/squeal-<uid>-<key>-XXXXXX` or a `MADE` name, that no live
 * daemon's key names, that changed more than an hour ago (`lessons.md` P1),
 * and that `unusedPaths` proves no process uses. When a use read fails, no
 * directory is flagged: one `unknown` entry gives their count, their size
 * when known, the failed reads and their paths (B2). No such name holds a
 * newline, which `--leftovers`, one path per line, needs.
 */
export function leftoverTemp(
  model: PsModel,
  options: FileFlagOptions,
  unknown: PsUnknown[],
): Leftovers {
  const none: Leftovers = { flag: null, paths: [] };
  const keys = liveKeys(model);
  if (typeof keys === "string") {
    unknown.push({ what: "flag leftover-temp", why: keys });
    return none;
  }
  const { places } = model;
  const userDir = join(places.tempDir, `squeal-${places.uid}`);
  const keyDirs = join(userDir, "tmp");
  // `squeal-<uid>-<key>-XXXXXX`: a daemon's own temp directory where the shared one was refused.
  const fallback = new RegExp(`^squeal-${places.uid}-([0-9a-f]{16})-[A-Za-z0-9]{6}$`);
  const unkeyed = (pattern: RegExp, name: string): boolean => {
    const key = pattern.exec(name)?.[1];
    return key !== undefined && !keys.has(key);
  };
  const candidates = [
    ...names(keyDirs)
      .filter((name) => unkeyed(KEY_DIR, name))
      .map((name) => join(keyDirs, name)),
    ...names(places.tempDir)
      .filter((name) => MADE.test(name) || unkeyed(fallback, name))
      .map((name) => join(places.tempDir, name)),
  ];
  const old = new Map<AbsolutePath, Stats>();
  for (const path of candidates) {
    const stat = lstatOrNull(path);
    if (stat === null || !stat.isDirectory() || stat.uid !== places.uid) continue;
    if (model.now - stat.mtimeMs > LEFTOVER_AGE_MS) old.set(path, stat);
  }
  if (old.size === 0) return none;
  const use = unusedPaths(model, keyDirs, [...old.keys()]);
  if (use === null) {
    const why = "the working directories of processes cannot be read (D10)";
    unknown.push({ what: "flag leftover-temp", why });
    return none;
  }
  const paths = use.unused;
  if (paths.length === 0) return none;
  const limit = options.sizeEntries ?? SIZE_WALK_ENTRIES;
  const bytes = options.full === true ? sizeOf(paths, old, limit) : null;
  const count = paths.length === 1 ? "1 directory" : `${paths.length} directories`;
  if (use.unread.length > 0) {
    // What no read proves unused is no flag and no line of `--leftovers`: `unknown` gives the paths to judge (B2).
    const size = bytes === null ? "" : `, ${sizeText(bytes)},`;
    const why = `${count} under ${places.tempDir} that no readable process uses${size} ${paths.length === 1 ? "is" : "are"} not listed, since ${use.unread.join(" and ")}`;
    unknown.push({ what: "flag leftover-temp", why, paths });
    return none;
  }
  if (bytes === null) {
    const why =
      options.full === true
        ? `the size walk stops at ${limit} entries; ${DU}`
        : `the size walk runs with --full only; ${DU}`;
    unknown.push({ what: "files leftover-temp bytes", why });
  }
  const oldest = Math.min(...paths.map((path) => old.get(path)?.mtimeMs ?? model.now));
  return {
    flag: {
      flag: "leftover-temp",
      reason: `${count} under ${places.tempDir} that no live daemon's key names and no process uses, unchanged for over 1 h; the oldest since ${dateOf(oldest)}`,
      path: null,
      count: paths.length,
      bytes,
      command: "squeal ps --leftovers | xargs -d '\\n' rm -rf --",
    },
    paths,
  };
}

/**
 * Each live daemon's temp key, `sha256(<repository id> \0 <root>)[:16]`
 * (`daemon/scratch.ts`), read without writing: a daemon whose repository has
 * no id yet has no key directory either. Why it cannot be told, when it
 * cannot: a daemon whose root or repository is unknown may own any key.
 */
function liveKeys(model: PsModel): Set<string> | string {
  const keys = new Set<string>();
  for (const d of model.discovery.daemons) {
    if (d.root === null || d.commonDir === null)
      return `the temp key of daemon ${d.row.pid} is unknown: its root or repository cannot be read`;
    let id: string;
    try {
      id = readFileSync(join(storePaths(d.commonDir).dir, "repository-id"), "utf8").trim();
    } catch {
      // No id yet: the daemon has made no temp directory.
      continue;
    }
    const key = createHash("sha256")
      .update(`${id}\0${realOr(d.root)}`)
      .digest("hex");
    keys.add(key.slice(0, 16));
  }
  return keys;
}

interface UseCheck {
  /** The candidates no read shows in use, sorted. */
  readonly unused: AbsolutePath[];
  /** The reads that failed, so the non-use of `unused` is not proved; empty when every read held. */
  readonly unread: readonly string[];
}

/**
 * Which `candidates` no process of this user uses; `null` when working
 * directories cannot be read. A directory is used when a working
 * directory, an argument, a bound unix socket of any kind or an open file
 * is it or lies under it, or an argument is `<option>=` and such a path. A
 * path is cut at `/` alone, since a name may hold a space, a quote, `=` or
 * `:`, and no argument is read as shell text (`reviews/wave-2.md` B2). The
 * reads go cheapest first and stop once every candidate is used: the open
 * files of 176 processes, about 4,100 descriptors, cost 32 to 43 ms CPU at
 * load 28 (`lessons.md` P5). A read that fails proves nothing unused, so
 * it is kept for `unread` (`reviews/wave-4.md` B2). A missing working
 * directory is no failed read: on Linux the open files of such a process
 * cannot be read either, and that read names it.
 */
function unusedPaths(
  model: PsModel,
  keyDirs: AbsolutePath,
  candidates: readonly AbsolutePath[],
): UseCheck | null {
  const { places, source } = model;
  // The host's table: the second reads only the processes the window measures (`reviews/wave-2.md` B1).
  const pids = [...model.first.sample.table.values()]
    .filter((row) => row.uid === null || row.uid === places.uid)
    .map((row) => row.pid);
  const cwds = source.cwds(pids);
  if (cwds === null) return null;
  const at = `${places.tempDir}/squeal-`;
  // The kernel gives a working directory resolved: `/tmp` reads `/private/tmp` on macOS.
  const real = realOr(places.tempDir);
  const named = (text: string): string =>
    text.startsWith(`${real}/`) ? `${places.tempDir}${text.slice(real.length)}` : text;
  const unused = new Set(candidates);
  const use = (path: string): void => {
    if (!path.startsWith(at)) return;
    const [top = "", sub, key] = path.slice(places.tempDir.length + 1).split("/", 3);
    unused.delete(join(places.tempDir, top));
    if (top === `squeal-${places.uid}` && sub === "tmp" && key !== undefined && key !== "")
      unused.delete(join(keyDirs, key));
  };
  const unread = new Set<number>();
  for (const cwd of cwds.values()) use(named(cwd));
  for (const pid of pids) {
    if (unused.size === 0) break;
    const args = source.cmdline(pid);
    if (args === null) unread.add(pid);
    for (const arg of args ?? []) {
      // The path itself, or the value of `<option>=<path>`; a path's own `=` is no option's.
      const path = named(arg);
      use(path.startsWith(at) ? path : named(arg.slice(arg.indexOf("=") + 1)));
    }
  }
  // Every bound name, datagram and unconnected sockets too, not only listeners (`reviews/wave-4.md` B2).
  const sockets = unused.size === 0 ? [] : source.unixSockets();
  for (const path of sockets ?? []) use(named(path));
  for (const pid of pids) {
    if (unused.size === 0) break;
    const fds = source.fds(pid);
    if (fds === null) unread.add(pid);
    // A file deleted since it was opened reads `<path> (deleted)`; the cut at `/` keeps its directory.
    for (const target of fds ?? []) use(named(target));
  }
  if (unused.size === 0) return { unused: [], unread: [] };
  return { unused: [...unused].sort(), unread: failedReads(model, sockets === null, unread) };
}

/** How many processes a failed read names before it says how many more. */
const NAMED = 5;

/**
 * The failed use reads: the sockets, and each process whose arguments or
 * open files could not be read and that is still there. One that left, a
 * zombie, or a pid another process took since, holds nothing; one table
 * read tells them apart.
 */
function failedReads(model: PsModel, socketsUnread: boolean, pids: ReadonlySet<number>): string[] {
  const reasons = socketsUnread ? ["the bound unix sockets cannot be read (D10)"] : [];
  const first = model.first.sample.table;
  const now = pids.size === 0 ? new Map() : model.source.processTable([...pids]);
  const there = [...pids].filter((pid) => {
    const row = now.get(pid);
    return row !== undefined && row.state !== "Z" && row.startTicks === first.get(pid)?.startTicks;
  });
  if (there.length > 0) {
    const names = there.slice(0, NAMED).map((pid) => `${pid} ${first.get(pid)?.comm ?? "?"}`);
    const more = there.length > NAMED ? ` and ${there.length - NAMED} more` : "";
    const n = there.length === 1 ? "1 process cannot" : `${there.length} processes cannot`;
    reasons.push(`${n} be read: ${names.join(", ")}${more}`);
  }
  return reasons;
}

/**
 * The bytes of the files below `dirs`; `null` past `limit` entries. A
 * directory's links less two are at most its entries: ext4, xfs and tmpfs
 * count its subdirectories there, btrfs none. So when the `lstat` of `dirs`
 * already shows more than `limit`, the walk cannot finish and reads nothing.
 */
function sizeOf(
  dirs: readonly AbsolutePath[],
  stats: ReadonlyMap<AbsolutePath, Stats>,
  limit: number,
): number | null {
  let entries = 0;
  for (const dir of dirs) entries += Math.max(0, (stats.get(dir)?.nlink ?? 2) - 2);
  if (entries > limit) return null;
  const stack = [...dirs];
  entries = 0;
  let bytes = 0;
  for (let dir = stack.pop(); dir !== undefined; dir = stack.pop()) {
    let dirents: Dirent[];
    try {
      dirents = readdirSync(dir, { withFileTypes: true });
    } catch {
      // Removed or unreadable since the listing: it holds nothing to count.
      continue;
    }
    for (const dirent of dirents) {
      if (++entries > limit) return null;
      const path = join(dir, dirent.name);
      if (dirent.isDirectory()) stack.push(path);
      else bytes += lstatOrNull(path)?.size ?? 0;
    }
  }
  return bytes;
}

export function names(dir: AbsolutePath): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    // No such directory: nothing of this kind was made there.
    return [];
  }
}

export function lstatOrNull(path: AbsolutePath): Stats | null {
  try {
    return lstatSync(path);
  } catch {
    // Removed since the listing, or unreadable: there is no file to judge.
    return null;
  }
}

function realOr(path: AbsolutePath): AbsolutePath {
  try {
    return realpathSync(path);
  } catch {
    // A root that is gone hashes as its daemon named it.
    return path;
  }
}
