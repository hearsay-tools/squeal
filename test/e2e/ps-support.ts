import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { expect } from "vitest";
import { currentUid, socketPathFor } from "../../src/core/daemon/paths.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import type { PsDaemon, PsSnapshot } from "../../src/core/ps/shape.js";
import type { ProcessRow, PsSource } from "../../src/core/ps/source.js";
import { type BundleRun, runNode } from "../harness/bundle-helpers.js";
import { type E2E, until } from "./harness.js";

/*
 * Spec 014 Testing, Integration and No side effects (task 014-14): how
 * `ps.test.ts` drives a fixture daemon and the shipped `squeal ps`. The
 * hooks, the daemon they spawn and every `squeal ps` get HOME and TMPDIR
 * under the fixture, beside its private XDG_RUNTIME_DIR, so nothing of
 * theirs reaches the real HOME. The host's other daemons share /proc, so a
 * case reads the fixture daemon's entries only, by its pid or with `--repo`,
 * or reads a table of the test's own processes (`ownProcesses`).
 */

/** HOME and TMPDIR under the fixture's directory. */
export function scratchEnv(e: E2E): Record<string, string> {
  const env = { HOME: join(e.base, "home"), TMPDIR: join(e.base, "tmp") };
  for (const dir of Object.values(env)) mkdirSync(dir, { recursive: true });
  return env;
}

/** The fixture's session started under `env`; its daemon's pid once it pings ready. */
export async function startDaemon(e: E2E, env: Readonly<Record<string, string>>): Promise<number> {
  const start = await e.hook("session-start", e.main, {}, env);
  expect(start).toMatchObject({ code: 0, stderr: "" });
  return (await e.daemonReady(e.main)).pid;
}

/** The fixture daemon's socket, as the daemon names it in the private runtime directory. */
export function socketOf(e: E2E): string {
  return socketPathFor(worktreeIdFor(e.main), { XDG_RUNTIME_DIR: e.runtime });
}

/** The shipped CLI's `squeal ps <args>`, as `bin/squeal` runs it, in `cwd`. */
export function shippedPs(
  e: E2E,
  env: Readonly<Record<string, string>>,
  args: readonly string[],
  cwd: string = e.main,
): Promise<BundleRun> {
  const cli = join(e.plugin, "dist/cli/squeal.mjs");
  const all = { XDG_RUNTIME_DIR: e.runtime, ...env };
  return runNode(["--disable-warning=ExperimentalWarning", cli, "ps", ...args], "", all, cwd);
}

export interface PsJson {
  readonly code: number | null;
  readonly shape: PsSnapshot;
}

/** `squeal ps --json <args>` of the shipped CLI, parsed; stderr must be empty. */
export async function psJson(
  e: E2E,
  env: Readonly<Record<string, string>>,
  args: readonly string[] = [],
  cwd?: string,
): Promise<PsJson> {
  const run = await shippedPs(e, env, ["--json", ...args], cwd);
  expect(run.stderr).toBe("");
  return { code: run.code, shape: JSON.parse(run.stdout) as PsSnapshot };
}

/** The daemon `pid` as the snapshot lists it; `null` when it lists none. */
export function daemonIn(shape: PsSnapshot, pid: number): PsDaemon | null {
  return shape.repositories.flatMap((r) => r.daemons).find((d) => d.pid === pid) ?? null;
}

/** Runs `body` while `pid`, a daemon the test started, is stopped; continues it whatever happens. */
export async function whileStopped<T>(pid: number, body: () => Promise<T>): Promise<T> {
  process.kill(pid, "SIGSTOP");
  try {
    await until(`daemon ${pid} stopped`, 5_000, async () => (stateOf(pid) === "T" ? true : null));
    return await body();
  } finally {
    process.kill(pid, "SIGCONT");
  }
}

/** SIGKILL to `pid`, a daemon the test started; resolves once it is gone from /proc. */
export async function killed(pid: number): Promise<void> {
  process.kill(pid, "SIGKILL");
  await until(`daemon ${pid} gone`, 10_000, async () => {
    const state = stateOf(pid);
    return state === null || state === "Z" ? true : null;
  });
}

