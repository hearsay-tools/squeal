import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import type { CliIo } from "../../src/cli/main.js";
import { startCommand } from "../../src/cli/start.js";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { acquireDaemonLock } from "../../src/core/daemon/lock.js";
import {
  claimHandoff,
  clearHandoff,
  handoffFrom,
  readHandoff,
} from "../../src/core/delivery/handoff.js";
import { isStoreOpenFailure, lockFileFor, openStore } from "../../src/core/store/index.js";
import type { DaemonRecord, EpochMs, WorktreeId } from "../../src/core/types/index.js";
import { closeFakeDaemons, fakeDaemon } from "../cli/fake-daemon.js";
import {
  daemonSuite,
  delay,
  type FixtureRepo,
  ping,
  SLOW,
  spawnCli,
  waitFor,
  withStore,
} from "./helpers.js";
import { stepDownKit } from "./step-down-helpers.js";

/*
 * Row 011-34 (011 C9 as amended 2026-10-20, design 011-30 section 4):
 * `squeal start` against a stopping daemon never prints `alive`. It sends
 * `stop`, takes part in the handoff and waits for a daemon of at least its
 * own version, as long as `squeal stop` waits; past that it names what holds
 * the lock and exits 1. A released 0.1.31 daemon, from before 0.1.200, lets
 * its tier finish after a stop, so it stays stopping while the tier runs.
 * Review 0.1.259 (the coordinator's decision of 2026-10-22): with the old
 * daemon's record cleared, its lock free and the claim live, `start` spawns
 * its daemon whatever the claim, and the lock decides between it and a
 * successor still starting (D10). Row 011-110: only a `start` that wrote the
 * claim spawns with the lock wait; one that joined a live claim spawns
 * without it, so the claim's successor stays the only one that waits.
 */

const suite = daemonSuite();
const { HOOKS, hasCommit, releasedCli, start, exitWithin, sockets } = stepDownKit(suite);
/** The last release before the step-down request, and before a stop cancels a tier. */
const PRE_CANCEL = "8654424";
const hasPreCancel = hasCommit(PRE_CANCEL) && process.platform === "linux";

/** A test file whose tier runs `ms`; `started` appears when it starts. */
function slowTest(ms: number): { files: Record<string, string>; started: string } {
  const started = `/tmp/sq-start-${randomUUID()}.started`;
  suite.cleanup(() => rmSync(started, { force: true }));
  const test = [
    'import { writeFileSync } from "node:fs";',
    'import { it } from "vitest";',
    'it("waits", async () => {',
    `  writeFileSync(${JSON.stringify(started)}, "");`,
    `  await new Promise((resolve) => setTimeout(resolve, ${ms}));`,
    `}, ${ms + 30_000});`,
    "",
  ].join("\n");
  return { files: { "test/slow.test.ts": test }, started };
}

/** `startCommand` in this process, spawning `cli`, with `bounds`; its code and output. */
async function startIn(
  repo: FixtureRepo,
  bounds: Parameters<typeof startCommand>[2],
  cli = suite.cli,
) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd: repo.root,
    env: repo.env,
  };
  // The CLI it spawns, and where it finds the socket: the fixture's, not this test runner's.
  const saved = process.env;
  process.env = { ...repo.env, SQUEAL_CLI: cli };
  try {
    const code = await startCommand([], io, bounds);
    return { code, stdout, stderr };
  } finally {
    process.env = saved;
  }
}

/** The arguments `ps` shows for process `pid`. */
const argsOf = (pid: number | undefined) =>
  execFileSync("ps", ["-ww", "-o", "args=", "-p", String(pid)], { encoding: "utf8" });

/** A 0.1.31 daemon of `repo` asked to stop while its tier runs: it stops once the tier ends. */
async function stoppingWithItsTier(repo: FixtureRepo, started: string) {
  const process = start(releasedCli(PRE_CANCEL), repo);
  const old = await waitFor(() => ping(repo.socketPath, 500), 60_000, "0.1.31 serving");
  await waitFor(() => existsSync(started), 60_000, "its tier running");
  await requestDaemon(repo.socketPath as never, { type: "stop" }, 2_000);
  await waitFor(
    async () => (await ping(repo.socketPath, 500))?.phase === "stopping",
    10_000,
    "0.1.31 stopping",
  );
  return { old, process };
}

