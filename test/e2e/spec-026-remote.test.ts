import { spawnSync } from "node:child_process";
import { appendFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TestFileRef } from "../../src/core/types/keys.js";
import {
  daemonSuite,
  diagnose,
  type FixtureRepo,
  readNotes,
  stopProcess,
  waitReady,
  withStore,
} from "../daemon/helpers.js";
import { git } from "../hash/git-repo.js";
import { buildPluginDist } from "./spec-026-build.js";
import {
  cliIn,
  commandHooks,
  nodeWith,
  OTHER_ARCH,
  type RemoteWorld,
  SLOW_DISK,
  sampleLocalHosts,
  withRemote,
} from "./spec-026-remote-fixture.js";

/*
 * Spec 026 row 026-16, Track 2 end to end, with the plugin's bundled CLI
 * built from this worktree (`spec-026-build.ts`) as the daemon, and a
 * remote that is a directory of this machine behind a fake `ssh`
 * (`spec-026-remote-fixture.ts`). The `command` provider's own scripts
 * acquire, sleep, wake and release it; `squeal remote list|sleep|prune`
 * reach it. Hybrid 2A: every lane (background baseline, edit, slow,
 * group) and runner (Vitest, node:test, pytest when this machine has it)
 * runs there with remote planning, and no local runner host ever starts;
 * the remote's coverage lands in the local code store. A remote Node that
 * reports another arch is refused under `match-local` and keyed to its own
 * environment under `remote-key` (D10); one whose disk syncs slowly is
 * named and kept under `warn` and refused under `refuse` (D11).
 */

const suite = daemonSuite({}, buildPluginDist);

const MATH = { project: "", path: "test/math.test.ts" } as TestFileRef;

const NODE_TEST = {
  "nt/sum.test.mjs":
    'import assert from "node:assert/strict";\nimport { test } from "node:test";\n\ntest("sums", () => assert.equal(1 + 1, 2));\n',
  "slow/wait.test.mjs":
    'import assert from "node:assert/strict";\nimport { test } from "node:test";\n\ntest("waits", async () => {\n  await new Promise((r) => setTimeout(r, 300));\n  assert.ok(true);\n});\n',
};

/** A Python with pytest on this machine, or `null`: the pytest case is skipped without one. */
function pytestPython(): string | null {
  for (const python of [process.env.SQUEAL_E2E_PYTHON, "python3"]) {
    if (python === undefined || python === "") continue;
    const probe = spawnSync(python, ["-c", "import pytest, sys; print(sys.executable)"], {
      encoding: "utf8",
    });
    if (probe.status === 0) return probe.stdout.trim();
  }
  return null;
}
const PYTHON = pytestPython();

/** A fixture: Vitest, two node:test projects (one slow), a manual group, and a remote world. */
function fixture(extra: Record<string, unknown> = {}, files: Record<string, string> = {}) {
  const repo = suite.fixture({
    "squeal.config.json": `${JSON.stringify({
      baseline: { onStart: "lookup-then-run-missing" },
      checks: [{ name: "later", runner: "vitest", tests: ["test/plain.test.ts"], at: "manual" }],
      nodeTest: [
        { name: "nt", include: ["nt/*.test.mjs"] },
        { name: "slow", include: ["slow/*.test.mjs"] },
      ],
      slow: { include: ["slow/*.test.mjs"] },
      complexity: { enabled: true },
      coverage: { enabled: true },
      ...extra,
    })}\n`,
    ...NODE_TEST,
    ...files,
  });
  // The fixture's `test/gen.test.ts` reads a gitignored file, which never reaches a remote tree.
  git(repo.root, ["rm", "-q", "test/gen.test.ts"]);
  git(repo.root, ["commit", "-qm", "no ignored input"]);
  return withRemote(suite, repo);
}

/** A `command` machine answering with `node` and `.squeal-remote`. */
function lane(world: RemoteWorld, node = process.execPath, entry: Record<string, unknown> = {}) {
  const hooks = commandHooks(join(world.repo.runtimeDir, "hooks"), {
    v: 1,
    id: "lan-1",
    destination: "dev@lan-box",
    node,
    cache: ".squeal-remote",
    sleepOnIdle: true,
  });
  world.remote({
    provider: "command",
    providerConfig: hooks.config,
    lanes: "all",
    runners: "all",
    whenLost: "not-run",
    ...entry,
  });
  return hooks;
}

/** The daemon of `repo`, ready. */
async function served(repo: FixtureRepo) {
  const spawned = suite.daemon(repo);
  await waitReady(repo, spawned, 120_000);
  return spawned;
}

