import { describe, expect, it } from "vitest";
import { daemonSuite, SLOW, spawnCli, waitReady } from "../daemon/helpers.js";

/*
 * Spec 005 D1 against a real daemon on the scheduler fixture: a checkpoint
 * with a failing test exits 1, and one past its deadline exits 3 naming the
 * files still pending.
 */

const suite = daemonSuite();
const { fixture, daemon } = suite;

const FAILING = `import { expect, it } from "vitest";

it("fails", () => {
  expect(1).toBe(2);
});
`;

const HELD = `import { expect, it } from "vitest";

it("takes a while", async () => {
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  expect(1).toBe(1);
});
`;

describe("run --all --wait on a real daemon (spec 005 D1)", SLOW, () => {
  it("exits 1 on a checkpoint that completed with a failing test", async () => {
    const repo = fixture({ "test/fails.test.ts": FAILING });
    daemon(repo);
    await waitReady(repo);
    const run = spawnCli(suite.cli, ["run", "--all", "--force", "--wait", "150000"], {
      cwd: repo.root,
      env: repo.env,
    });
    const exited = await run.exited;
    const [first] = run.stdout().split("\n");
    expect(first, run.stdout()).toMatch(
      /^Checkpoint \S+ completed at revision \d+: 1 known failure: 1 test; 6 test files, 0 already current, 6 run now$/,
    );
    expect(run.stdout()).toContain("FAIL  test/fails.test.ts > fails");
    expect(exited).toEqual({ code: 1, signal: null });
  });

  it("exits 3 at its deadline and names the files still pending", async () => {
    const repo = fixture({ "test/held.test.ts": HELD });
    daemon(repo);
    await waitReady(repo);
    const run = spawnCli(suite.cli, ["run", "--all", "--force", "--wait", "1000"], {
      cwd: repo.root,
      env: repo.env,
    });
    const exited = await run.exited;
    const [first] = run.stdout().split("\n");
    expect(first, run.stdout()).toMatch(
      /^Checkpoint \S+ has no verdict: the deadline passed with [1-6] test files? pending at revision \d+; the checkpoint goes on in the daemon$/,
    );
    expect(exited).toEqual({ code: 3, signal: null });
  });
});
