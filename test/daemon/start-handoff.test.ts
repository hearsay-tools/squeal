import { randomUUID } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { startCommand } from "../../src/cli/start.js";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { daemonSuite, type FixtureRepo, ping, SLOW, spawnCli, waitFor } from "./helpers.js";
import { stepDownKit } from "./step-down-helpers.js";

/*
 * Row 011-34 (011 C9 as amended 2026-10-20, design 011-30 section 4):
 * `squeal start` against a stopping daemon never prints `alive`. It sends
 * `stop`, takes part in the handoff and waits for a daemon of at least its
 * own version, as long as `squeal stop` waits; past that it names what holds
 * the lock and exits 1. A released 0.1.31 daemon, from before 0.1.200, lets
 * its tier finish after a stop, so it stays stopping while the tier runs.
 */

const suite = daemonSuite();
const { HOOKS, hasCommit, releasedCli, start, exitWithin } = stepDownKit(suite);
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
    const next = await ping(repo.socketPath, 500);
    expect(next).toMatchObject({
      squealVersion: HOOKS,
      phase: expect.not.stringMatching("stopping"),
    });
    expect(next?.pid).not.toBe(old.pid);
  });

  it("past its bound, exits 1 and names the process that holds the lock", async () => {
    // Longer than the bound below; the test waits for it after, so cleanup has no tier to wait for.
    const slow = slowTest(12_000);
    const repo = suite.fixture(slow.files);
    const { old, process: holder } = await stoppingWithItsTier(repo, slow.started);

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
    process.env = { ...repo.env, SQUEAL_CLI: suite.cli };
    let code: number;
    try {
      code = await startCommand([], io, { socketMs: 2_000, lockMs: 1_000, leftoversMs: 0 });
    } finally {
      process.env = saved;
    }
    expect(code, stdout).toBe(1);
    expect(stderr).toMatch(
      new RegExp(
        `^squeal: the 0\\.1\\.31 daemon for .* \\(pid ${old.pid}\\) is still stopping and holds its lock after 3 s, so no daemon follows it`,
      ),
    );
    expect(stdout).toBe("");
    expect(await exitWithin(holder, 60_000, repo)).toEqual({ code: 0, signal: null });
  });
});
