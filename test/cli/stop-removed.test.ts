import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { askDaemon } from "../../src/cli/daemon-access.js";
import type { CliIo } from "../../src/cli/main.js";
import { type StopBounds, stopCommand } from "../../src/cli/stop.js";
import { socketPathFor } from "../../src/core/daemon/index.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { isStoreOpenFailure, lockFileFor, openStore } from "../../src/core/store/index.js";
import type { AbsolutePath, EpochMs, WorktreeId } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { removedNoDaemonLine } from "./stop-lines.js";

/*
 * Row 011-277 (gh-126, C1, C9, C14): `squeal stop <root>` after the root is
 * removed stops that worktree's own daemon and the processes it started, by
 * the identity the path had: its worktree id, the socket of that id, and the
 * daemon record its store keeps. It never stops another worktree's daemon,
 * and it says whether the daemon and its processes stopped, still run, or
 * cannot be told.
 */

const saved = { ...process.env };
let dir: string;
const servers: Server[] = [];
const groups: number[] = [];
const pids: number[] = [];

beforeEach(() => {
  dir = realpathSync(mkdtempSync("/tmp/sq-"));
  process.env.XDG_RUNTIME_DIR = dir;
});

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  for (const group of groups.splice(0)) kill(-group);
  for (const pid of pids.splice(0)) kill(pid);
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...saved };
});

const BOUNDS: StopBounds = { socketMs: 10_000, lockMs: 10_000, leftoversMs: 10_000 };
const SHORT: StopBounds = { socketMs: 10_000, lockMs: 10_000, leftoversMs: 400 };

interface Worktree {
  readonly root: AbsolutePath;
  readonly id: WorktreeId;
  /** Its store record's daemon start and token. */
  readonly startedAt: number;
  readonly token: string;
}

/**
 * A checkout and two linked worktrees beside it, as the issue's fixture had,
 * with their store rows; `nested`, A lies inside the checkout instead.
 */
function fixture(nested = false): {
  main: AbsolutePath;
  commonDir: AbsolutePath;
  a: Worktree;
  b: Worktree;
} {
  const main = join(dir, "main");
  mkdirSync(main);
  git(main, ["init", "-q"]);
  writeFileSync(join(main, "a.txt"), "a\n");
  git(main, ["add", "a.txt"]);
  git(main, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "a"]);
  const commonDir = join(main, ".git") as AbsolutePath;
  const worktree = (name: string, startedAt: number, inside = false): Worktree => {
    const root = join(inside ? join(main, ".worktrees") : dir, name) as AbsolutePath;
    git(main, ["worktree", "add", "-q", root]);
    return { root, id: worktreeIdFor(root), startedAt, token: `token-${name}` };
  };
  const a = worktree("wt-a", 101, nested);
  const b = worktree("wt-b", 102);
  const store = openStore(commonDir, { create: true });
  if (isStoreOpenFailure(store)) throw new Error("no store");
  try {
    for (const w of [a, b]) {
      store.worktrees.upsert({
        id: w.id,
        root: w.root,
        commonDir,
        isMain: false,
        registeredAt: 1 as EpochMs,
        daemon: null,
      });
      store.worktrees.setDaemon(w.id, {
        socketPath: socketPathFor(w.id),
        startedAt: w.startedAt as EpochMs,
        heartbeatAt: Date.now() as EpochMs,
        heartbeatIntervalMs: 5_000,
        squealVersion: "0.0.0-test",
        token: w.token,
      });
    }
  } finally {
    store.close();
  }
  mkdirSync(join(commonDir, "squeal", "locks"), { recursive: true });
  return { main, commonDir, a, b };
}

/*
 * A stand-in daemon process: it holds its worktree's lock file open, starts
 * a test process carrying its token, answers ping and stop on its socket,
 * and on stop ends its test process and exits, unless told to leave it.
 */
