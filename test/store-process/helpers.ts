import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isCodeStoreOpenFailure, openCodeStore } from "../../src/core/code/store/open.js";
import { CODE_SCHEMA_VERSION } from "../../src/core/code/store/schema.js";
import type { CodeStore } from "../../src/core/code/store/types.js";
import { CodeRelay, type CodeRelayOptions } from "../../src/core/store-process/relay.js";
import type { StoreProcessLaunch } from "../../src/core/store-process/spawn.js";
import type { Policy } from "../../src/core/types/policy.js";

/* Row 021-36: a clone, its store process and its daemons' relays, all in a temporary directory. */

const register = fileURLToPath(new URL("../store/child/register-ts.mjs", import.meta.url));
const LOADER = ["--disable-warning=ExperimentalWarning", "--import", register] as const;
const CHILD = fileURLToPath(new URL("./child.ts", import.meta.url));
const PAUSE_PRELOAD = pathToFileURL(
  fileURLToPath(new URL("../daemon/pause-preload.mjs", import.meta.url)),
).href;
const source = (name: string) =>
  fileURLToPath(new URL(`../../src/core/store-process/${name}`, import.meta.url));

/** How a daemon run from the sources starts the store process: the whole CLI, through tsx. */
export const LAUNCH: StoreProcessLaunch = {
  execPath: process.execPath,
  execArgv: [
    "--disable-warning=ExperimentalWarning",
    "--import",
    pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
  ],
  cli: fileURLToPath(new URL("../../src/cli/index.ts", import.meta.url)),
};

export const ON = { complexity: { enabled: true } } as Pick<Policy, "complexity">;

export interface Clone {
  readonly commonDir: string;
  readonly env: NodeJS.ProcessEnv;
  /** Runs at the end of the test, last added first. */
  readonly later: (cleanup: () => unknown) => void;
  readonly cleanup: () => Promise<void>;
}

export function clone(): Clone {
  const dir = mkdtempSync(join(tmpdir(), "sq-store-"));
  const commonDir = join(dir, ".git");
  mkdirSync(commonDir);
  const runtime = join(dir, "run");
  mkdirSync(runtime, { mode: 0o700 });
  const cleanups: (() => unknown)[] = [];
  return {
    commonDir,
    env: { ...process.env, XDG_RUNTIME_DIR: runtime },
    later: (cleanup) => cleanups.push(cleanup),
    cleanup: async () => {
      for (const cleanup of cleanups.reverse()) await cleanup();
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    },
  };
}

/** A store process started by the test: its pid, its output, how it ended. */
export interface ChildStore {
  readonly pid: number;
  readonly stderr: () => string;
  /** Resolves with its `ended <why>` line's why, or how it exited. */
  readonly ended: Promise<string>;
  stop(): Promise<string>;
}

/**
 * The store process in a process of its own (`child.ts`), as a daemon's
 * would run, its writer in a worker thread; resolves once it serves or
 * ended. Stopped at the end of the test.
 */
export async function storeProcess(
  at: Clone,
  timing: {
    readonly graceMs?: number;
    readonly checkMs?: number;
    readonly reportMs?: number;
    /** A test pause point (`pauseAt`) where it stops itself with SIGSTOP. */
    readonly pauseAt?: string;
  } = {},
): Promise<ChildStore> {
  const args = [
    String(timing.graceMs ?? 300_000),
    String(timing.checkMs ?? 10_000),
    String(timing.reportMs ?? 60_000),
  ];
  const pause = timing.pauseAt === undefined ? [] : ["--import", PAUSE_PRELOAD];
  // `store-process` in its arguments: a relay ends a hung one only when its command line says so.
  const child = spawn(
    process.execPath,
    [...LOADER, ...pause, CHILD, at.commonDir, ...args, "store-process"],
    {
      env: timing.pauseAt === undefined ? at.env : { ...at.env, SQUEAL_TEST_PAUSE: timing.pauseAt },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let out = "";
  let err = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    err += chunk;
  });
  const ended = new Promise<string>((resolve) => {
    child.on("exit", (code, signal) => {
      resolve(/ended (\S+)/.exec(out)?.[1] ?? `exit ${code ?? signal}`);
    });
  });
  const ready = new Promise<void>((resolve) => {
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      out += chunk;
      if (/^(ready|ended)/m.test(out)) resolve();
    });
  });
  await Promise.race([ready, ended]);
  const stop = async () => {
    child.kill("SIGTERM");
    return ended;
  };
  at.later(stop);
  return { pid: child.pid ?? 0, stderr: () => err, ended, stop };
}

