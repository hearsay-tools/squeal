import { readFileSync } from "node:fs";
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
 * a time installs (`install.lock`, taken over from a host that died).
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

  return {
    root,
    async tree(entries) {
      const given = new Set(entries.map((entry) => entry.path));
      for (const path of Object.keys(files)) if (!given.has(path)) await remove(path);
      const missing: string[] = [];
      for (const entry of entries) {
        const held = files[entry.path];
        const same = held?.blob === entry.blob && held.mode === entry.mode;
        if (!same || !(await present(join(root, entry.path)))) missing.push(entry.path);
      }
      await save();
      return { missing };
    },
    async write(write) {
      for (const { file, bytes } of await unpackFiles(write)) {
        if (treeBlob(bytes) !== file.blob) {
          throw new Error(`runner host: the bytes of ${file.path} do not match their blob id`);
        }
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
      await mkdir(dir, { recursive: true });
      running.add(dir);
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

/**
 * `work` while this host holds the lock directory `lock`: made by one host
 * at a time, holding its process id, taken over when that process ended.
 */
async function locked<T>(lock: string, work: () => Promise<T>): Promise<T> {
  for (;;) {
    try {
      await mkdir(lock);
      await writeFile(join(lock, "pid"), String(process.pid));
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const holder = await readFile(join(lock, "pid"), "utf8").catch(() => "");
      // A holder that died gives the lock up, as does one that wrote no id within 10 s.
      const made = await lstat(lock).then(
        (stat) => stat.mtimeMs,
        () => Date.now(),
      );
      const dead = holder === "" ? Date.now() - made > 10_000 : !hostRuns(`${holder}-`);
      if (dead) {
        await rm(lock, { recursive: true, force: true });
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    return await work();
  } finally {
    await rm(lock, { recursive: true, force: true });
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
