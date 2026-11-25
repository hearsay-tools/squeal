import { randomBytes } from "node:crypto";
import {
  closeSync,
  linkSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { installedDependenciesFingerprint } from "../../keys/environment.js";
import { materializeFromGit } from "./tree-git.js";
import { installTree, LOCKFILES } from "./tree-install.js";
import {
  type HostCore,
  type InstallAnswer,
  insideRoot,
  LOG_BYTES,
  type TreeAnswer,
  type TreeEntry,
  type TreeWrite,
  treeBlob,
  unpackFiles,
  type WireLog,
} from "./tree-wire.js";

/*
 * Spec 021 D10 (row 021-13): the host's side of a remote tree. A host
 * started with `--tree` owns its root: a directory under the remote cache,
 * one per local worktree, which only the daemon's messages change. It
 * writes nothing outside the root, removes only what it wrote (its record,
 * `files.json` beside the root), and installs the project's dependencies
 * from the lockfile when the lockfile's blob differs from its last install
 * or that install changed since (`tree-install.ts`).
 * A local host has no tree and refuses these messages: it never writes into
 * a worktree.
 *
 * Spec 026 D8.1 (row 026-11): several hosts may share a tree, as a slow
 * lane's beside the runner's own. Each keeps its runs' logs under its own
 * process id and removes only its own ended runs' and those of a host no
 * longer running. A file's or the record's next copy is written under a
 * name of this host's own before it replaces the old one, and one host at
 * a time installs (`install.lock`, taken over from a host that died, and
 * removed only by the host that holds it: review 0.1.617 B2).
 */

/** What the host answers of its tree. */
export interface TreeHost {
  readonly root: string;
  tree(entries: readonly TreeEntry[]): Promise<TreeAnswer>;
  write(write: TreeWrite): Promise<void>;
  blobs(paths: readonly string[]): Promise<Record<string, string | null>>;
  install(): Promise<InstallAnswer>;
  /** A directory of this host for run `runId`'s logs (spec 021 D6: the host makes its own). */
  runDir(runId: string): Promise<string>;
  /** The files of a run's `runDir`, to send back with its report. */
  logs(dir: string): Promise<WireLog[]>;
  /** The paths of `expected` whose blob id here differs (spec 021 D11). */
  differing(expected: Readonly<Record<string, string | null>>): Promise<string[]>;
  /** This process's environment inputs, the variables of `allowlist` among them (D11). */
  coreEnvironment(allowlist: readonly string[]): Promise<HostCore>;
}

/** The host's record of the files it wrote: path to blob id and mode. */
type Held = Record<string, { blob: string; mode?: "x" | "link" }>;

/**
 * The tree of a host whose root is `root`, its records in the directory
 * around it. `output` takes the install's output: the host's stderr, never
 * its protocol channel. The install runs with `env`.
 */
export function createTreeHost(
  root: string,
  output: (text: string) => void,
  env: NodeJS.ProcessEnv = process.env,
): TreeHost {
  const state = dirname(root);
  const recordPath = join(state, "files.json");
  const installedPath = join(state, "installed.json");
  const files: Held = readJson(recordPath) ?? {};
  /** This host's runs whose logs are not yet read. */
  const running = new Set<string>();
  const mine = `${process.pid}-`;
  /** A name no other host on the tree writes, for a file's next copy. */
  let parts = 0;
  const part = (at: string) => `${at}.${process.pid}-${++parts}.squeal-part`;
  const save = async () => {
    const next = part(recordPath);
    await writeFile(next, JSON.stringify(files));
    await rename(next, recordPath);
  };

  /** `path` inside the root, refusing a path that leaves it, also through a link. */
  const place = async (path: string): Promise<string> => {
    if (!insideRoot(path))
      throw new Error(`runner host: the path ${JSON.stringify(path)} leaves the root`);
    const at = join(root, path);
    await mkdir(dirname(at), { recursive: true });
    const realRoot = await realpath(root);
    const parent = await realpath(dirname(at));
    if (parent !== realRoot && !parent.startsWith(`${realRoot}/`)) {
      throw new Error(`runner host: the path ${path} leads outside the root through a link`);
    }
    return at;
  };

  const remove = async (path: string) => {
    if (files[path] === undefined) return;
    delete files[path];
    if (insideRoot(path)) await rm(join(root, path), { force: true, recursive: true });
  };

  const writeEntry = async (file: TreeEntry, bytes: Buffer) => {
    const at = await place(file.path);
    await rm(at, { force: true, recursive: true });
    if (file.mode === "link") await symlink(bytes.toString("utf8"), at);
    else {
      const next = part(join(dirname(at), `.${basename(at)}`));
      await writeFile(next, bytes);
      await chmod(next, file.mode === "x" ? 0o755 : 0o644);
      await rename(next, at);
    }
    files[file.path] = {
      blob: file.blob,
      ...(file.mode === undefined ? {} : { mode: file.mode }),
    };
  };

  return {
    root,
    async tree(entries) {
      const given = new Set(entries.map((entry) => entry.path));
      for (const path of Object.keys(files)) if (!given.has(path)) await remove(path);
      const need: TreeEntry[] = [];
      for (const entry of entries) {
        const held = files[entry.path];
        const same = held?.blob === entry.blob && held.mode === entry.mode;
        if (!same || !(await present(join(root, entry.path)))) need.push(entry);
      }
      const materialized = await materializeFromGit(root, need, writeEntry);
      const missing = need
        .filter((entry) => !materialized.has(entry.path))
        .map((entry) => entry.path);
      await save();
      return { missing };
    },
    async write(write) {
      for (const { file, bytes } of await unpackFiles(write)) {
        if (treeBlob(bytes) !== file.blob) {
          throw new Error(`runner host: the bytes of ${file.path} do not match their blob id`);
        }
        await writeEntry(file, bytes);
      }
      for (const path of write.removed) await remove(path);
      await save();
    },
    async blobs(paths) {
      const answer: Record<string, string | null> = {};
      for (const path of paths)
        answer[path] = insideRoot(path) ? await blobOf(join(root, path)) : null;
      return answer;
    },
    install() {
      const locks = Object.fromEntries(
        LOCKFILES.flatMap((name) => (files[name] === undefined ? [] : [[name, files[name].blob]])),
      );
      const keepModules = Object.keys(files).some((path) => path.startsWith("node_modules/"));
      return locked(join(state, "install.lock"), () =>
        installTree({ root, record: installedPath, locks, keepModules, output, env }),
      );
    },
    async runDir(runId) {
      const runs = join(state, "runs");
      await mkdir(runs, { recursive: true });
      // The daemon keeps its own copy of an ended run's logs; another host's live run keeps its own.
      for (const old of await readdir(runs)) {
        const ended = old.startsWith(mine) ? !running.has(join(runs, old)) : !hostRuns(old);
        if (ended) await rm(join(runs, old), { recursive: true, force: true });
      }
      const dir = join(runs, `${mine}${runId.replace(/[^A-Za-z0-9_.-]/g, "_")}`);
      // Row 026-23: running before it exists, so a concurrent run's sweep never takes it.
      running.add(dir);
      await mkdir(dir, { recursive: true }).catch((error: unknown) => {
        running.delete(dir);
        throw error;
      });
      return dir;
    },
    async differing(expected) {
      const differ: string[] = [];
      for (const [path, blob] of Object.entries(expected)) {
        const here = insideRoot(path) ? await blobOf(join(root, path)) : null;
        if (here !== blob) differ.push(path);
      }
      return differ;
    },
    async coreEnvironment(allowlist) {
      const env: Record<string, string> = {};
      for (const name of allowlist) {
        const value = process.env[name];
        if (value !== undefined) env[name] = value;
      }
      return {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        installedDependencies: await installedDependenciesFingerprint(root, root),
        env,
      };
    },
    async logs(dir) {
      running.delete(dir);
      const logs: WireLog[] = [];
      let left = LOG_BYTES;
      for (const entry of await readdir(dir, { withFileTypes: true, recursive: true })) {
        if (!entry.isFile() || left <= 0) continue;
        const at = join(entry.parentPath, entry.name);
        const bytes = await readFile(at);
        // A log past what is left keeps its end, where a failure is.
        const kept = bytes.byteLength > left ? bytes.subarray(bytes.byteLength - left) : bytes;
        left -= kept.byteLength;
        logs.push({ name: at.slice(dir.length + 1), data: kept.toString("base64") });
      }
      return logs;
    },
  };
}

/** A lock without its owner this long is a host's that died publishing it: that takes no time. */
const UNOWNED_LOCK_MS = 10_000;
/** A takeover guard this old is a host's that died taking over: a takeover is a few file operations. */
const STALE_BREAK_MS = 10_000;
const LOCK_RETRY_MS = 100;
const NO_HARD_LINKS: ReadonlySet<string> = new Set(["EPERM", "ENOTSUP", "EOPNOTSUPP", "ENOSYS"]);

/**
 * Review 0.1.617 B2: `work` while this host holds the lock file `lock`.
 * The lock holds its owner, `<pid> <nonce>`, unique to this install; a
 * holder that died, or a lock left without an owner, is taken over. After
 * `work` the host removes the lock only while it holds its own owner.
 */
async function locked<T>(lock: string, work: () => Promise<T>): Promise<T> {
  const owner = `${process.pid} ${randomBytes(8).toString("hex")}\n`;
  while (!acquire(lock, owner)) {
    if (takeOverStale(lock)) continue;
    await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
  }
  try {
    return await work();
  } finally {
    if (readOwner(lock) === owner) removeIfThere(lock);
  }
}

/** Creates `lock` holding `owner`, never empty where hard links work; false when it exists. */
function acquire(lock: string, owner: string): boolean {
  const published = `${lock}.${owner.trim().replace(" ", ".")}`;
  writeFileSync(published, owner, { mode: 0o600 });
  try {
    linkSync(published, lock);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    if (code === "EEXIST") return false;
    if (!NO_HARD_LINKS.has(code)) throw error;
  } finally {
    removeIfThere(published);
  }
  // No hard links here: create, then write; `takeOverStale` waits out a lock without an owner.
  let fd: number;
  try {
    fd = openSync(lock, "wx", 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    writeFileSync(fd, owner);
  } finally {
    closeSync(fd);
  }
  return true;
}

/**
 * Removes `lock` when its holder died, or it has had no owner for
 * `UNOWNED_LOCK_MS`; true when it is gone. One takeover at a time, and only
 * of the owner it read: a lock taken after that read is never removed.
 */
function takeOverStale(lock: string): boolean {
  const owner = readOwner(lock);
  if (owner === null) return true;
  if (!stale(lock, owner)) return false;
  const breaker = `${lock}.break`;
  try {
    closeSync(openSync(breaker, "wx", 0o600));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (ageMs(breaker) > STALE_BREAK_MS) removeIfThere(breaker);
    return false;
  }
  try {
    if (readOwner(lock) !== owner) return false;
    rmSync(lock, { recursive: true, force: true });
    return true;
  } finally {
    removeIfThere(breaker);
  }
}

/** The holder of `owner` died; a lock without an owner is busy until `UNOWNED_LOCK_MS`. */
function stale(lock: string, owner: string): boolean {
  const holder = /^(\d+) \S+\n$/.exec(owner)?.[1];
  if (holder !== undefined) return !hostRuns(`${holder}-`);
  return ageMs(lock) > UNOWNED_LOCK_MS;
}

/** The text of `lock`; `null` when it is gone, `""` when it cannot be read as a file. */
function readOwner(lock: string): string | null {
  try {
    return readFileSync(lock, "utf8");
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? null : "";
  }
}

/** Milliseconds since `path` changed; 0 when it is gone, so a missing file is never stale. */
function ageMs(path: string): number {
  try {
    return Date.now() - statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function removeIfThere(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Another host removed it first.
  }
}

/** Whether the run directory `name` is a live host's: one named by the process id of a running process. */
function hostRuns(name: string): boolean {
  const pid = /^(\d+)-/.exec(name)?.[1];
  if (pid === undefined) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function present(at: string): Promise<boolean> {
  try {
    await lstat(at);
    return true;
  } catch {
    return false;
  }
}

/** The blob id of what is at `at` now, a link's of its target; `null` when nothing. */
async function blobOf(at: string): Promise<string | null> {
  try {
    const stat = await lstat(at);
    if (stat.isSymbolicLink()) return treeBlob(Buffer.from(await readlink(at), "utf8"));
    return stat.isFile() ? treeBlob(await readFile(at)) : null;
  } catch {
    return null;
  }
}

function readJson(path: string): Held | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Held;
  } catch {
    return null;
  }
}
