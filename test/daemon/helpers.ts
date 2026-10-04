import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { loadavg } from "node:os";
import { dirname, join, resolve } from "node:path";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { isStoreOpenFailure, openStore, worktreeIdFor } from "../../src/core/store/index.js";
import type { PingResponse, Store } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";

const repoRoot = resolve(import.meta.dirname, "../..");
const fixture = resolve(repoRoot, "test/fixtures/scheduler/basic");
/** Inside the repository, so fixture copies resolve `vitest` from its `node_modules`. Git-ignored. */
const scratchDir = resolve(repoRoot, "test/fixtures/scheduler/.tmp");

/** Real daemons running real Vitest; a loaded machine needs headroom. */
export const SLOW = { timeout: 180_000 } as const;

/** Timing assertions are skipped on a machine this loaded, like the other timing tests. */
export const LOADED = loadavg()[0] !== undefined && (loadavg()[0] ?? 0) > 8;

export interface BuiltCli {
  /** `dist/cli/index.js` of a fresh build of `src`. */
  readonly cli: string;
  readonly cleanup: () => void;
}

/**
 * Builds `src` into a private `dist` so tests spawn the real `squeal` binary.
 * Under `node_modules/`, so the build resolves `vitest` and `chokidar`, with
 * the package manifest beside it for `squeal --version`.
 */
export function buildCli(): BuiltCli {
  const dir = join(repoRoot, "node_modules/.cache/squeal-test", randomUUID());
  mkdirSync(dir, { recursive: true });
  execFileSync(
    process.execPath,
    [
      join(repoRoot, "node_modules/typescript/bin/tsc"),
      "-p",
      join(repoRoot, "tsconfig.build.json"),
      "--outDir",
      join(dir, "dist"),
      "--declaration",
      "false",
      "--sourceMap",
      "false",
    ],
    { cwd: repoRoot, stdio: "pipe" },
  );
  copyFileSync(join(repoRoot, "package.json"), join(dir, "package.json"));
  return {
    cli: join(dir, "dist/cli/index.js"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export interface FixtureRepo {
  readonly root: string;
  readonly commonDir: string;
  readonly worktreeId: string;
  /** `XDG_RUNTIME_DIR` of this test's daemons. */
  readonly runtimeDir: string;
  readonly socketPath: string;
  readonly env: NodeJS.ProcessEnv;
  readonly cleanup: () => void;
}

export interface FixtureOptions {
  /** Extra files, committed with the fixture. */
  readonly files?: Readonly<Record<string, string>>;
}

/** A committed copy of the scheduler fixture, five test files, plus `files`. */
export function createFixtureRepo(options: FixtureOptions = {}): FixtureRepo {
  mkdirSync(scratchDir, { recursive: true });
  const dir = join(scratchDir, randomUUID());
  const main = join(dir, "main");
  cpSync(fixture, main, { recursive: true });
  renameSync(join(main, "_gitignore"), join(main, ".gitignore"));
  for (const [path, content] of Object.entries(options.files ?? {})) {
    mkdirSync(dirname(join(main, path)), { recursive: true });
    writeFileSync(join(main, path), content);
  }
  git(main, ["init", "-q", "-b", "main"]);
  git(main, ["add", "-A"]);
  git(main, ["commit", "-qm", "fixture"]);
  const root = realpathSync(main);
  const worktreeId = worktreeIdFor(root);
  // Short, so the socket path stays far below the 104-byte macOS limit.
  const runtimeDir = realpathSync(mkdtempSync("/tmp/sq-"));
  return {
    root,
    commonDir: realpathSync(join(main, ".git")),
    worktreeId,
    runtimeDir,
    socketPath: socketPathFor(worktreeId, { XDG_RUNTIME_DIR: runtimeDir }),
    env: childEnv(runtimeDir),
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
      rmSync(runtimeDir, { recursive: true, force: true });
    },
  };
}

/** The test's environment without what would leak a test runner or a repository into a daemon. */
export function childEnv(runtimeDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (/^(VITEST|GIT_)/.test(name) || name === "NODE_OPTIONS") continue;
    env[name] = value;
  }
  env.XDG_RUNTIME_DIR = runtimeDir;
  return env;
}

export interface SpawnedProcess {
  readonly child: ChildProcess;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  stdout(): string;
  stderr(): string;
}

/** Runs `squeal <args>` from the build, capturing its output. */
export function spawnCli(
  cli: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): SpawnedProcess {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
    out += chunk;
  });
  child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
    err += chunk;
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) =>
    child.on("exit", (code, signal) => done({ code, signal })),
  );
  return { child, exited, stdout: () => out, stderr: () => err };
}

export function spawnDaemon(cli: string, repo: FixtureRepo): SpawnedProcess {
  return spawnCli(cli, ["daemon", repo.root], { cwd: repo.root, env: repo.env });
}

export function delay(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** Polls until `check` returns a value other than `undefined`, `null` or `false`. */
export async function waitFor<T>(
  check: () => T | Promise<T>,
  timeoutMs: number,
  what = "condition",
): Promise<NonNullable<Exclude<T, false>>> {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value !== undefined && value !== null && value !== false) {
      return value as NonNullable<Exclude<T, false>>;
    }
    if (Date.now() - started > timeoutMs) throw new Error(`${what} not met in ${timeoutMs} ms`);
    await delay(10);
  }
}

/** The ping answer, or `null` when nothing answers within `timeoutMs`. */
export async function ping(socketPath: string, timeoutMs = 100): Promise<PingResponse | null> {
  try {
    const response = await requestDaemon(socketPath, { type: "ping" }, timeoutMs);
    return response.ok && response.type === "ping" ? response : null;
  } catch {
    return null;
  }
}

/** Waits for the daemon to answer with `phase: "ready"`: baseline lookup done, watcher on. */
export function waitReady(repo: FixtureRepo, timeoutMs = 60_000): Promise<PingResponse> {
  return waitFor(
    async () => {
      const answer = await ping(repo.socketPath, 500);
      return answer?.phase === "ready" ? answer : null;
    },
    timeoutMs,
    "daemon ready",
  );
}

/** Opens the fixture's store for reading in the test. */
export function openTestStore(repo: FixtureRepo): Store {
  const store = openStore(repo.commonDir, { create: false, busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
  return store;
}

/** Runs `fn` against a freshly opened store and closes it. */
export function withStore<T>(repo: FixtureRepo, fn: (store: Store) => T): T {
  const store = openTestStore(repo);
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

/** Stops a daemon with SIGTERM, or SIGKILL if it does not go within 60 s. */
export async function stopProcess(process: SpawnedProcess): Promise<void> {
  if (process.child.exitCode !== null || process.child.signalCode !== null) return;
  process.child.kill("SIGTERM");
  const timer = setTimeout(() => process.child.kill("SIGKILL"), 60_000);
  await process.exited;
  clearTimeout(timer);
}
