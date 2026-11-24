import { appendFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CODE_OFF } from "../helpers/policy.js";
import {
  daemonSuite,
  delay,
  diagnose,
  type FixtureRepo,
  ping,
  runnerHosts,
  spawnCli,
  waitFor,
} from "./helpers.js";

/*
 * Spec 026 D1 (row 026-05), with a real daemon and real Vitest: when every
 * Vitest file belongs to a group at `manual`, the daemon starts no runner
 * host at start, after edits to a source and to `README.md`, after a touch
 * and over idle passes. `squeal run <group> --wait` opens one, runs the
 * group, and `runner.hostIdleMinutes` closes it again; an edit meanwhile
 * opens none. Row 010-37: `status --wait` settles on quiet under such a
 * policy, since nothing lists unasked, and the daemon's host idle bound is
 * `HOST_IDLE_MS` (`SQUEAL_TEST_HOST_IDLE_MS`) in place of the config's
 * minute, whose scaling `test/daemon/host-idle.test.ts` keeps.
 */

const suite = daemonSuite();

const CONFIG = {
  ...CODE_OFF,
  runner: { hostIdleMinutes: 1 },
  checks: [{ name: "unit", runner: "vitest", at: "manual" }],
};

/** The daemon's host idle bound in place of `hostIdleMinutes: 1` (row 010-37). */
const HOST_IDLE_MS = 2_000;

/** `squeal <args>` in `repo`, its exit code and output once it ends. */
async function cli(repo: FixtureRepo, ...args: string[]) {
  const env: NodeJS.ProcessEnv = { ...repo.env };
  delete env.CODEX_SESSION_ID;
  delete env.PI_SESSION_ID;
  delete env.OPENCODE_SESSION_ID;
  delete env.ANTIGRAVITY_CONVERSATION_ID;
  delete env.CLAUDECODE;
  const run = spawnCli(suite.cli, args, { cwd: repo.root, env });
  const { code } = await run.exited;
  return { code, out: `${run.stdout()}${run.stderr()}` };
}

/**
 * `status --wait` returns on quiet, never on its timeout: nothing lists
 * unasked under a manual-only policy, so the wait owes no listing (row 010-37).
 */
async function settled(repo: FixtureRepo, spawned: ReturnType<typeof suite.daemon>) {
  const { code, out } = await cli(repo, "status", "--wait", "30000");
  const why = `${out}\n${diagnose(repo, spawned)}`;
  expect(out, why).toContain("Returned on quiet");
  expect(code, why).toBe(0);
}

/** Appends a line to `path`, then waits for the daemon to take the revision. */
async function edit(repo: FixtureRepo, spawned: ReturnType<typeof suite.daemon>, path: string) {
  appendFileSync(join(repo.root, path), "\n// edit\n");
  await settled(repo, spawned);
}

/** A fixture under `CONFIG` whose daemon closes an idle host after `HOST_IDLE_MS`. */
function deferredFixture(): FixtureRepo {
  const repo = suite.fixture({
    "squeal.config.json": `${JSON.stringify(CONFIG)}\n`,
    "README.md": "# fixture\n",
  });
  repo.env.SQUEAL_TEST_HOST_IDLE_MS = String(HOST_IDLE_MS);
  return repo;
}

describe("deferred runner keying in the daemon (spec 026 D1)", { timeout: 300_000 }, () => {
  it("opens a Vitest host only for an explicit run, and closes it when idle", async () => {
    const repo = deferredFixture();
    const spawned = suite.daemon(repo);
    await waitFor(() => ping(repo.socketPath, 500), 60_000, "a daemon serving");
    const none = (when: string) =>
      expect(runnerHosts(repo.root), `${when}\n${diagnose(repo, spawned)}`).toEqual([]);

    await settled(repo, spawned);
    none("at start");
    await edit(repo, spawned, "src/math.ts");
    none("after a source edit");
    await edit(repo, spawned, "README.md");
    none("after a README.md edit");
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(repo.root, "src/strings.ts"), later, later);
    await settled(repo, spawned);
    none("after a touch");
    // Idle passes: the reconciliation pass and the import re-walk come when nothing happens.
    await delay(2_000);
    none("after idle passes");

    const run = spawnCli(suite.cli, ["run", "unit", "--wait", "150000"], {
      cwd: repo.root,
      env: repo.env,
    });
    await waitFor(() => runnerHosts(repo.root).length > 0, 60_000, "a host for the run");
    const { code } = await run.exited;
    expect(code, `${run.stdout()}${run.stderr()}`).toBe(0);

    // Edits after the run owe their runner part; the idle bound closes the host.
    await edit(repo, spawned, "src/math.ts");
    await waitFor(() => runnerHosts(repo.root).length === 0, 60_000, "the host closed").catch(
      (error: Error) => {
        throw new Error(`${error.message}\n${diagnose(repo, spawned)}`);
      },
    );
    await edit(repo, spawned, "src/math.ts");
    none("after an edit once the host closed");
  });

  interface Served {
    readonly repo: FixtureRepo;
    readonly spawned: ReturnType<typeof suite.daemon>;
  }

  /** A fixture under `CONFIG`, its daemon serving, no runner host after unnamed status reads. */
  async function served(): Promise<Served> {
    const repo = deferredFixture();
    const spawned = suite.daemon(repo);
    await waitFor(() => ping(repo.socketPath, 500), 60_000, "a daemon serving");
    const none = (when: string) =>
      expect(runnerHosts(repo.root), `${when}\n${diagnose(repo, spawned)}`).toEqual([]);
    await cli(repo, "status");
    await settled(repo, spawned);
    none("after an unnamed status");
    return { repo, spawned };
  }

  /**
   * `status --wait <path>` lists the deferred runner's files and selects
   * `selected`. A `manual` group's file then waits for `squeal run <group>`
   * (spec 019): exit 3 with that next step, never "not listed" (B2).
   */
  async function lists(daemon: Served, path: string, selected: string) {
    const { code, out } = await cli(daemon.repo, "status", "--wait", "150000", path);
    const why = `${out}\n${diagnose(daemon.repo, daemon.spawned)}`;
    expect(out, why).not.toMatch(/has not listed|still starting/);
    expect(out, why).toContain(`Selected: ${selected}`);
    expect(out, why).toContain(`squeal run unit ${selected}`);
    expect(code, why).toBe(3);
  }

  it("a first-ever named wait on a test path opens the runner, as does a new test (review 0.1.616 B2)", async () => {
    const daemon = await served();
    await lists(daemon, "test/math.test.ts", "test/math.test.ts");
    writeFileSync(
      join(daemon.repo.root, "test/added.test.ts"),
      'import { expect, it } from "vitest";\n\nit("adds", () => expect(1 + 1).toBe(2));\n',
    );
    await lists(daemon, "test/added.test.ts", "test/added.test.ts");
    // The explicit run the wait names gives the verdict.
    const run = await cli(daemon.repo, "run", "unit", "test/added.test.ts", "--wait", "150000");
    expect(run.code, `${run.out}\n${diagnose(daemon.repo, daemon.spawned)}`).toBe(0);
  });

  it("a first-ever named wait on a source path opens the runner (review 0.1.616 B2)", async () => {
    const daemon = await served();
    const { code, out } = await cli(daemon.repo, "status", "--wait", "150000", "src/math.ts");
    const why = `${out}\n${diagnose(daemon.repo, daemon.spawned)}`;
    expect(out, why).not.toMatch(/has not listed|still starting/);
    expect(out, why).toContain("Selected: test/math.test.ts");
    expect(code, why).toBe(3);
  });
});
