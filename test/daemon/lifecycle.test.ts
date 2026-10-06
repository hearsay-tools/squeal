import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ensureDaemon, probeDaemon } from "../../src/core/daemon/ensure.js";
import { SCHEMA_VERSION, storePaths } from "../../src/core/store/index.js";
import { notesMetaKey } from "../../src/core/types/index.js";
import {
  type BuiltCli,
  buildCli,
  createFixtureRepo,
  delay,
  type FixtureRepo,
  LOADED,
  ping,
  readNotes,
  SLOW,
  type SpawnedProcess,
  spawnCli,
  spawnDaemon,
  stopProcess,
  waitFor,
  waitReady,
  withStore,
} from "./helpers.js";

let built: BuiltCli;
beforeAll(() => {
  built = buildCli();
});
afterAll(() => built.cleanup());

const processes: SpawnedProcess[] = [];
const repos: FixtureRepo[] = [];
afterEach(async () => {
  for (const process of processes.splice(0)) await stopProcess(process);
  for (const repo of repos.splice(0)) repo.cleanup();
});

function fixture(files?: Record<string, string>): FixtureRepo {
  const repo = createFixtureRepo(files === undefined ? {} : { files });
  repos.push(repo);
  return repo;
}

function daemon(repo: FixtureRepo): SpawnedProcess {
  const spawned = spawnDaemon(built.cli, repo);
  processes.push(spawned);
  return spawned;
}

