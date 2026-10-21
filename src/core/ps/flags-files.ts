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
import { SLOT_WAITER_FRESH_MS } from "../slow/index.js";
import { storePaths } from "../store/index.js";
import type { AbsolutePath } from "../types/index.js";
import { dateOf, shellQuote } from "./flags-text.js";
import type { PsModel, PsPlaces } from "./model.js";
import type { PsFileFlag, PsUnflaggedFiles, PsUnflaggedKind, PsUnknown } from "./shape.js";

/*
 * Spec 014 D7, the files (task 014-10): a socket no live daemon of its id
 * holds, a pool mark past its freshness, and the temp directories no live
 * daemon's key names and no process uses. Each is read by `readdir` and
 * `lstat` alone; nothing here removes a file. The files whose lock the OS
 * frees when the holder dies never get a flag; they are counted by kind.
 */

/** D7 `leftover-temp`: an mtime older than this, so no test or daemon is making it now. */
const LEFTOVER_AGE_MS = 60 * 60_000;
/**
 * The entries the size walk reads at most (the coordinator, 2026-10-21):
 * 3,500 leftover directories of one file each cost 120 to 140 ms CPU at
 * load 56, about half of it the walk, against goal 6's 0.3 s for the whole
 * snapshot. Past it the size is unknown, never a partial sum; the count
 * needs no walk.
 */
export const SIZE_WALK_ENTRIES = 10_000;
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
const LOCK_FILE = /^[0-9a-f]{16}\.sqlite$/;
const WAITER_LOCK = /^waiter-.+\.sqlite$/;
const PERMIT = /^pool\.(\d+)\.lock$/;
const MARK = /^pool\.mark\.[^.]+$/;

export interface FileFindings {
  readonly files: readonly PsFileFlag[];
  readonly unflagged: readonly PsUnflaggedFiles[];
  readonly leftovers: readonly AbsolutePath[];
  readonly unknown: readonly PsUnknown[];
}

/** `sizeEntries` bounds the size walk; tests lower it. */
export function fileFlags(model: PsModel, sizeEntries = SIZE_WALK_ENTRIES): FileFindings {
  const unknown: PsUnknown[] = [];
  const left = leftoverTemp(model, sizeEntries, unknown);
  return {
    files: [
      ...staleSockets(model, unknown),
      ...stalePoolMarks(model),
      ...(left.flag === null ? [] : [left.flag]),
    ],
    unflagged: unflagged(model),
    leftovers: left.paths,
    unknown,
  };
}

/** `squeal-<id>.sock` with no live daemon of `<id>` (D2 step 4 ties them), and no listener. */
function staleSockets(model: PsModel, unknown: PsUnknown[]): PsFileFlag[] {
  const flags: PsFileFlag[] = [];
  for (const socket of model.discovery.sockets) {
    if (socket.daemonPid !== null) continue;
    if (socket.listening === true) {
      const why = `a process listens at it, but no daemon of worktree ${socket.worktreeId} was found`;
      unknown.push({ what: `socket ${socket.path}`, why });
      continue;
    }
    flags.push({
      flag: "stale-socket",
      reason: `no live daemon of worktree ${socket.worktreeId} holds its lock; changed ${dateOf(socket.mtimeMs)}`,
      path: socket.path,
      count: 1,
      bytes: 0,
      command: `rm ${shellQuote(socket.path)}`,
    });
  }
  return flags;
}

/** A `pool.mark.*` file older than `SLOT_WAITER_FRESH_MS`: its holder died; readers skip it. */
function stalePoolMarks(model: PsModel): PsFileFlag[] {
  const flags: PsFileFlag[] = [];
  for (const dir of poolDirs(model.places)) {
    for (const name of names(dir)) {
      if (!MARK.test(name)) continue;
      const path = join(dir, name);
      const stat = lstatOrNull(path);
      if (stat === null || !stat.isFile() || model.now - stat.mtimeMs <= SLOT_WAITER_FRESH_MS)
        continue;
      flags.push({
        flag: "stale-pool-mark",
        reason: `unchanged since ${dateOf(stat.mtimeMs)}; readers skip a mark older than ${SLOT_WAITER_FRESH_MS / 1000} s`,
        path,
        count: 1,
        bytes: stat.size,
        command: `rm ${shellQuote(path)}`,
      });
    }
  }
  return flags;
}

interface Leftovers {
  readonly flag: PsFileFlag | null;
  readonly paths: AbsolutePath[];
}

/**
 * D7 `leftover-temp`: a directory of this user with a name Squeal makes, a
 * key directory of `<temp>/squeal-<uid>/tmp/`, a daemon's fallback
 * `<temp>/squeal-<uid>-<key>-XXXXXX` or a `MADE` name, that no live
 * daemon's key names, no process has as its working directory or in its
 * arguments, and that changed more than an hour ago (`lessons.md` P1). No
 * such name holds a newline, which `--leftovers`, one path per line, needs.
 */
