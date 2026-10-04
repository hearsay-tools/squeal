import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { readStatus } from "../../src/core/status/index.js";
import type { StatusResult, StatusSnapshot } from "../../src/core/types/index.js";
import {
  type BuiltCli,
  buildCli,
  createFixtureRepo,
  delay,
  type FixtureRepo,
  LOADED,
  ping,
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

function snapshot(repo: FixtureRepo): StatusSnapshot {
  const result: StatusResult = readStatus(repo.root);
  if (!result.available) throw new Error(result.message);
  return result;
}

/** Waits until nothing is queued or running and the baseline checkpoint has ended. */
async function settled(repo: FixtureRepo, timeoutMs = 120_000): Promise<StatusSnapshot> {
  return waitFor(
    () => {
      const status = snapshot(repo);
      const pending = status.counts.pending + status.testFilesWithoutChecks.pending;
      return pending === 0 && status.breakdown.testFiles > 0 ? status : null;
    },
    timeoutMs,
    "no pending work",
  );
}

const SLOW_TEST = `import { expect, it } from "vitest";

it("takes a while", async () => {
  await new Promise((resolve) => setTimeout(resolve, 4000));
  expect(1).toBe(1);
});
`;

describe("squeal daemon: serving while working (spec 001 D9, D10)", SLOW, () => {
  it("answers a ping in under 100 ms while a tier is running", async () => {
    const repo = fixture({ "test/slow.test.ts": SLOW_TEST });
    daemon(repo);
    await waitReady(repo);
    await waitFor(
      () =>
        withStore(repo, (store) =>
          store.testFileKeys
            .list(repo.worktreeId)
            .some((row) => row.testFile.path === "test/slow.test.ts" && row.pending === "running"),
        ),
      60_000,
      "slow tier running",
    );
    const latencies: number[] = [];
    for (let i = 0; i < 10; i++) {
      const started = performance.now();
      const answer = await ping(repo.socketPath, 1_000);
      latencies.push(performance.now() - started);
      expect(answer?.phase).toBe("ready");
      await delay(50);
    }
    // Still in flight: the pings were answered during the tier.
    expect(
      withStore(repo, (store) =>
        store.testFileKeys
          .list(repo.worktreeId)
          .find((row) => row.testFile.path === "test/slow.test.ts"),
      )?.pending,
    ).toBe("running");
    console.log(`ping during a tier: max ${Math.max(...latencies).toFixed(1)} ms`);
    if (!LOADED) expect(Math.max(...latencies)).toBeLessThan(100);
  });

  it("squeal run --all --force --wait creates one checkpoint over the socket that completes", async () => {
    const repo = fixture();
    daemon(repo);
    await waitReady(repo);
    await settled(repo);

    const run = spawnCli(built.cli, ["run", "--all", "--force", "--wait"], {
      cwd: repo.root,
      env: repo.env,
    });
    expect(await run.exited).toEqual({ code: 0, signal: null });
    expect(run.stdout()).toMatch(/Checkpoint [0-9a-f-]{36} started at revision \d+: 5 test files/);
    expect(run.stdout()).toMatch(/Checkpoint [0-9a-f-]{36} completed/);
    const checkpoints = withStore(repo, (store) => {
      const last = store.checkpoints.lastCompleted(repo.worktreeId);
      return last === null ? [] : [last];
    });
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]).toMatchObject({ kind: "run-all", end: "completed" });
    expect(checkpoints[0]?.testFiles).toHaveLength(5);
    expect(snapshot(repo).fullSuite.atCurrentRevision).toBe(true);
  });

  it("squeal run --all without --wait returns once the checkpoint is recorded", async () => {
    const repo = fixture();
    daemon(repo);
    await waitReady(repo);
    const run = spawnCli(built.cli, ["run", "--all"], { cwd: repo.root, env: repo.env });
    expect(await run.exited).toEqual({ code: 0, signal: null });
    const id = /Checkpoint ([0-9a-f-]{36}) started/.exec(run.stdout())?.[1];
    expect(id).toBeDefined();
    const record = withStore(repo, (store) => store.checkpoints.get(id ?? ""));
    expect(record?.kind).toBe("run-all");
  });

  it("squeal run --all reports a missing daemon instead of hanging", async () => {
    const repo = fixture();
    const run = spawnCli(built.cli, ["run", "--all"], { cwd: repo.root, env: repo.env });
    expect(await run.exited).toEqual({ code: 1, signal: null });
    expect(run.stderr()).toMatch(/no daemon running for .*; start one with squeal start/);
  });

  it("a broken vitest.config.ts at start gives unknown counts and a persisted note, never an exit", async () => {
    const repo = fixture();
    const first = daemon(repo);
    await waitReady(repo);
    const good = await settled(repo);
    expect(good.counts.current).toBeGreaterThan(0);
    first.child.kill("SIGTERM");
    await first.exited;

    const configPath = join(repo.root, "vitest.config.ts");
    const original = readFileSync(configPath, "utf8");
    writeFileSync(configPath, "export default {{ broken\n");
    const second = daemon(repo);
    await waitReady(repo);
    const broken = await waitFor(
      () => {
        const status = snapshot(repo);
        return status.counts.unknown > 0 ? status : null;
      },
      60_000,
      "unknown counts",
    );
    expect(broken.counts.current).toBe(0);
    expect(broken.knownFailures).toEqual([]);
    expect(broken.fullSuite.atCurrentRevision).toBe(false);
    expect(broken.daemonNotes.map((n) => n.text).join("\n")).toMatch(/Vitest could not start/);
    await delay(1_000);
    expect(second.child.exitCode).toBeNull();
    expect((await ping(repo.socketPath, 500))?.phase).toBe("ready");

    // The next batch that touches the config retries, and the checks come back.
    writeFileSync(configPath, original);
    const recovered = await waitFor(
      () => {
        const status = snapshot(repo);
        const settledNow = status.counts.unknown === 0 && status.counts.pending === 0;
        return settledNow && status.counts.current > 0 ? status : null;
      },
      120_000,
      "recovered",
    );
    expect(recovered.counts.current).toBe(good.counts.current);
  });
});
