import { appendFileSync, utimesSync } from "node:fs";
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
 * opens none.
 */

const suite = daemonSuite();

const CONFIG = {
  ...CODE_OFF,
  runner: { hostIdleMinutes: 1 },
  checks: [{ name: "unit", runner: "vitest", at: "manual" }],
};

/** `squeal <args>` in `repo`, its exit code and output once it ends. */
async function cli(repo: FixtureRepo, ...args: string[]) {
  const run = spawnCli(suite.cli, args, { cwd: repo.root, env: repo.env });
  const { code } = await run.exited;
  return { code, out: `${run.stdout()}${run.stderr()}` };
}

/** Appends a line to `path`, then waits for the daemon to take the revision. */
async function edit(repo: FixtureRepo, path: string): Promise<void> {
  appendFileSync(join(repo.root, path), "\n// edit\n");
  await cli(repo, "status", "--wait", "30000");
}

describe("deferred runner keying in the daemon (spec 026 D1)", { timeout: 300_000 }, () => {
  it("opens a Vitest host only for an explicit run, and closes it when idle", async () => {
    const repo = suite.fixture({
      "squeal.config.json": `${JSON.stringify(CONFIG)}\n`,
      "README.md": "# fixture\n",
    });
    const spawned = suite.daemon(repo);
    await waitFor(() => ping(repo.socketPath, 500), 60_000, "a daemon serving");
    const none = (when: string) =>
      expect(runnerHosts(repo.root), `${when}\n${diagnose(repo, spawned)}`).toEqual([]);

    await cli(repo, "status", "--wait", "30000");
    none("at start");
    await edit(repo, "src/math.ts");
    none("after a source edit");
    await edit(repo, "README.md");
    none("after a README.md edit");
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(repo.root, "src/strings.ts"), later, later);
    await cli(repo, "status", "--wait", "30000");
    none("after a touch");
    // Idle passes: the reconciliation pass and the import re-walk come when nothing happens.
    await delay(8_000);
    none("after idle passes");

    const run = spawnCli(suite.cli, ["run", "unit", "--wait", "150000"], {
      cwd: repo.root,
      env: repo.env,
    });
    await waitFor(() => runnerHosts(repo.root).length > 0, 60_000, "a host for the run");
    const { code } = await run.exited;
    expect(code, `${run.stdout()}${run.stderr()}`).toBe(0);

    // Edits after the run owe their runner part; the idle bound closes the host.
    await edit(repo, "src/math.ts");
    await waitFor(() => runnerHosts(repo.root).length === 0, 150_000, "the host closed").catch(
      (error: Error) => {
        throw new Error(`${error.message}\n${diagnose(repo, spawned)}`);
      },
    );
    await edit(repo, "src/math.ts");
    none("after an edit once the host closed");
  });
});
