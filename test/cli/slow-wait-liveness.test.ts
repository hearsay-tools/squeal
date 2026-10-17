import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import type { DaemonSync } from "../../src/cli/status-sync.js";
import { waitForStatus } from "../../src/cli/status-wait.js";
import { waitForNamed } from "../../src/cli/status-wait-paths.js";
import { watchDaemon } from "../../src/cli/wait-liveness.js";
import { socketPathFor } from "../../src/core/daemon/index.js";
import type { DaemonRecord, EpochMs, Store, WorktreeId } from "../../src/core/types/index.js";
import { closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";
import { finish, INCARNATION, NOW, repoWith, SLOW_FILE } from "./status-wait-fixture.js";

/*
 * Task 004-66 (issue 12, spec 004 D9 with 011 C9): a requested slow wait
 * ended "no daemon" at the first stale heartbeat while the daemon was alive,
 * held up by another connection's store write lock. It now asks the socket:
 * a daemon there keeps the wait going, and the line says its heartbeat
 * lapsed; a stopped daemon ends it with the reason, and `run --slow --wait`
 * exits 3 without a verdict.
 */

const saved = { ...process.env };
let runtimeDir: string;
const timers: NodeJS.Timeout[] = [];
const hung: Server[] = [];

beforeEach(() => {
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
  delete process.env.CLAUDE_CODE_SESSION_ID;
  delete process.env.CODEX_SESSION_ID;
});

afterEach(() => {
  for (const timer of timers.splice(0)) clearTimeout(timer);
  for (const server of hung.splice(0)) server.close();
  closeFakeDaemons();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

/** The daemon's heartbeat, 20 s old by the CLI's clock: the store's write lock held it back. */
const STALE_AT = NOW - 20_000;

function heartbeat(store: Store, worktreeId: string, at: number | null) {
  const row = store.worktrees.get(worktreeId);
  if (row === null || row.daemon === null) throw new Error("no daemon recorded");
  const daemon: DaemonRecord | null = at === null ? null : { ...row.daemon, heartbeatAt: at };
  store.worktrees.upsert({ ...row, daemon, lastHeartbeatAt: row.daemon.heartbeatAt });
}

/** A worktree whose slow file is queued, a daemon that took `run --slow`, and a stale heartbeat. */
async function staleQueue() {
  const { repo, store } = repoWith([SLOW_FILE]);
  writeFileSync(
    join(repo.main, "squeal.config.json"),
    JSON.stringify({ slow: { include: [SLOW_FILE] } }),
  );
  const seen = await fakeDaemon(socketPathFor(repo.mainId), {
    "run-slow": [
      {
        ok: true,
        type: "run-slow",
        requestId: "s1",
        requested: { revision: 4, queued: 1 },
        error: null,
      },
    ],
    sync: [
      {
        ok: true,
        type: "sync",
        requestId: "y1",
        revision: 4,
        error: null,
        moves: true,
        incarnation: INCARNATION,
      },
    ],
  });
  heartbeat(store, repo.mainId, STALE_AT);
  return { repo, store, seen };
}

/** Runs `fn` `ms` after the wait asked for its sync, past its first read. */
function onceWaiting(seen: readonly string[], ms: number, fn: () => void): () => boolean {
  let ran = false;
  const poll = setInterval(() => {
    if (!seen.includes("sync")) return;
    clearInterval(poll);
    timers.push(
      setTimeout(() => {
        fn();
        ran = true;
      }, ms),
    );
  }, 20);
  timers.push(poll);
  return () => ran;
}

async function run(argv: string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
    now: () => NOW,
    env: {},
  };
  const code = await main(argv, io);
  return { code, stdout, stderr };
}

const LAPSE =
  "the daemon's heartbeat went 20 s stale while its socket showed it alive (a busy store or a stalled daemon), so the wait went on";
/** Issue 26: the wait's verdict is its output's last line. */
const last = (text: string) => text.trimEnd().split("\n").at(-1) ?? "";

const unsupported = (): DaemonSync => ({
  current: () => ({ state: "unsupported" }),
  stop: () => {},
});

describe("watchDaemon (004-66)", () => {
  it("keeps the lapse a socket check found when the heartbeat recovers before the next read (review wave-1.8 S1)", async () => {
    const id = "lapse-recovers" as WorktreeId;
    const socketPath = socketPathFor(id);
    await fakeDaemon(socketPath, {});
    const watch = watchDaemon(id);
    const record: DaemonRecord = {
      socketPath,
      startedAt: (NOW - 60_000) as EpochMs,
      heartbeatAt: STALE_AT as EpochMs,
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0-test",
      token: "t",
    };
    expect(watch.judge(record, NOW as EpochMs)).toEqual({ state: "lapsed" });
    await until(() => watch.lapse() !== null);
    expect(watch.judge({ ...record, heartbeatAt: NOW as EpochMs }, NOW as EpochMs)).toEqual({
      state: "alive",
    });
    expect(watch.lapse()).toEqual({ staleMs: 20_000 });
  });
});

async function until(ready: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !ready(); i++) await new Promise((r) => setTimeout(r, 10));
}

describe("a requested slow wait through a stale heartbeat (004-66)", { timeout: 30_000 }, () => {
  it("goes on while the daemon answers on its socket, finishes, and says the heartbeat lapsed", async () => {
    const { repo, store, seen } = await staleQueue();
    // Well past the settle time, as the issue's lock lasted: the wait must not end on the lapse.
    const finished = onceWaiting(seen, 2_000, () => {
      finish(store, repo.mainId, SLOW_FILE);
      heartbeat(store, repo.mainId, NOW - 1_000);
    });

    const result = await run(["run", "--slow", "--wait", "20000"], repo.main);

    expect(finished()).toBe(true);
    expect(result.code).toBe(0);
    const line = last(result.stdout);
    expect(line).toMatch(/^Returned on quiet: /);
    expect(line).toContain(
      `the 1 slow file run --slow queued has its result; ${LAPSE}. Worktree: `,
    );
    // Recovery with no competing run: one request, nothing restarted.
    expect(seen.filter((type) => type === "run-slow")).toHaveLength(1);
    expect(seen).not.toContain("stop");
  });

  it("gives a named slow file's verdict after the lapse", async () => {
    const { repo, store, seen } = await staleQueue();
    const finished = onceWaiting(seen, 1_500, () => finish(store, repo.mainId, SLOW_FILE));
    // The heartbeat comes back later: the verdict waits for it.
    onceWaiting(seen, 2_500, () => heartbeat(store, repo.mainId, NOW - 1_000));

    const result = await run(["status", "--wait", "20000", SLOW_FILE], repo.main);

    expect(finished()).toBe(true);
    expect(result.code).toBe(0);
    expect(last(result.stdout)).toMatch(
      new RegExp(
        `^Named test files at revision 4: [^\\n]*; ${LAPSE.replace(/[()]/g, "\\$&")}\\. Worktree: `,
      ),
    );
  });

  it("treats a socket that accepts and never answers as a stalled daemon, not a stopped one", async () => {
    const { repo, store } = repoWith([SLOW_FILE]);
    heartbeat(store, repo.mainId, STALE_AT);
    const server = createServer(() => {});
    hung.push(server);
    await new Promise<void>((resolve) => server.listen(socketPathFor(repo.mainId), resolve));

    const wait = await waitForNamed(repo.main, [SLOW_FILE], {
      timeoutMs: 3_000,
      pollMs: 50,
      settleMs: 0,
      now: () => NOW,
      sync: unsupported,
      downMs: 0,
    });

    expect(wait.outcome).toBe("timeout");
  });
});

describe("a requested slow wait whose daemon stopped (004-66)", { timeout: 30_000 }, () => {
  it("says the daemon stopped and exits 3 without a verdict", async () => {
    const { repo, store, seen } = await staleQueue();
    heartbeat(store, repo.mainId, NOW - 1_000);
    // `squeal stop`: the daemon clears its record and its socket goes.
    onceWaiting(seen, 300, () => {
      closeFakeDaemons();
      heartbeat(store, repo.mainId, null);
    });

    const result = await run(["run", "--slow", "--wait", "20000"], repo.main);

    expect(result.code).toBe(3);
    expect(last(result.stdout)).toMatch(
      `Returned without a daemon: no daemon has validated since ${new Date(NOW - 1_000).toISOString()}: the daemon stopped; results are as of revision 4. Worktree: `,
    );
  });

  it("ends once a stale heartbeat's socket stayed dead for the down bound, naming that", async () => {
    const { repo, store } = repoWith([SLOW_FILE]);
    // Just past the 10 s grace: the bound runs from the wait's first dead socket.
    heartbeat(store, repo.mainId, NOW - 10_100);

    const started = performance.now();
    const wait = await waitForStatus(repo.main, {
      timeoutMs: 10_000,
      pollMs: 50,
      settleMs: 0,
      now: () => NOW,
      sync: unsupported,
      downMs: 1_000,
    });

    expect(wait.outcome).toBe("no-daemon");
    if (wait.outcome === "unavailable") throw new Error("unavailable");
    expect(wait.down).toBe("silent");
    expect(performance.now() - started).toBeGreaterThanOrEqual(800);
    expect(wait.lapse).toBeUndefined();
  });

  it("ends at once on a daemon whose heartbeat stopped long before the wait", async () => {
    const { repo, store } = repoWith([SLOW_FILE]);
    heartbeat(store, repo.mainId, NOW - 60_000);

    const started = performance.now();
    const wait = await waitForNamed(repo.main, [SLOW_FILE], {
      timeoutMs: 10_000,
      pollMs: 50,
      settleMs: 0,
      now: () => NOW,
      sync: unsupported,
    });

    expect(wait.outcome).toBe("no-daemon");
    if (wait.outcome === "unavailable") throw new Error("unavailable");
    expect(wait.down).toBe("silent");
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});
