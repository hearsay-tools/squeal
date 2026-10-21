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
import type { AbsolutePath, EpochMs } from "../types/index.js";
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
const KEY = /^[0-9a-f]{16}$/;
const LOCK_FILE = /^[0-9a-f]{16}\.sqlite$/;
const WAITER_LOCK = /^waiter-.+\.sqlite$/;
const PERMIT = /^pool\.(\d+)\.lock$/;
const MARK = /^pool\.mark\.[^.]+$/;
const SAFE_WORD = /^[\w@%+=:,./-]+$/;

/** Every path of an end command goes through this: a word the shell reads back as `word`. */
export function shellQuote(word: string): string {
  return SAFE_WORD.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

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
 * D7 `leftover-temp`: a key directory of `<temp>/squeal-<uid>/tmp/`, or a
 * `<temp>/squeal-*` directory but `squeal-<uid>`, of this user, that no
 * live daemon's key names, no process has as its working directory or in
 * its arguments, and that changed more than an hour ago. A name holding a
 * newline is never listed, since `--leftovers` is read one path per line.
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
  const candidates = [
    ...names(keyDirs)
      .filter((name) => !keys.has(name.split(".old-")[0] ?? ""))
      .map((name) => join(keyDirs, name)),
    ...names(places.tempDir)
      .filter((name) => name.startsWith("squeal-") && name !== `squeal-${places.uid}`)
      .filter((name) => !keys.has(fallbackKey(name, places.uid) ?? ""))
      .map((name) => join(places.tempDir, name)),
  ].filter((path) => !path.includes("\n"));
  const old = new Map<AbsolutePath, number>();
  for (const path of candidates) {
    const stat = lstatOrNull(path);
    if (stat === null || !stat.isDirectory() || stat.uid !== places.uid) continue;
    if (model.now - stat.mtimeMs > LEFTOVER_AGE_MS) old.set(path, stat.mtimeMs);
  }
  if (old.size === 0) return none;
  const used = usedPaths(model, keyDirs);
  if (used === null) {
    const why = "the working directories of processes cannot be read (D10)";
    unknown.push({ what: "flag leftover-temp", why });
    return none;
  }
  const paths = [...old.keys()].filter((path) => !used.has(path)).sort();
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

/** `squeal-<uid>-<key>-XXXXXX`, a daemon's own temp directory where the shared one was refused. */
function fallbackKey(name: string, uid: number): string | null {
  const prefix = `squeal-${uid}-`;
  const key = name.startsWith(prefix) ? name.slice(prefix.length, prefix.length + 16) : "";
  return KEY.test(key) ? key : null;
}

/**
 * The temp directories that some process of this user has as its working
 * directory or names in an argument; `null` when working directories
 * cannot be read. One pass over each text, so the cost does not grow with
 * the candidates.
 */
function usedPaths(model: PsModel, keyDirs: AbsolutePath): Set<AbsolutePath> | null {
  const { places, source } = model;
  const pids = [...model.second.sample.table.values()]
    .filter((row) => row.uid === null || row.uid === places.uid)
    .map((row) => row.pid);
  const cwds = source.cwds(pids);
  if (cwds === null) return null;
  const texts = [...cwds.values()];
  for (const pid of pids) texts.push(...(source.cmdline(pid) ?? []));
  const at = `${places.tempDir}/squeal-`;
  const within = /^([^/\s'"=:]+)(?:\/tmp\/([^/\s'"=:]+))?/;
  const used = new Set<AbsolutePath>();
  for (const text of texts) {
    for (let i = text.indexOf(at); i >= 0; i = text.indexOf(at, i + 1)) {
      const m = within.exec(text.slice(i + places.tempDir.length + 1));
      if (m === null) continue;
      used.add(join(places.tempDir, m[1] ?? ""));
      if (m[2] !== undefined) used.add(join(keyDirs, m[2]));
    }
  }
  return used;
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

/** An epoch time as `YYYY-MM-DD HH:MM UTC`. */
export function dateOf(ms: EpochMs): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
