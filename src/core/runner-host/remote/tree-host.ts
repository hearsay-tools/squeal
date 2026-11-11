import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
import { installCommand } from "../../scheduler/install-command.js";
import {
  type HostCore,
  type InstallAnswer,
  insideRoot,
  LOG_BYTES,
  type TreeAnswer,
  type TreeEntry,
  type TreeWrite,
  treeBlob,
  type WireLog,
} from "./tree-wire.js";

/*
 * Spec 021 D10 (row 021-13): the host's side of a remote tree. A host
 * started with `--tree` owns its root: a directory under the remote cache,
 * one per local worktree, which only the daemon's messages change. It
 * writes nothing outside the root, removes only what it wrote (its record,
 * `files.json` beside the root), and installs the project's dependencies
 * from the lockfile when the lockfile's blob differs from its last install.
 * A local host has no tree and refuses these messages: it never writes into
 * a worktree.
 */

/** Committed lockfiles, as `installCommand` reads them (`src/core/scheduler/install-command.ts`). */
export const LOCKFILES = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
] as const;

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

/** What the install's output keeps for its error. */
const TAIL = 2_000;

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
  const save = async () => {
    const part = `${recordPath}.part`;
    await writeFile(part, JSON.stringify(files));
    await rename(part, recordPath);
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
    async write({ files: written, removed }) {
      for (const file of written) {
        const bytes = Buffer.from(file.data, "base64");
        if (treeBlob(bytes) !== file.blob) {
          throw new Error(`runner host: the bytes of ${file.path} do not match their blob id`);
        }
        const at = await place(file.path);
        await rm(at, { force: true, recursive: true });
        if (file.mode === "link") await symlink(bytes.toString("utf8"), at);
        else {
          const part = join(dirname(at), `.${basename(at)}.squeal-part`);
          await writeFile(part, bytes);
          await chmod(part, file.mode === "x" ? 0o755 : 0o644);
          await rename(part, at);
        }
        files[file.path] = {
          blob: file.blob,
          ...(file.mode === undefined ? {} : { mode: file.mode }),
        };
      }
      for (const path of removed) await remove(path);
      await save();
    },
    async blobs(paths) {
      const answer: Record<string, string | null> = {};
      for (const path of paths)
        answer[path] = insideRoot(path) ? await blobOf(join(root, path)) : null;
      return answer;
    },
    async install() {
      const locks = Object.fromEntries(
        LOCKFILES.flatMap((name) => (files[name] === undefined ? [] : [[name, files[name].blob]])),
      );
      if (Object.keys(locks).length === 0) return { ran: false, command: null };
      // The lockfiles' blobs, and whether the install left a `node_modules`: one removed
      // since is installed again; a project without dependencies may have none.
      const stamp = (modules: boolean) => JSON.stringify({ locks, modules });
      const modules = () => existsSync(join(root, "node_modules"));
      const last = existsSync(installedPath) ? readFileSync(installedPath, "utf8") : null;
      if (last === stamp(modules())) return { ran: false, command: null };
      const manifest = readJson(join(root, "package.json"));
      const command = await installCommand(root, manifest);
      await runInstall(command, root, output, env);
      await writeFile(installedPath, stamp(modules()));
      return { ran: true, command };
    },
    async runDir(runId) {
      const runs = join(state, "runs");
      await mkdir(runs, { recursive: true });
      // One run's logs at a time per tree: the daemon keeps its own copy.
      for (const old of await readdir(runs))
        await rm(join(runs, old), { recursive: true, force: true });
      const dir = join(runs, runId.replace(/[^A-Za-z0-9_.-]/g, "_"));
      await mkdir(dir, { recursive: true });
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

/** Runs the install in the root, its output to `output`; rejects with its end on a failure. */
function runInstall(
  command: string,
  root: string,
  output: (text: string) => void,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", command], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let tail = "";
    const take = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output(text);
      tail = (tail + text).slice(-TAIL);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (error) => reject(new Error(`could not run ${command}: ${error.message}`)));
    child.on("close", (code, signal) => {
      if (code === 0) resolve();
      else {
        const how = signal === null ? `exit code ${code}` : `signal ${signal}`;
        reject(new Error(`${command} failed on the remote (${how}): ${tail.trim()}`));
      }
    });
  });
}