/** A daemon's relay for worktree `worktreeId`, its thread run from the sources. */
export function relay(
  at: Clone,
  worktreeId: string,
  options: Partial<CodeRelayOptions> = {},
): CodeRelay {
  // A child store process may be stopped (SIGSTOP) by a test: it is ended within a second.
  const made = new CodeRelay({
    commonDir: at.commonDir,
    worktreeId,
    storeSchema: CODE_SCHEMA_VERSION,
    launch: null,
    env: at.env,
    thread: { script: source("relay-thread.ts"), execArgv: [...LOADER] },
    timing: { hungMs: 1_000 },
    ...options,
  });
  at.later(() => made.close());
  return made;
}

/** The code store as a daemon opens it, its writes through `through`. */
export function openThrough(at: Clone, through: CodeRelay, busyTimeoutMs = 2_000): CodeStore {
  const store = openCodeStore(at.commonDir, ON, { busyTimeoutMs, ...through.codeStoreOptions() });
  if (isCodeStoreOpenFailure(store)) throw new Error(`open failed: ${JSON.stringify(store)}`);
  at.later(() => store.close());
  return store;
}

/**
 * Writes until a batch reached the store process, then zeroes the counts:
 * the relay thread's first start, from the sources under a loaded host,
 * can take longer than a short bound.
 */
export async function warm(through: CodeRelay, store: CodeStore): Promise<void> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    store.meta.set("warm", "1");
    await store.sent();
    if (through.counts.sent > 0) break;
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  Object.assign(through.counts, { sent: 0, direct: 0, superseded: 0, failed: 0 });
  Object.assign(through.counts.fallback, { none: 0, refused: 0, lost: 0, hung: 0 });
}

/** A plain connection to the clone's code store, for a test's own reads and locks. */
export function plain(at: Clone): DatabaseSync {
  const store = openCodeStore(at.commonDir, ON);
  if (isCodeStoreOpenFailure(store)) throw new Error("open failed");
  store.close();
  const db = new DatabaseSync(join(at.commonDir, "squeal", "code.sqlite"));
  db.exec("PRAGMA busy_timeout = 5000");
  at.later(() => db.close());
  return db;
}

/** Waits until `ready` holds, polling; throws after `ms`. */
export async function until(ready: () => boolean, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Whether process `pid` lives. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Another process holds the code store's write lock for `ms` (review of
 * 0.1.571): the test's own thread waits inside a batch, so a holder in this
 * process could never let go. With `userVersion`, it sets the file's
 * schema under the lock, as a newer Squeal's migration would.
 */
export async function holdLock(
  at: Clone,
  ms: number,
  userVersion?: number,
): Promise<{ readonly done: Promise<void> }> {
  const path = join(at.commonDir, "squeal", "code.sqlite");
  const script = `
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(${JSON.stringify(path)});
    db.exec("PRAGMA busy_timeout = 10000");
    db.exec("BEGIN IMMEDIATE");
    ${userVersion === undefined ? "" : `db.exec("PRAGMA user_version = ${userVersion}");`}
    process.stdout.write("held\\n");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${ms});
    db.exec("COMMIT");
  `;
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "-e", script], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const done = new Promise<void>((resolve) => child.on("exit", () => resolve()));
  at.later(() => done);
  await new Promise<void>((resolve) => {
    let out = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      out += chunk;
      if (out.includes("held")) resolve();
    });
    child.on("exit", () => resolve());
  });
  return { done };
}