const DAEMON = `
const net = require("node:net");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const [socketPath, lockPath, root, worktreeId, startedAt, token, leaves] = process.argv.slice(1);
if (lockPath !== "-") fs.openSync(lockPath, "w");
const test = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  env: { ...process.env, SQUEAL_DAEMON_CHILD: token + ":vitest" },
  stdio: "ignore",
});
const server = net.createServer((socket) => {
  socket.once("data", (data) => {
    const { type } = JSON.parse(data.toString());
    const base = { schemaVersion: 1, ok: true, type };
    const ping = { pid: process.pid, worktreeId, root, squealVersion: "0.0.0-test", phase: "ready", startedAt: Number(startedAt) };
    socket.end(JSON.stringify(type === "ping" ? { ...base, ...ping } : base) + "\\n");
    if (type !== "stop") return;
    server.close();
    if (leaves === "leaves") return setTimeout(() => process.exit(0), 50);
    test.once("exit", () => process.exit(0));
    test.kill("SIGKILL");
  });
});
server.listen(socketPath, () => process.stdout.write("ready " + test.pid + "\\n"));
`;

interface Running {
  readonly pid: number;
  readonly test: number;
}

interface DaemonOptions {
  /** It leads a process group of its own, as a hook's detached spawn makes it. */
  readonly leads?: boolean;
  /** It holds its lock file open, which ties it to its store. */
  readonly locks?: boolean;
  /** Its test process outlives it. */
  readonly leaves?: boolean;
  readonly startedAt?: number;
}