describe("squeal daemon: singleton and restart (spec 001 D10)", SLOW, () => {
  it("five concurrent starts yield exactly one serving daemon; the others exit", async () => {
    const repo = fixture();
    const five = Array.from({ length: 5 }, () => daemon(repo));
    const served = await waitFor(() => ping(repo.socketPath, 500), 60_000, "a daemon serving");
    const losers = await Promise.all(
      five.map((p) => Promise.race([p.exited, delay(30_000).then(() => null)])),
    );
    const exited = losers.filter((exit) => exit !== null);
    expect(exited).toHaveLength(4);
    for (const exit of exited) expect(exit).toEqual({ code: 0, signal: null });
    const alive = five.filter((p) => p.child.exitCode === null);
    expect(alive.map((p) => p.child.pid)).toEqual([served.pid]);
    expect(five.filter((p) => p.child.exitCode === 0)[0]?.stderr()).toMatch(
      /another daemon serves/,
    );
    expect((await ping(repo.socketPath, 500))?.pid).toBe(served.pid);
    const record = withStore(repo, (store) => store.worktrees.get(repo.worktreeId));
    expect(record?.daemon?.socketPath).toBe(repo.socketPath);
  });

  it("after SIGKILL a replacement serves soon after its spawn (D10 target 200 ms)", async () => {
    const repo = fixture();
    const first = daemon(repo);
    await waitReady(repo, first);
    first.child.kill("SIGKILL");
    await first.exited;
    // The killed daemon leaves its socket file behind; it refuses connections.
    expect(existsSync(repo.socketPath)).toBe(true);
    const saved = process.env.XDG_RUNTIME_DIR;
    process.env.XDG_RUNTIME_DIR = repo.runtimeDir;
    try {
      expect(await probeDaemon(repo.root, 100)).toEqual({ state: "absent", code: "ECONNREFUSED" });
    } finally {
      if (saved === undefined) delete process.env.XDG_RUNTIME_DIR;
      else process.env.XDG_RUNTIME_DIR = saved;
    }

    const started = performance.now();
    const second = daemon(repo);
    const answer = await waitFor(() => ping(repo.socketPath, 100), 30_000, "replacement");
    const elapsed = performance.now() - started;
    expect(answer.pid).toBe(second.child.pid);
    // The 200 ms target is reported, not asserted: a shared CI runner measured 213 ms.
    console.log(
      `replacement serving ${elapsed.toFixed(0)} ms after spawn (target 200 ms: ${elapsed < 200 ? "met" : "missed"})`,
    );
    if (!LOADED) expect(elapsed).toBeLessThan(1_000);
  });

  it("exits after the idle period with no registered consumers, leaving a note", async () => {
    const repo = fixture({ "squeal.config.json": '{"daemon": {"idleExitMinutes": 0.03}}' });
    const spawned = daemon(repo);
    await waitReady(repo, spawned);
    const exit = await Promise.race([spawned.exited, delay(60_000).then(() => null)]);
    expect(exit).toEqual({ code: 0, signal: null });
    expect(withStore(repo, (store) => store.worktrees.get(repo.worktreeId)?.daemon)).toBeNull();
    expect(readNotes(repo).at(-1)).toMatch(
      /daemon stopped: idle for 1.8 s with no registered consumers/,
    );
    expect(existsSync(repo.socketPath)).toBe(false);
  });

  it("a registered consumer keeps an idle daemon alive", async () => {
    const repo = fixture({ "squeal.config.json": '{"daemon": {"idleExitMinutes": 0.01}}' });
    const spawned = daemon(repo);
    // Registered as soon as the socket answers, as SessionStart does, not after the baseline.
    await waitFor(() => ping(repo.socketPath, 500), 60_000, "a daemon serving");
    withStore(repo, (store) =>
      store.consumers.register(
        { worktreeId: repo.worktreeId, sessionId: "s1", agentId: "main" },
        Date.now(),
      ),
    );
    await waitReady(repo, spawned);
    await delay(2_000);
    expect(spawned.child.exitCode).toBeNull();
    withStore(repo, (store) =>
      store.consumers.unregister({ worktreeId: repo.worktreeId, sessionId: "s1", agentId: "main" }),
    );
    expect(await Promise.race([spawned.exited, delay(30_000).then(() => null)])).toEqual({
      code: 0,
      signal: null,
    });
  });

  it("squeal stop shuts down in order and leaves worktrees.daemon null with its last heartbeat", async () => {
    const repo = fixture();
    const spawned = daemon(repo);
    await waitReady(repo, spawned);
    const record = withStore(repo, (store) => store.worktrees.get(repo.worktreeId));
    expect(record).toMatchObject({
      root: repo.root,
      commonDir: repo.commonDir,
      isMain: true,
      daemon: { socketPath: repo.socketPath, squealVersion: "0.0.0" },
    });
    expect(record?.daemon?.heartbeatAt).toBeGreaterThan(0);

    const stop = spawnCli(built.cli, ["stop"], { cwd: repo.root, env: repo.env });
    expect(await stop.exited).toEqual({ code: 0, signal: null });
    expect(stop.stdout()).toMatch(/stopped/);
    expect(await spawned.exited).toEqual({ code: 0, signal: null });
    const after = withStore(repo, (store) => store.worktrees.get(repo.worktreeId));
    expect(after?.daemon).toBeNull();
    // Review wave 4.5, N5: status says since when no daemon runs.
    expect(after?.lastHeartbeatAt).toBeGreaterThanOrEqual(record?.daemon?.heartbeatAt ?? 0);
    expect(existsSync(repo.socketPath)).toBe(false);
  });

  it("SIGTERM shuts down the same way", async () => {
    const repo = fixture();
    const spawned = daemon(repo);
    await waitReady(repo, spawned);
    spawned.child.kill("SIGTERM");
    expect(await spawned.exited).toEqual({ code: 0, signal: null });
    expect(withStore(repo, (store) => store.worktrees.get(repo.worktreeId)?.daemon)).toBeNull();
  });

  it("exits with a note when the store's user_version is newer than it understands", async () => {
    const repo = fixture();
    const first = daemon(repo);
    await waitReady(repo, first);
    first.child.kill("SIGTERM");
    await first.exited;
    const db = new DatabaseSync(storePaths(repo.commonDir).database);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    db.close();

    const second = daemon(repo);
    expect(await second.exited).toEqual({ code: 1, signal: null });
    expect(second.stderr()).toMatch(/store schema .* newer than this Squeal/);
    const raw = new DatabaseSync(storePaths(repo.commonDir).database);
    const row = raw
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get(notesMetaKey(repo.worktreeId)) as { value: string } | undefined;
    raw.close();
    const texts = (JSON.parse(row?.value ?? "[]") as { text: string }[]).map((n) => n.text);
    expect(texts.at(-1)).toMatch(
      new RegExp(`store schema ${SCHEMA_VERSION + 1} is newer than this Squeal`),
    );
  });

  it("exits when its linked worktree is removed", async () => {
    const repo = fixture();
    const { git } = await import("../hash/git-repo.js");
    const linkedRoot = join(repo.root, "..", "linked");
    git(repo.root, ["worktree", "add", "-q", "-b", "linked", linkedRoot]);
    const linked: FixtureRepo = { ...repo, ...(await linkedRepo(repo, linkedRoot)) };
    const spawned = spawnDaemon(built.cli, linked);
    processes.push(spawned);
    await waitReady(linked, spawned);
    git(repo.root, ["worktree", "remove", "--force", linkedRoot]);
    expect(await Promise.race([spawned.exited, delay(30_000).then(() => null)])).toEqual({
      code: 0,
      signal: null,
    });
    expect(withStore(repo, (store) => store.worktrees.get(linked.worktreeId)?.daemon)).toBeNull();
  });
});

