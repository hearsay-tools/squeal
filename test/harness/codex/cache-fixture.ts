import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { build } from "esbuild";
import {
  bundleOptions,
  copyCoverageRuntime,
  copyNodeTestRuntime,
  copyObserveRuntime,
  copyPluginTrees,
  copyPytestRuntime,
  writePluginVersions,
} from "../../../src/harness/build.js";
import {
  CODEX_MANIFEST,
  CODEX_PLUGIN_DIR,
  CODEX_RUNTIME,
  CODEX_SKILL,
  noteCodexCommand,
} from "../../../src/harness/codex/build.js";
import { observeMetafile } from "../../helpers/build-inputs.js";

/*
 * Codex's plugin cache in a temporary directory (`research/plugin-cache-cleanup.md`
 * 4): each version as `codex plugin add` copies it, under
 * `<home>/.codex/plugins/cache/hearsay/squeal/<version>`, and `remove`, the
 * `rm -rf` that is exactly Codex's `remove_old_plugin_versions`. The plugin
 * data directory is where Codex 0.160.1 names it to hooks.
 */

/** Two versions of one release line, A before B. */
export const A = "0.1.900";
export const B = "0.1.901";

/**
 * Builds a Codex plugin as it was before the fixed plugin (spec 002 D7) into
 * `dir` with its bundles at `version`: the declarations and manifest of
 * `plugins/codex`, no seed, the skills and launcher from their sources, the
 * skill with the Codex note, as `npm run build:plugin` made it then.
 */
export async function codexPluginAt(dir: string, version: string): Promise<void> {
  for (const entry of ["hooks", CODEX_MANIFEST]) {
    cpSync(join(CODEX_PLUGIN_DIR, entry), join(dir, entry), { recursive: true });
  }
  copyPluginTrees({ ...CODEX_RUNTIME, pluginDir: dir });
  noteCodexCommand(join(dir, CODEX_SKILL));
  writePluginVersions(dir, [CODEX_MANIFEST], version);
  const dist = join(dir, "dist");
  const result = await build(bundleOptions(CODEX_RUNTIME, dist, version));
  observeMetafile(result.metafile);
  copyNodeTestRuntime(dist);
  copyObserveRuntime(dist);
  copyCoverageRuntime(dist);
  copyPytestRuntime(dist);
}

/** Plugins built once per test file, copied into each machine's cache. */
export interface Built {
  readonly dir: string;
  readonly cleanup: () => void;
}

