import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  type BuiltCli,
  buildCli,
  createFixtureRepo,
  type FixtureRepo,
  readNotes,
  SLOW,
  type SpawnedProcess,
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
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const process of processes.splice(0)) await stopProcess(process);
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function fixture(files?: Record<string, string>): FixtureRepo {
  const repo = createFixtureRepo(files === undefined ? {} : { files });
  cleanups.push(repo.cleanup);
  return repo;
}

function daemon(repo: FixtureRepo): SpawnedProcess {
  const spawned = spawnDaemon(built.cli, repo);
  processes.push(spawned);
  return spawned;
}

const policyNotes = (repo: FixtureRepo) =>
  readNotes(repo).filter((text) => text.startsWith("squeal.config.json"));

const keys = (repo: FixtureRepo) =>
  withStore(repo, (store) =>
    Object.fromEntries(
      store.testFileKeys.list(repo.worktreeId).map((row) => [row.testFile.path, row.key]),
    ),
  );

describe("squeal daemon: a bad policy is a state (spec 001 D11, review S3)", SLOW, () => {
  it("probe H: bad keys give one note and a running daemon, across starts and a restart", async () => {
    const repo = fixture({
      "squeal.config.json": '{"stop": {"waitMs": "500"}, "runner": {"tierSzie": 2}}',
    });
    const first = daemon(repo);
    await waitReady(repo, first);
    // SessionStart and SubagentStart spawn again; those daemons lose the lock.
    for (let i = 0; i < 2; i++) {
      const again = daemon(repo);
      expect(await again.exited).toEqual({ code: 0, signal: null });
    }
    expect(first.child.exitCode).toBeNull();
    const expected = [
      'squeal.config.json: "stop.waitMs" must be a number >= 0, got "500"; unknown key "runner.tierSzie"; the defaults apply in their place',
    ];
    expect(policyNotes(repo)).toEqual(expected);

    await stopProcess(first);
    const second = daemon(repo);
    await waitReady(repo, second);
    expect(policyNotes(repo)).toEqual(expected);
  });

  it("an edit to squeal.config.json while it runs reloads the policy and re-keys", async () => {
    const repo = fixture({ "fixtures/data.json": '{"n": 1}\n' });
    const spawned = daemon(repo);
    await waitReady(repo, spawned);
    const before = keys(repo);
    expect(Object.keys(before)).toHaveLength(5);

    writeFileSync(
      join(repo.root, "squeal.config.json"),
      '{"inputs": ["fixtures/**"], "stop": {"waitMs": "x"}}\n',
    );
    await waitFor(() => policyNotes(repo).length > 0, 30_000, "a reload note");
    expect(policyNotes(repo)).toEqual([
      'squeal.config.json changed; policy reloaded: "stop.waitMs" must be a number >= 0, got "x"; the defaults apply in their place',
    ]);
    const after = keys(repo);
    for (const [path, key] of Object.entries(before)) expect(after[path], path).not.toBe(key);

    // The declared input now moves keys.
    writeFileSync(join(repo.root, "fixtures/data.json"), '{"n": 2}\n');
    await waitFor(
      () => Object.entries(keys(repo)).every(([path, key]) => key !== after[path]),
      30_000,
      "keys moved by the declared input",
    );
    expect(spawned.child.exitCode).toBeNull();
  });
});