describe.runIf(hasPreCancel)("squeal start with a stopping daemon (row 011-34)", SLOW, () => {
  it("exits 0 once the successor serves, and never says alive", async () => {
    const slow = slowTest(6_000);
    const repo = suite.fixture(slow.files);
    const { old } = await stoppingWithItsTier(repo, slow.started);

    const cli = spawnCli(suite.cli, ["start"], { cwd: repo.root, env: repo.env });
    const exit = await cli.exited;
    expect(exit, cli.stderr()).toEqual({ code: 0, signal: null });
    expect(cli.stdout()).toMatch(
      /^Squeal daemon started for .*, after the 0\.1\.31 daemon handed over in \d+\.\d s\n/,
    );
    expect(cli.stdout()).not.toMatch(/Squeal daemon alive|no daemon running/);
    // The evals read a daemon validating from it: the successor serves (row 011-34).
    expect(squealEvidence(cli.stdout(), "pull"), cli.stdout()).toMatchObject({ daemon: true });
    const next = await ping(repo.socketPath, 500);
    expect(next).toMatchObject({
      squealVersion: HOOKS,
      phase: expect.not.stringMatching("stopping"),
    });
    expect(next?.pid).not.toBe(old.pid);
    // It wrote the claim, so its successor waits for the lock (row 011-110).
    expect(argsOf(next?.pid)).toContain(" --await-lock ");
  });

  it("past its bound, exits 1 and names the process that holds the lock", async () => {
    // Longer than the bound below; the test waits for it after, so cleanup has no tier to wait for.
    const slow = slowTest(12_000);
    const repo = suite.fixture(slow.files);
    const { old, process: holder } = await stoppingWithItsTier(repo, slow.started);

    const { code, stdout, stderr } = await startIn(repo, {
      socketMs: 2_000,
      lockMs: 1_000,
      leftoversMs: 0,
    });
    expect(code, stdout).toBe(1);
    expect(stderr).toMatch(
      new RegExp(
        `^squeal: the 0\\.1\\.31 daemon for .* \\(pid ${old.pid}\\) is still stopping and holds its lock after 3 s, so no daemon follows it`,
      ),
    );
    expect(stdout).toBe("");
    expect(squealEvidence(stderr, "pull")).toMatchObject({ daemon: false });
    expect(await exitWithin(holder, 60_000, repo)).toEqual({ code: 0, signal: null });
  });
});

describe.runIf(process.platform === "linux")(
  "squeal start in a handoff's gap (review 0.1.259)",
  SLOW,
  () => {
    it("with the record cleared, a live claim and the lock free, spawns its daemon with no lock wait and exits 0", async () => {
      const repo = suite.fixture();
      // A daemon served and stopped: its record is cleared, its lock file is there and free.
      const first = start(suite.cli, repo);
      await waitFor(() => ping(repo.socketPath, 500), 60_000, "a daemon serving");
      await requestDaemon(repo.socketPath as never, { type: "stop" }, 2_000);
      expect(await exitWithin(first, 30_000, repo)).toEqual({ code: 0, signal: null });
      // A hook's claim whose successor never took the lock: it died, or it is still starting.
      withStore(repo, (store) =>
        claimHandoff(store, repo.worktreeId as WorktreeId, {
          from: "0.1.0@1#old",
          to: HOOKS,
          at: Date.now() as EpochMs,
        }),
      );
      sockets.push(repo.socketPath);

      // Bounds far below the claim's: a start that only joined the claim would wait them out.
      const { code, stdout, stderr } = await startIn(repo, {
        socketMs: 20_000,
        lockMs: 5_000,
        leftoversMs: 0,
      });
      expect(code, stderr).toBe(0);
      expect(stdout).toMatch(
        /^Squeal daemon started for .*, after the 0\.1\.0 daemon handed over in \d+\.\d s\n/,
      );
      const served = await ping(repo.socketPath, 500);
      expect(served).toMatchObject({ squealVersion: HOOKS });
      // It joined the claim: no second successor waits for the lock beside the claim's (row 011-110).
      expect(argsOf(served?.pid)).toContain(` daemon ${repo.root}`);
      expect(argsOf(served?.pid)).not.toContain("--await-lock");
    });
  },
);