const cli = (repo: FixtureRepo, ...args: string[]) => cliIn(suite, repo, ...args);

describe("spec 026 Track 2 end to end (row 026-16)", { timeout: 600_000 }, () => {
  it("runs every lane and runner on a command machine, with 0 local hosts, through its lifecycle", async () => {
    const world = fixture();
    const { repo } = world;
    const hooks = lane(world);
    const sampler = sampleLocalHosts(repo.root);
    const spawned = await served(repo);
    const why = () => diagnose(repo, spawned);

    // Background: the start baseline runs every file there, the slow one included.
    const start = await cli(repo, "status", "--wait", "120000");
    expect(start.code, `${start.out}\n${why()}`).toBe(0);
    // Edit: the edit's file runs there.
    appendFileSync(
      join(repo.root, "src/math.ts"),
      "\nexport const twice = (a: number) => a * 2;\n",
    );
    const edit = await cli(repo, "status", "--wait", "120000", "src/math.ts");
    expect(edit.out, why()).toContain("Selected: test/math.test.ts");
    expect(edit.out).toMatch(/no known failures; 1 test file, each with a current result/);
    // Group: the manual group runs there on request.
    const group = await cli(repo, "run", "later", "--wait", "120000");
    expect(group.out, why()).toMatch(/^Group later completed at revision \d+: no known failures/);
    const full = await cli(repo, "status", "--full");
    expect(full.out, why()).toMatch(/Known failures: 0; all 6 test files current/);
    const notes = readNotes(repo).join("\n");
    expect(notes).toMatch(/remote command: background and edit runs of vitest go there; proven/);
    expect(notes).toMatch(/remote command: group runs of vitest go there; proven/);
    expect(notes).toMatch(
      /remote command: background, edit, slow and group runs of node-test go there; proven/,
    );
    // D9: the remote's coverage is in the local code store.
    const code = await cli(repo, "code", "src/strings.ts");
    expect(code.out).toMatch(
      /upper +CC 1, at or under; CRAP 1; 100% of its lines ran in 2 test files/,
    );

    // D12: list and sleep; the next edit wakes it and runs there.
    const list = await cli(repo, "remote", "list");
    expect(list.out).toMatch(new RegExp(`cmd:lan-1 +command +awake +${repo.root}`));
    expect(await cli(repo, "remote", "sleep", repo.root)).toEqual({
      code: 0,
      out: "cmd:lan-1: asked to sleep\n",
    });
    appendFileSync(
      join(repo.root, "src/strings.ts"),
      "\nexport const lower = (s: string) => s.toLowerCase();\n",
    );
    const woke = await cli(repo, "status", "--wait", "120000", "src/strings.ts");
    expect(woke.out, why()).toMatch(/no known failures; 2 test files, each with a current result/);

    // Daemon exit releases it as such; a removed worktree's machine is pruned.
    await stopProcess(spawned);
    expect(sampler.stop(), "local runner hosts seen at once").toBe(0);
    expect(hooks.calls()).toEqual(["acquire", "sleep", "wake", "release daemon-exit"]);
    renameSync(repo.root, `${repo.root}-gone`);
    try {
      const pruned = await cli({ ...repo, root: repo.runtimeDir }, "remote", "prune");
      expect(pruned.out).toBe(`released cmd:lan-1 (command) of removed worktree ${repo.root}\n`);
    } finally {
      renameSync(`${repo.root}-gone`, repo.root);
    }
    expect(hooks.calls().at(-1)).toBe("release worktree-removed");
    expect((await cli({ ...repo, root: repo.runtimeDir }, "remote", "list")).out).not.toContain(
      "cmd:lan-1",
    );
  });

  it.skipIf(PYTHON === null)("runs pytest files there too", async () => {
    const world = fixture(
      { pytest: [{ name: "py", python: PYTHON, include: ["py/test_*.py"] }] },
      { "py/test_add.py": "def test_add():\n    assert 1 + 1 == 2\n" },
    );
    lane(world);
    const sampler = sampleLocalHosts(world.repo.root);
    const spawned = await served(world.repo);
    const status = await cli(world.repo, "status", "--wait", "120000", "py/test_add.py");
    expect(status.out, diagnose(world.repo, spawned)).toMatch(/each with a current result/);
    expect(readNotes(world.repo).join("\n")).toMatch(/runs of pytest go there; proven/);
    expect(sampler.stop()).toBe(0);
  });

  it("names a slow disk and keeps the machine under warn, and refuses it under refuse", async () => {
    const warned = fixture();
    lane(warned, nodeWith(join(warned.repo.runtimeDir, "slow-node"), SLOW_DISK), {
      diskCheck: { maxWriteMs: 10, onSlowDisk: "warn" },
    });
    const warnDaemon = await served(warned.repo);
    const all = await cli(warned.repo, "run", "--all", "--wait", "120000");
    expect(all.code, `${all.out}\n${diagnose(warned.repo, warnDaemon)}`).toBe(0);
    const warnNotes = readNotes(warned.repo).join("\n");
    expect(warnNotes).toMatch(
      /remote cmd:lan-1: degraded disk: \d+ ms\/sync, limit 10 ms; runs go there anyway \(onSlowDisk "warn"\)/,
    );
    expect(warnNotes).toMatch(
      /remote command: background and edit runs of vitest go there; proven/,
    );
    await stopProcess(warnDaemon);

    const refused = fixture();
    lane(refused, nodeWith(join(refused.repo.runtimeDir, "slow-node"), SLOW_DISK), {
      diskCheck: { maxWriteMs: 10, onSlowDisk: "refuse" },
    });
    const sampler = sampleLocalHosts(refused.repo.root);
    const refuseDaemon = await served(refused.repo);
    await cli(refused.repo, "status", "--wait", "30000");
    const refuseNotes = readNotes(refused.repo).join("\n");
    expect(refuseNotes, diagnose(refused.repo, refuseDaemon)).toMatch(
      /remote cmd:lan-1: degraded disk: \d+ ms\/sync, limit 10 ms; refused \(onSlowDisk "refuse"\)/,
    );
    expect(refuseNotes).toMatch(/not planned here \(whenLost "not-run"\)/);
    expect(refuseNotes).not.toMatch(/go there; proven/);
    // Refused under `not-run`: nothing ran here either.
    expect(sampler.stop()).toBe(0);
    const results = withStore(refused.repo, (store) =>
      store.testFileKeys.list(refused.repo.worktreeId),
    );
    expect(results).toEqual([]);
  });

  it("refuses another arch under match-local, and under remote-key keys results to it apart from local ones", async () => {
    const matched = fixture();
    lane(matched, nodeWith(join(matched.repo.runtimeDir, "other-node"), OTHER_ARCH));
    const matchDaemon = await served(matched.repo);
    await cli(matched.repo, "status", "--wait", "30000");
    const matchNotes = readNotes(matched.repo).join("\n");
    expect(matchNotes, diagnose(matched.repo, matchDaemon)).toContain(
      `remote command refused: arch riscv64 on the remote, ${process.arch} here`,
    );
    expect(matchNotes).not.toMatch(/go there; proven/);
    await stopProcess(matchDaemon);

    const keyed = fixture();
    const { repo } = keyed;
    lane(keyed, nodeWith(join(repo.runtimeDir, "other-node"), OTHER_ARCH), {
      environmentMode: "remote-key",
    });
    const sampler = sampleLocalHosts(repo.root);
    const keyDaemon = await served(repo);
    const all = await cli(repo, "run", "--all", "--wait", "120000");
    expect(all.code, `${all.out}\n${diagnose(repo, keyDaemon)}`).toBe(0);
    const machine = `${process.platform}/riscv64, Node v`;
    expect(readNotes(repo).join("\n")).toContain(`remote command (${machine}`);
    expect(readNotes(repo).join("\n")).toMatch(/results keyed to remote environment; proven/);
    await stopProcess(keyDaemon);
    expect(sampler.stop()).toBe(0);
    const keyOf = () =>
      withStore(repo, (store) => store.testFileKeys.list(repo.worktreeId, [MATH])[0]?.key ?? null);
    const remoteKey = keyOf();
    expect(remoteKey).not.toBeNull();

    // Without the remote, the same file at the same content runs here under its own key;
    // the remote's result stays under the remote's key and is never taken for this one.
    keyed.remote(null);
    const localDaemon = await served(repo);
    const here = await cli(repo, "status", "--wait", "120000", MATH.path);
    expect(here.out, diagnose(repo, localDaemon)).toMatch(
      /1 test file, each with a current result/,
    );
    const localKey = keyOf();
    expect(localKey).not.toBeNull();
    expect(localKey).not.toBe(remoteKey);
    withStore(repo, (store) => {
      expect(store.results.byKey(remoteKey).length).toBeGreaterThan(0);
      expect(store.results.byKey(localKey).length).toBeGreaterThan(0);
    });
  });
});
