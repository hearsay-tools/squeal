import { createHash, randomBytes } from "node:crypto";
import {
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { storePaths } from "../store/paths.js";
import type { AbsolutePath } from "../types/index.js";
import { currentUid, preparePrivateDir, userTmpDir } from "./paths.js";

/**
 * Where a daemon process lives outside its worktree (spec 001 D10, lessons
 * defect 13): its working directory is the store directory,
 * `<common-dir>/squeal/`, and its temp directory is
 * `/tmp/squeal-<uid>/tmp/<key>/`, where the key hashes the repository id
 * and the root. Not the `TMPDIR` of the hook that spawned it, which may be
 * a scratch directory another tool removes, and not under the store,
 * because a test that makes a temp directory must not find itself inside a
 * repository (review wave 7.6, B1).
 */
export interface DaemonScratch {
  readonly workDir: AbsolutePath;
  /** `/tmp/squeal-<uid>`, private to this user, made like the socket fallback directory. */
  readonly userDir: AbsolutePath;
  readonly tempDir: AbsolutePath;
}

export function daemonScratch(
  commonDir: AbsolutePath,
  root: AbsolutePath,
  uid: number = currentUid(),
): DaemonScratch {
  const userDir = userTmpDir(uid);
  const key = createHash("sha256")
    .update(`${repositoryId(commonDir)}\0${root}`)
    .digest("hex")
    .slice(0, 16);
  return { workDir: storePaths(commonDir).dir, userDir, tempDir: join(userDir, "tmp", key) };
}

/**
 * The random id in `<common-dir>/squeal/repository-id`, written by the first
 * daemon of the repository and kept after. A key built from paths alone is
 * shared by a repository that takes a path another just left, or one
 * deleted and cloned again in place, while the old daemon still runs; their
 * locks differ, so neither would guard the other's temp directory (review
 * wave 7.7, B1). The file is linked into place whole, so a racing daemon
 * reads either nothing or the full id.
 */
export function repositoryId(commonDir: AbsolutePath): string {
  const dir = storePaths(commonDir).dir;
  const file = join(dir, "repository-id");
  mkdirSync(dir, { recursive: true });
  const draft = `${file}.${process.pid}-${randomBytes(4).toString("hex")}`;
  writeFileSync(draft, `${randomBytes(16).toString("hex")}\n`);
  try {
    linkSync(draft, file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  } finally {
    unlinkSync(draft);
  }
  return readFileSync(file, "utf8").trim();
}

/** A temp directory ready for the daemon, and what preparing it could not settle at once. */
export interface PreparedScratch {
  readonly scratch: DaemonScratch;
  /** Why `/tmp/squeal-<uid>` was refused and a directory of this daemon's own is used instead. */
  readonly refusal: string | null;
  /** Removal of what earlier daemons left, which runs while the daemon starts and never rejects. */
  readonly leftovers: Promise<void>;
}

/**
 * Creates the temp directory empty, inside a user directory that must be
 * private (`preparePrivateDir`). Called under the daemon lock, and the key
 * is the lock's repository and root, so no other daemon is using what it
 * moves: a previous daemon that died left its files here. They are renamed
 * aside and removed in the background, because a large leftover would delay
 * the socket past the hooks' budget (review wave 7.7, N1).
 *
 * A user directory that is refused, made first by another user for one,
 * costs only its sharing: the daemon takes a fresh
 * `/tmp/squeal-<uid>-<key>-XXXXXX` and says why (review wave 7.7, N2).
 */
export function prepareScratch(
  scratch: DaemonScratch,
  uid: number = currentUid(),
): PreparedScratch {
  const leftovers = ownFallbacks(scratch, uid);
  try {
    preparePrivateDir(scratch.userDir, uid, "temp directory");
  } catch (error) {
    const tempDir = mkdtempSync(fallbackPrefix(scratch));
    const text = error instanceof Error ? error.message : String(error);
    return {
      scratch: { ...scratch, tempDir },
      refusal: `${text}; using ${tempDir} instead`,
      leftovers: removeInBackground(leftovers),
    };
  }
  try {
    renameSync(scratch.tempDir, `${scratch.tempDir}.old-${randomBytes(4).toString("hex")}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  mkdirSync(scratch.tempDir, { recursive: true });
  return {
    scratch,
    refusal: null,
    leftovers: removeInBackground([...leftovers, ...movedAside(scratch)]),
  };
}

/**
 * Removes the temp directory at shutdown, after the runner closed and before
 * the lock goes, so nothing of a retired worktree stays behind (review wave
 * 7.6, S1). Leftovers renamed aside go too; the caller waits for their
 * background removal first. The key is this daemon's alone, so no other
 * daemon is using any of it.
 */
export function removeScratch(scratch: DaemonScratch): void {
  for (const dir of [scratch.tempDir, ...movedAside(scratch)]) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function movedAside(scratch: DaemonScratch): AbsolutePath[] {
  const parent = dirname(scratch.tempDir);
  const prefix = `${basename(scratch.tempDir)}.old-`;
  return safeList(parent)
    .filter((name) => name.startsWith(prefix))
    .map((name) => join(parent, name));
}

/** `/tmp/squeal-<uid>-<key>-`: the prefix of a fallback directory, which only this key's daemons make. */
function fallbackPrefix(scratch: DaemonScratch): string {
  return `${scratch.userDir}-${basename(scratch.tempDir)}-`;
}

/** Fallback directories an earlier daemon of this key left: real directories of this user only. */
function ownFallbacks(scratch: DaemonScratch, uid: number): AbsolutePath[] {
  const prefix = fallbackPrefix(scratch);
  const parent = dirname(prefix);
  return safeList(parent)
    .map((name) => join(parent, name))
    .filter((path) => path.startsWith(prefix))
    .filter((path) => {
      const stat = lstatSync(path, { throwIfNoEntry: false });
      return stat?.isDirectory() === true && stat.uid === uid;
    });
}

function removeInBackground(dirs: readonly AbsolutePath[]): Promise<void> {
  // A leftover that cannot go now stays for the next daemon of the key.
  return Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))).then(
    () => {},
    () => {},
  );
}

function safeList(dir: AbsolutePath): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Moves this process into its scratch: working directory and `TMPDIR`,
 * `TMP` and `TEMP`, which Vitest reads through `os.tmpdir()` when an instance
 * is created and its workers inherit. Only for a process that is the daemon
 * (`squeal daemon`); a daemon started inside a test must not change a shared
 * process. Spec 001 D11's "with no additions" has this one exception.
 */
export function adoptScratch(scratch: DaemonScratch): void {
  process.chdir(scratch.workDir);
  process.env.TMPDIR = scratch.tempDir;
  process.env.TMP = scratch.tempDir;
  process.env.TEMP = scratch.tempDir;
}

/**
 * Runs runner calls with the worktree root as the working directory, and
 * returns to `scratch.workDir` once none is in flight. Vitest starts its
 * test workers in the daemon's working directory and never changes it, and
 * project configs and tests resolve relative paths against it, so they must
 * see the root as `vitest run` from the root would; between calls the daemon
 * holds nothing inside the root. A root that is gone is left to the call to
 * fail on, and to D10 to end the daemon.
 */
export function inRootWhileRunning(
  root: AbsolutePath,
  scratch: DaemonScratch,
): <T>(call: () => Promise<T>) => Promise<T> {
  let inFlight = 0;
  return async (call) => {
    if (inFlight++ === 0) chdirQuietly(root);
    try {
      return await call();
    } finally {
      if (--inFlight === 0) chdirQuietly(scratch.workDir);
    }
  };
}

function chdirQuietly(dir: AbsolutePath): void {
  try {
    process.chdir(dir);
  } catch {
    // Left where it was; the next call or D10 deals with a missing directory.
  }
}