/** A CLI that only appends its arguments to `log`, one JSON line for each daemon spawned. */
function spawnLog(): { cli: string; spawns: () => string[][] } {
  const base = `/tmp/sq-start-${randomUUID()}`;
  const log = `${base}.log`;
  writeFileSync(
    `${base}.mjs`,
    `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + "\\n");\n`,
  );
  suite.cleanup(() => rmSync(`${base}.mjs`, { force: true }));
  suite.cleanup(() => rmSync(log, { force: true }));
  const spawns = () =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as string[])
      : [];
  return { cli: `${base}.mjs`, spawns };
}

describe.runIf(process.platform === "linux")(
  "squeal start when the successor registers while it starts (row 011-110)",
  SLOW,
  () => {
    afterEach(() => closeFakeDaemons());

    it.each([
      ["its record", false],
      ["its record cleared", true],
    ])(
      "with %s, a successor that registered after start read it ends the handoff: no claim, no spawn",
      async (_, cleared) => {
        const repo = suite.fixture();
        const id = repo.worktreeId as WorktreeId;
        const now = Date.now();
        const old: DaemonRecord = {
          socketPath: repo.socketPath,
          startedAt: (now - 60_000) as EpochMs,
          heartbeatAt: (now - 20_000) as EpochMs,
          heartbeatIntervalMs: 5_000,
          squealVersion: "0.1.0",
          token: "old",
        };
        const next: DaemonRecord = {
          ...old,
          startedAt: (now - 1_000) as EpochMs,
          heartbeatAt: now as EpochMs,
          squealVersion: HOOKS,
          token: "new",
        };
        const store = openStore(repo.commonDir, { busyTimeoutMs: 10_000 });
        if (isStoreOpenFailure(store)) throw new Error(`store: ${JSON.stringify(store)}`);
        suite.cleanup(() => store.close());
        store.worktrees.upsert({
          id,
          root: repo.root,
          commonDir: repo.commonDir,
          isMain: true,
          registeredAt: 1,
          daemon: old,
        });
        // A hook's claim; the old daemon cleared its record or not yet, and holds its lock.
        claimHandoff(store, id, { from: handoffFrom(old), to: HOOKS, at: now as EpochMs });
        if (cleared) store.worktrees.setDaemon(id, null);
        const lock = acquireDaemonLock(lockFileFor(repo.commonDir, id));
        if (lock === null) throw new Error("the lock is taken");
        suite.cleanup(() => lock.release());
        const answer = (record: DaemonRecord, phase: string) => ({
          ok: true,
          type: "ping",
          pid: process.pid,
          worktreeId: id,
          root: repo.root,
          squealVersion: record.squealVersion,
          phase,
          startedAt: record.startedAt,
        });
        // Start's `stop` is answered after the successor registered, as `#register` does it:
        // its record and the claim cleared in one transaction, between start's reads and `claims()`.
        // From then on the successor answers the pings.
        const pings = [answer(old, "stopping")];
        await fakeDaemon(repo.socketPath, { ping: pings }, (type) => {
          if (type !== "stop") return;
          store.transaction(() => {
            store.worktrees.setDaemon(id, next);
            clearHandoff(store, id);
          });
          pings[0] = answer(next, "ready");
        });
        const { cli, spawns } = spawnLog();

        const { code, stdout, stderr } = await startIn(
          repo,
          { socketMs: 5_000, lockMs: 5_000, leftoversMs: 0 },
          cli,
        );
        expect(code, stderr).toBe(0);
        expect(stdout).toMatch(
          /^Squeal daemon started for .*, after the 0\.1\.0 daemon handed over in \d+\.\d s\n/,
        );
        // The registration ended the handoff: start claims nothing, and spawns no second successor.
        expect(readHandoff(store, id)).toBeNull();
        await delay(2_000);
        expect(spawns()).toEqual([]);
      },
    );
  },
);