/** Starts the stand-in daemon of `w`; its pid and its test process's, once it serves. */
function daemonOf(w: Worktree, commonDir: AbsolutePath, options: DaemonOptions = {}) {
  const { leads = true, locks = true, leaves = false } = options;
  const startedAt = options.startedAt ?? w.startedAt;
  const lock = locks ? lockFileFor(commonDir, w.id) : "-";
  const args = [socketPathFor(w.id), lock, w.root, w.id, String(startedAt), w.token];
  const child = spawn(process.execPath, ["-e", DAEMON, ...args, leaves ? "leaves" : "stays"], {
    cwd: dir,
    detached: leads,
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (child.pid !== undefined) (leads ? groups : pids).push(child.pid);
  return new Promise<Running>((resolve, reject) => {
    child.once("error", reject);
    child.stdout?.once("data", (data: Buffer) => {
      const test = Number(/ready (\d+)/.exec(data.toString())?.[1]);
      if (!leads) pids.push(test);
      resolve({ pid: child.pid as number, test });
    });
  });
}

async function stop(args: string[], bounds: StopBounds = BOUNDS, cwd = dir) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    env: {},
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
  };
  const code = await stopCommand(args, io, bounds);
  return { code, stdout, stderr };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function kill(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

/**
 * Review 0.1.383 B1: the caller runs with another runtime dir than the
 * daemons did, so the socket it computes is not the one their store records.
 */
function elsewhere(): void {
  const runtime = join(dir, "new");
  mkdirSync(runtime);
  process.env.XDG_RUNTIME_DIR = runtime;
}

/** The store records the daemon of `w` with its last heartbeat at `at`, long past the grace. */
function lateHeartbeat(commonDir: AbsolutePath, w: Worktree, at: number): void {
  const store = openStore(commonDir, { create: false });
  if (isStoreOpenFailure(store)) throw new Error("no store");
  try {
    const daemon = store.worktrees.get(w.id)?.daemon;
    if (daemon == null) throw new Error("no record");
    store.worktrees.setDaemon(w.id, { ...daemon, heartbeatAt: at as EpochMs });
  } finally {
    store.close();
  }
}

/** A socket file at `path` that nobody accepts on: its daemon was killed before it could unlink it. */
function staleSocket(path: string): void {
  const script = `require("node:net").createServer().listen(${JSON.stringify(path)}, () => process.kill(process.pid, "SIGKILL"))`;
  spawnSync(process.execPath, ["-e", script]);
}

describe("squeal stop <root> after the root is removed (row 011-277, gh-126)", () => {
  it("stops the removed worktree's daemon and its test while the other worktree's go on", async () => {
    const { commonDir, a, b } = fixture();
    const daemonA = await daemonOf(a, commonDir);
    const daemonB = await daemonOf(b, commonDir);
    rmSync(a.root, { recursive: true, force: true });
    expect(alive(daemonA.test)).toBe(true);

    const result = await stop([a.root]);

    expect(result).toEqual({
      code: 0,
      stdout: `Squeal daemon stopped for ${a.root}, which does not exist, and no process it started still runs\n`,
      stderr: "",
    });
    expect(alive(daemonA.pid)).toBe(false);
    expect(alive(daemonA.test)).toBe(false);
    const ping = await askDaemon(socketPathFor(b.id), { type: "ping" });
    expect(ping).toMatchObject({ ok: true, pid: daemonB.pid, root: b.root });
    expect(alive(daemonB.test)).toBe(true);
  });

  it("names a test process the store's token marks that outlives the daemon", async () => {
    const { commonDir, a } = fixture();
    // Not a group leader: only the token its store records ties the test process to it.
    const daemonA = await daemonOf(a, commonDir, { leads: false, leaves: true });
    rmSync(a.root, { recursive: true, force: true });

    const result = await stop([a.root], SHORT);

    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(
      new RegExp(
        `^Stop requested; the daemon for ${literal(a.root)} stopped, but a process it started still runs after 0\\.4 s: pid ${daemonA.test} .*setInterval`,
      ),
    );
    expect(alive(daemonA.test)).toBe(true);
  });

  it("uses no token of another start: the record's daemon is not the one serving", async () => {
    const { commonDir, a } = fixture();
    const daemonA = await daemonOf(a, commonDir, { leads: false, leaves: true, startedAt: 999 });
    rmSync(a.root, { recursive: true, force: true });

    const result = await stop([a.root], SHORT);

    expect(result).toEqual({
      code: 1,
      stdout: `Squeal daemon stopped for ${a.root}, which does not exist; whether a process it started still runs is unknown: it leads no process group, and no token of this start was found\n`,
      stderr: "",
    });
    expect(alive(daemonA.pid)).toBe(false);
  });

  it("says unknown when nothing ties the daemon to its store or its processes", async () => {
    const { commonDir, a } = fixture();
    await daemonOf(a, commonDir, { leads: false, locks: false });
    rmSync(a.root, { recursive: true, force: true });

    const result = await stop([a.root], SHORT);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe(
      `Squeal daemon stopped for ${a.root}, which does not exist; whether a process it started still runs is unknown: it leads no process group, and no token of this start was found\n`,
    );
  });

  it("stops nothing when the removed worktree's daemon already exited, its socket gone or left behind", async () => {
    const { main, commonDir, a, b } = fixture();
    const daemonB = await daemonOf(b, commonDir);
    rmSync(a.root, { recursive: true, force: true });
    const none = { code: 0, stdout: removedNoDaemonLine(a.root), stderr: "" };

    // Run from the checkout, as an orchestrator does: its store keeps A's row.
    expect(await stop([a.root], BOUNDS, main)).toEqual(none);
    staleSocket(socketPathFor(a.id));
    expect(await stop([a.root], BOUNDS, main)).toEqual(none);
    expect(alive(daemonB.pid)).toBe(true);
    expect(alive(daemonB.test)).toBe(true);
  });

  it("asks the socket the store records while its heartbeat is fresh, not the one this environment computes", async () => {
    const { main, commonDir, a, b } = fixture();
    const daemonA = await daemonOf(a, commonDir);
    const daemonB = await daemonOf(b, commonDir);
    const socketB = socketPathFor(b.id);
    rmSync(a.root, { recursive: true, force: true });
    elsewhere();

    expect(await stop([a.root], BOUNDS, main)).toEqual({
      code: 0,
      stdout: `Squeal daemon stopped for ${a.root}, which does not exist, and no process it started still runs\n`,
      stderr: "",
    });
    expect(alive(daemonA.pid)).toBe(false);
    expect(alive(daemonA.test)).toBe(false);
    const ping = await askDaemon(socketB, { type: "ping" });
    expect(ping).toMatchObject({ ok: true, pid: daemonB.pid, root: b.root });
    expect(alive(daemonB.test)).toBe(true);
  });

  it("never says no daemon runs while the socket a late heartbeat records is in use", async () => {
    const { main, commonDir, a, b } = fixture();
    const daemonA = await daemonOf(a, commonDir);
    const daemonB = await daemonOf(b, commonDir);
    const recorded = socketPathFor(a.id);
    const at = Date.now() - 60_000;
    lateHeartbeat(commonDir, a, at);
    rmSync(a.root, { recursive: true, force: true });
    elsewhere();

    expect(await stop([a.root], BOUNDS, main)).toEqual({
      code: 1,
      stdout: "",
      stderr: `squeal: whether a daemon serves ${a.root} is unknown: ${recorded}, the socket its store records, is in use, but the heartbeat it records is late, last at ${new Date(at).toISOString()}; nothing stopped\n`,
    });
    expect(alive(daemonA.pid)).toBe(true);
    expect(alive(daemonB.pid)).toBe(true);
  });

  it("says no daemon runs once the socket a late heartbeat records is asked and nothing answers", async () => {
    const { main, commonDir, a } = fixture();
    lateHeartbeat(commonDir, a, Date.now() - 60_000);
    staleSocket(socketPathFor(a.id));
    rmSync(a.root, { recursive: true, force: true });
    elsewhere();

    expect(await stop([a.root], BOUNDS, main)).toEqual({
      code: 0,
      stdout: removedNoDaemonLine(a.root),
      stderr: "",
    });
  });

  it("finds the kept row through the checkout a removed worktree lay inside", async () => {
    const { a } = fixture(true);
    rmSync(a.root, { recursive: true, force: true });

    expect(await stop([a.root])).toEqual({
      code: 0,
      stdout: removedNoDaemonLine(a.root),
      stderr: "",
    });
  });

  it("keeps task 011-09's refusal for a missing path no store it can read knows", async () => {
    const { main, a } = fixture();
    rmSync(a.root, { recursive: true, force: true });
    const typo = join(dir, "wt-typo");
    const refused = (path: string) => ({
      code: 1,
      stdout: "",
      stderr: `squeal: ${path} does not exist; nothing stopped\n`,
    });

    expect(await stop([typo], BOUNDS, main)).toEqual(refused(typo));
    // Beside the checkout and run from outside it, A's row is in a store nothing names.
    expect(await stop([a.root], BOUNDS, dir)).toEqual(refused(a.root));
  });

  it("refuses --until-start for a path that does not exist: no worktree is there to hold", async () => {
    const { commonDir, a } = fixture();
    const daemonA = await daemonOf(a, commonDir);
    rmSync(a.root, { recursive: true, force: true });
    const notYet = join(dir, "wt-c");

    for (const path of [a.root, notYet]) {
      expect(await stop(["--until-start", path])).toEqual({
        code: 1,
        stdout: "",
        stderr: `squeal: ${path} does not exist, so there is no worktree to hold; create it first, or drop --until-start to stop the daemon of a removed one; nothing stopped\n`,
      });
    }
    expect(alive(daemonA.pid)).toBe(true);
  });

  it("refuses a daemon at the removed path's socket that serves another root", async () => {
    const { a, b } = fixture();
    rmSync(a.root, { recursive: true, force: true });
    const asked: string[] = [];
    await new Promise<void>((resolve) => {
      const server = createServer((socket) => {
        socket.once("data", (data) => {
          const { type } = JSON.parse(data.toString()) as { type: string };
          asked.push(type);
          const ping = { pid: process.pid, worktreeId: b.id, root: b.root, startedAt: 1 };
          const answer = { schemaVersion: 1, ok: true, type, squealVersion: "0", phase: "ready" };
          socket.end(`${JSON.stringify({ ...answer, ...ping })}\n`);
        });
      });
      servers.push(server);
      server.listen(socketPathFor(a.id), () => resolve());
    });

    const result = await stop([a.root]);

    expect(result).toEqual({
      code: 1,
      stdout: "",
      stderr: `squeal: the daemon at ${socketPathFor(a.id)} serves ${b.root}, not ${a.root}; nothing stopped\n`,
    });
    expect(asked).toEqual(["ping"]);
  });
});

function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