export async function buildVersions(versions: readonly string[]): Promise<Built> {
  const dir = mkdtempSync("/tmp/sq-vc-built-");
  for (const v of versions) await codexPluginAt(join(dir, v), v);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export interface CodexMachine {
  readonly dir: string;
  readonly home: string;
  readonly cache: string;
  /** `PLUGIN_DATA` as Codex gives it to the plugin's hooks. */
  readonly data: string;
  /** `node` and the system tools, no `squeal`. */
  readonly path: string;
  rootOf(version: string): string;
  /** Copies `version` into the cache, as an install does. */
  install(version: string): string;
  /** Codex's install of another version: the directory of `version` is gone. */
  remove(version: string): void;
  /** Runs `command` in bash in `cwd` with this machine's HOME and PATH, plus `env`. */
  shell(
    command: string,
    cwd: string,
    env?: Readonly<Record<string, string>>,
  ): { status: number | null; stdout: string; stderr: string };
  /** Removes the machine's directory, retrying while a late write fills it. */
  cleanup(): void;
  /**
   * Ends `pids` (a daemon found through its socket), their descendants and
   * every process whose HOME is this machine's (the code store's process),
   * waits for them to exit, then cleans up. A process that only names a path
   * of the machine, or works in it, is not the machine's and keeps running.
   */
  end(pids?: readonly number[]): Promise<void>;
}

/** How long `end` waits for the machine's processes to exit. */
const END_WAIT_MS = 5_000;

/** `/proc/<pid>/<part>`, or "" when it is another user's, gone, or not Linux. */
function procRead(pid: number, part: string): string {
  try {
    return readFileSync(`/proc/${pid}/${part}`, "latin1");
  } catch {
    return "";
  }
}

/** The parent of `pid` from `/proc/<pid>/stat`, or undefined. */
function parentOf(pid: number): number | undefined {
  const stat = procRead(pid, "stat");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const ppid = Number(fields[1]);
  return Number.isInteger(ppid) && ppid > 0 ? ppid : undefined;
}

/**
 * The processes of the machine with `home`: those whose HOME is exactly
 * `home` (the machine's HOME is unique to it), the `roots` the caller named,
 * and every descendant of either. A working directory or an argument under
 * the machine's directory proves nothing: an independent process (a `tail -f`
 * of its log) has them too. This process and its parent are never included.
 */
function machinePids(home: string, roots: ReadonlySet<number>): number[] {
  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch {
    return [];
  }
  const own = new Set([process.pid, process.ppid]);
  const all = entries.filter((e) => /^\d+$/.test(e)).map(Number);
  const owned = new Set(
    all.filter(
      (pid) => roots.has(pid) || procRead(pid, "environ").split("\0").includes(`HOME=${home}`),
    ),
  );
  const parents = new Map(all.map((pid) => [pid, parentOf(pid)]));
  for (let grew = true; grew; ) {
    grew = false;
    for (const [pid, ppid] of parents) {
      if (ppid !== undefined && owned.has(ppid) && !owned.has(pid)) {
        owned.add(pid);
        grew = true;
      }
    }
  }
  return [...owned].filter((pid) => !own.has(pid));
}

/** Whether `pid` still runs: a zombie, which only its parent's wait removes, does not. */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "latin1");
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
  } catch {
    return true;
  }
}

/** SIGKILLs `pids`, their descendants and the machine's processes, and waits up to `END_WAIT_MS` for them to exit. */
async function endProcesses(pids: readonly number[], home: string): Promise<void> {
  const deadline = performance.now() + END_WAIT_MS;
  const own = new Set([process.pid, process.ppid]);
  const roots = new Set(pids.filter((pid) => !own.has(pid)));
  let left = [...new Set([...roots, ...machinePids(home, roots)])];
  while (left.length > 0 && performance.now() < deadline) {
    for (const pid of left) {
      if (own.has(pid)) continue;
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Gone already.
      }
    }
    await sleep(20);
    // A process the killed ones started a moment ago counts too.
    for (const pid of left) roots.add(pid);
    left = [...new Set([...left, ...machinePids(home, roots)])].filter(running);
  }
}

export function codexMachine(built: Built): CodexMachine {
  const dir = mkdtempSync("/tmp/sq-vc-");
  const home = join(dir, "home");
  const codex = join(home, ".codex", "plugins");
  const cache = join(codex, "cache", "hearsay", "squeal");
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  symlinkSync(process.execPath, join(bin, "node"));
  const path = `${bin}:/usr/bin:/bin`;
  const rootOf = (version: string) => join(cache, version);
  // Node 22 CI: a process still writing under HOME (its compile cache) made rmdir fail ENOTEMPTY.
  const cleanup = () =>
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  return {
    dir,
    home,
    cache,
    data: join(codex, "data", "squeal-hearsay"),
    path,
    rootOf,
    install(version) {
      cpSync(join(built.dir, version), rootOf(version), { recursive: true });
      return rootOf(version);
    },
    remove(version) {
      rmSync(rootOf(version), { recursive: true, force: true });
    },
    shell(command, cwd, env = {}) {
      return spawnSync("bash", ["-c", command], {
        cwd,
        env: { PATH: path, HOME: home, ...env },
        encoding: "utf8",
      });
    },
    cleanup,
    async end(pids = []) {
      await endProcesses(pids, home);
      cleanup();
    },
  };
}