/** Field 3 of `/proc/<pid>/stat`; `null` when the process is gone. */
function stateOf(pid: number): string | null {
  return statOf(pid)?.state ?? null;
}

function statOf(pid: number): { state: string; ppid: number } | null {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch {
    // Gone: there is no stat to read.
    return null;
  }
  // The name in parentheses may hold spaces; the fields after its last `)` do not.
  const [state = "", ppid = "0"] = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  return { state, ppid: Number(ppid) };
}

/** The pids above `pid` in the ppid tree, nearest first, read from /proc as `ps` does not. */
export function ancestors(pid: number): number[] {
  const above: number[] = [];
  for (let at = statOf(pid)?.ppid ?? 0; at > 1; at = statOf(at)?.ppid ?? 0) above.push(at);
  return above;
}

export interface FileState {
  readonly sha256: string;
  readonly size: number;
  readonly mtimeMs: number;
}

/** The content hash, size and mtime of each of `paths`, `null` for one that does not exist. */
export function filesState(paths: readonly string[]): Record<string, FileState | null> {
  return Object.fromEntries(
    paths.map((path) => {
      if (!existsSync(path)) return [path, null];
      const bytes = readFileSync(path);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      return [path, { sha256, size: bytes.length, mtimeMs: statSync(path).mtimeMs }];
    }),
  );
}

/** The store files of the fixture's common directory: the database, its WAL and its index. */
export function storeFiles(e: E2E): string[] {
  const dir = join(e.main, ".git/squeal");
  return readdirSync(dir)
    .filter((name) => name.startsWith("store.sqlite"))
    .sort()
    .map((name) => join(dir, name));
}

export interface CountingSocket {
  readonly path: string;
  /** The connections it accepted so far. */
  connections(): number;
  close(): Promise<void>;
}

/** A unix socket of the test's own that listens at `path` and counts every connection. */
export function countingSocket(path: string): Promise<CountingSocket> {
  let count = 0;
  const server = createServer((socket) => {
    count += 1;
    socket.destroy();
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () =>
      resolve({
        path,
        connections: () => count,
        close: () => new Promise((done) => server.close(() => done())),
      }),
    );
  });
}

/**
 * `source` with `reads` in place of its own. Every other read is the
 * source's own, bound to it: a `ProcSource`'s methods read its private
 * fields, which an object spread does not copy.
 */
function overriding(source: PsSource, reads: Partial<PsSource>): PsSource {
  return new Proxy(source, {
    get(target, key) {
      if (Object.hasOwn(reads, key)) return Reflect.get(reads, key);
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * `source` whose table of every process holds `pids` alone, the test's own
 * processes, so no other daemon of the host is a premise of the case: one
 * whose root or repository cannot be read makes every temp key unknown (D7,
 * `reviews/wave-3.md` S1). Working directories and arguments are read for real.
 */
export function ownProcesses(source: PsSource, pids: readonly number[]): PsSource {
  return overriding(source, { processTable: (only) => source.processTable(only ?? pids) });
}

/** Past the kernel's largest `pid_max` (2^22), so no process has it. */
const UNKNOWN_DAEMON = 2_147_483_000;

/** `source` with one more daemon of this user, whose root is relative: unknown (D2 step 2). */
export function withUnknownDaemon(source: PsSource): PsSource {
  const row: ProcessRow = {
    pid: UNKNOWN_DAEMON,
    ppid: 1,
    pgid: UNKNOWN_DAEMON,
    comm: "node",
    state: "S",
    startTicks: 0,
    cpuTicks: 0,
    nice: 0,
    uid: currentUid(),
  };
  const args = ["node", "/opt/squeal/dist/cli/squeal.mjs", "daemon", "relative/root"];
  return overriding(source, {
    processTable: (pids) => {
      const table = new Map(source.processTable(pids));
      if (pids === undefined || pids.includes(UNKNOWN_DAEMON)) table.set(UNKNOWN_DAEMON, row);
      return table;
    },
    cmdline: (pid) => (pid === UNKNOWN_DAEMON ? args : source.cmdline(pid)),
  });
}