async function linkedRepo(repo: FixtureRepo, root: string) {
  const { realpathSync } = await import("node:fs");
  const { worktreeIdFor } = await import("../../src/core/store/index.js");
  const { socketPathFor } = await import("../../src/core/daemon/paths.js");
  const real = realpathSync(root);
  const worktreeId = worktreeIdFor(real);
  return {
    root: real,
    worktreeId,
    socketPath: socketPathFor(worktreeId, { XDG_RUNTIME_DIR: repo.runtimeDir }),
  };
}

describe("ensureDaemon (spec 001 D10, for the hooks of 001-31)", SLOW, () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("spawns on a cold start without waiting, and finds it alive on a warm one", async () => {
    const repo = fixture();
    process.env.XDG_RUNTIME_DIR = repo.runtimeDir;
    process.env.SQUEAL_CLI = built.cli;
    expect(await probeDaemon(repo.root, 100)).toEqual({ state: "absent", code: "ENOENT" });

    const started = performance.now();
    expect(await ensureDaemon(repo.root)).toBe("spawned");
    const elapsed = performance.now() - started;
    if (!LOADED) expect(elapsed).toBeLessThan(150);

    const answer = await waitFor(() => ping(repo.socketPath, 100), 30_000, "spawned daemon");
    expect(await ensureDaemon(repo.root)).toBe("alive");
    expect(await probeDaemon(repo.root, 100)).toMatchObject({
      state: "alive",
      ping: { pid: answer.pid, worktreeId: repo.worktreeId, root: repo.root },
    });
    await waitReady(repo);
    process.kill(answer.pid, "SIGTERM");
    await waitFor(
      () => withStore(repo, (store) => store.worktrees.get(repo.worktreeId)?.daemon === null),
      60_000,
      "spawned daemon stopped",
    );
  });

  it("is unavailable when the CLI entry does not exist or the root is not a directory", async () => {
    const repo = fixture();
    process.env.XDG_RUNTIME_DIR = repo.runtimeDir;
    process.env.SQUEAL_CLI = join(repo.root, "no-such-cli.js");
    expect(await ensureDaemon(repo.root)).toBe("unavailable");
    expect(await ensureDaemon(join(repo.root, "missing"))).toBe("unavailable");
  });

  it("squeal start spawns the daemon and prints its status", async () => {
    const repo = fixture();
    writeFileSync(join(repo.root, ".keep"), "");
    const start = spawnCli(built.cli, ["start"], { cwd: repo.root, env: repo.env });
    expect(await start.exited).toEqual({ code: 0, signal: null });
    expect(start.stdout()).toMatch(/^Squeal daemon spawned for /m);
    expect(start.stdout()).toMatch(/Revision: \d+/);
    const answer = await ping(repo.socketPath, 500);
    expect(answer).not.toBeNull();
    const again = spawnCli(built.cli, ["start", repo.root], { cwd: "/", env: repo.env });
    expect(await again.exited).toEqual({ code: 0, signal: null });
    expect(again.stdout()).toMatch(/^Squeal daemon alive for /m);
    if (answer !== null) {
      process.kill(answer.pid, "SIGTERM");
      await waitFor(async () => (await ping(repo.socketPath)) === null, 60_000, "stopped");
    }
  });
});
