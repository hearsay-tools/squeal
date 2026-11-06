import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
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

  // Row 011-302 (gh-154): a request the deadline passed says what holds it.
  it("names the daemon's startup when the deadline passes before it took the request", async () => {
    const gate = mkdtempSync("/tmp/sq-gate-");
    suite.cleanup(() => rmSync(gate, { recursive: true, force: true }));
    const entered = join(gate, "entered");
    const release = join(gate, "release");
    const repo = fixture({
      "squeal.config.json": `${JSON.stringify(POLICY)}\n`,
      "vitest.config.ts": gatedConfig(entered, release),
    });
    daemon(repo);
    try {
      for (const end = Date.now() + 60_000; !existsSync(entered) && Date.now() < end; ) {
        await sleep(50);
      }
      expect(existsSync(entered), "the daemon's startup reached the config gate").toBe(true);
      const run = spawnCli(suite.cli, ["run", "e2e", "--wait", "2000"], {
        cwd: repo.root,
        env: repo.env,
      });
      const exited = await run.exited;
      expect(run.stdout()).toMatch(
        /^Group e2e has no verdict: the deadline passed before the daemon took request [0-9a-f-]{36}; (the daemon's main thread [^;]+; )?it waits for the daemon's startup, which has run for \d+ s\. The request stays pending: wait again with squeal run e2e --wait\.\n$/,
      );
      expect(exited).toEqual({ code: 3, signal: null });
    } finally {
      writeFileSync(release, "go");
    }
  });
});

/** A Vitest config that holds the daemon's startup: it writes `entered`, then waits for `release`. */
function gatedConfig(entered: string, release: string): string {
  return `import { existsSync, writeFileSync } from "node:fs";

export default async () => {
  writeFileSync(${JSON.stringify(entered)}, "entered");
  const end = Date.now() + 120_000;
  while (!existsSync(${JSON.stringify(release)}) && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { test: { include: ["test/**/*.test.ts"], testTimeout: 60_000 } };
};
`;
}
