import { describe, expect, it } from "vitest";
import { daemonSuite, SLOW, spawnCli, waitReady } from "../daemon/helpers.js";
import { CODE_OFF } from "../helpers/policy.js";

/*
 * Spec 019 D6, row 019-15, against a real daemon on the scheduler fixture:
 * `squeal run e2e --wait` runs a group whose moment is Stop now, through the
 * `run-group` request and `Scheduler.requestGroup`, and gives the verdict of
 * that group's files alone.
 */

const suite = daemonSuite();
const { fixture, daemon } = suite;

const FAILING = `import { expect, it } from "vitest";

it("fails", () => {
  expect(1).toBe(2);
});
`;

const POLICY = {
  ...CODE_OFF,
  checks: [{ name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop" }],
};

describe("squeal run <group> --wait on a real daemon (spec 019 D6)", SLOW, () => {
  it("runs a Stop group now and exits 1 on its failing file, the other files aside", async () => {
    const repo = fixture({
      "squeal.config.json": `${JSON.stringify(POLICY)}\n`,
      "test/e2e/fails.test.ts": FAILING,
    });
    daemon(repo);
    await waitReady(repo);
    const run = spawnCli(suite.cli, ["run", "e2e", "--wait", "150000"], {
      cwd: repo.root,
      env: repo.env,
    });
    const exited = await run.exited;
    const [first, second] = run.stdout().split("\n");
    expect(first, run.stdout()).toMatch(
      /^Group e2e completed at revision \d+: 1 known failure: 1 test; 1 test file, [01] queued by this request$/,
    );
    expect(second, run.stdout()).toMatch(/^(Group e2e requested|No test files of group e2e)/);
    expect(run.stdout()).toContain("FAIL  test/e2e/fails.test.ts > fails");
    expect(exited).toEqual({ code: 1, signal: null });
  });
});