function leftoverTemp(model: PsModel, sizeEntries: number, unknown: PsUnknown[]): Leftovers {
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
  const old = new Map<AbsolutePath, number>();
  for (const path of candidates) {
    const stat = lstatOrNull(path);
    if (stat === null || !stat.isDirectory() || stat.uid !== places.uid) continue;
    if (model.now - stat.mtimeMs > LEFTOVER_AGE_MS) old.set(path, stat.mtimeMs);
  }
  if (old.size === 0) return none;
  const paths = unusedPaths(model, keyDirs, [...old.keys()], unknown);
  if (paths === null) {
    const why = "the working directories of processes cannot be read (D10)";
    unknown.push({ what: "flag leftover-temp", why });
    return none;
  }
  if (paths.length === 0) return none;
  const bytes = sizeOf(paths, sizeEntries);
  if (bytes === null) {
    const why = `the size walk stopped at ${sizeEntries} entries; \`squeal ps --leftovers | xargs -d '\\n' du -sch --\` sums them`;
    unknown.push({ what: "files leftover-temp bytes", why });
  }
  const oldest = Math.min(...paths.map((path) => old.get(path) ?? model.now));
  const count = paths.length === 1 ? "1 directory" : `${paths.length} directories`;
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

/**
 * The `candidates` no process of this user uses, sorted; `null` when
 * working directories cannot be read. A directory is used when a working
 * directory, an argument, a listening unix socket or an open file is it or
 * lies under it, or an argument is `<option>=` and such a path. A path is
 * cut at `/` alone, since a name may hold a space, a quote, `=` or `:`, and
 * no argument is read as shell text (`reviews/wave-2.md` B2). The reads go
 * cheapest first and stop once every candidate is used: the open files of
 * 176 processes, about 4,100 descriptors, cost 32 to 43 ms CPU at load 28
 * (`lessons.md` P5). Sockets or open files that cannot be read count as no
 * use, and `unknown` names them, as D10 names a platform's missing reads.
 */
function unusedPaths(
  model: PsModel,
  keyDirs: AbsolutePath,
  candidates: readonly AbsolutePath[],
  unknown: PsUnknown[],
): AbsolutePath[] | null {
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
  for (const cwd of cwds.values()) use(named(cwd));
  for (const pid of pids) {
    if (unused.size === 0) break;
    for (const arg of source.cmdline(pid) ?? []) {
      // The path itself, or the value of `<option>=<path>`; a path's own `=` is no option's.
      const path = named(arg);
      use(path.startsWith(at) ? path : named(arg.slice(arg.indexOf("=") + 1)));
    }
  }
  if (unused.size > 0) {
    const listeners = source.unixListeners();
    if (listeners === null) {
      const why =
        "the listening unix sockets cannot be read (D10); a directory a socket is bound under counts as unused";
      unknown.push({ what: "flag leftover-temp sockets", why });
    }
    for (const listener of listeners ?? []) use(named(listener.path));
  }
  let read = 0;
  for (const pid of pids) {
    if (unused.size === 0) break;
    const fds = source.fds(pid);
    if (fds === null) continue;
    read += 1;
    // A file deleted since it was opened reads `<path> (deleted)`; the cut at `/` keeps its directory.
    for (const target of fds) use(named(target));
  }
  if (unused.size > 0 && read === 0) {
    const why =
      "the open files of processes cannot be read (D10); a directory a file is open under counts as unused";
    unknown.push({ what: "flag leftover-temp open files", why });
  }
  return [...unused].sort();
}

/** The bytes of the files below `dirs`; `null` past `limit` entries. */
function sizeOf(dirs: readonly AbsolutePath[], limit: number): number | null {
  const stack = [...dirs];
  let entries = 0;
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

/**
 * D7's last paragraph, for `--full`: every worktree lock and waiter lock
 * file of the stores in view, every permit file above the pool's size, and
 * every session-root file. Only the kinds that have one are listed.
 */
function unflagged(model: PsModel): PsUnflaggedFiles[] {
  const counts = new Map<PsUnflaggedKind, number>();
  const count = (kind: PsUnflaggedKind) => counts.set(kind, (counts.get(kind) ?? 0) + 1);
  const commonDirs = new Set(
    [...model.discovery.daemons.map((d) => d.commonDir), model.places.commonDir].filter(
      (dir): dir is AbsolutePath => dir !== null,
    ),
  );
  for (const dir of commonDirs) {
    for (const name of names(storePaths(dir).locksDir)) {
      if (LOCK_FILE.test(name)) count("lock");
      else if (WAITER_LOCK.test(name)) count("waiter-lock");
    }
  }
  for (const dir of poolDirs(model.places)) {
    for (const name of names(dir)) {
      const i = PERMIT.exec(name)?.[1];
      if (i !== undefined && Number(i) >= model.pool.pool.slots) count("surplus-permit");
    }
  }
  for (const dir of poolDirs(model.places, "squeal-sessions")) {
    for (const _ of names(dir)) count("session-root");
  }
  const kinds: readonly PsUnflaggedKind[] = [
    "lock",
    "waiter-lock",
    "surplus-permit",
    "session-root",
  ];
  return kinds.flatMap((kind) => {
    const n = counts.get(kind) ?? 0;
    return n === 0 ? [] : [{ kind, count: n }];
  });
}

/**
 * The directories a daemon keeps its pool and session roots in: the per-user
 * `<temp>/squeal-<uid>`, and the runtime directory, as a daemon picks one by
 * its own environment (004 D2). `sub` names the runtime one's child: the
 * pool lies in `squeal`, the session roots in `squeal-sessions`.
 */
function poolDirs(places: PsPlaces, sub = "squeal"): AbsolutePath[] {
  const userDir = join(places.tempDir, `squeal-${places.uid}`);
  const dirs = [sub === "squeal" ? userDir : join(userDir, sub)];
  if (places.runtimeDir !== null) dirs.push(join(places.runtimeDir, sub));
  return dirs;
}

function names(dir: AbsolutePath): string[] {
  try {
    return readdirSync(dir).sort();
  } catch {
    // No such directory: nothing of this kind was made there.
    return [];
  }
}

function lstatOrNull(path: AbsolutePath): Stats | null {
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
