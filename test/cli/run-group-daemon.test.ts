import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { runGroupCommand } from "../../src/cli/run-group.js";
import {
  daemonSuite,
  type FixtureRepo,
  SLOW,
  spawnCli,
  waitReady,
  withStore,
} from "../daemon/helpers.js";
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

/*
 * Row 011-335 (research `group-wait-edits.md`, F1 and F2): the probe's
 * in-process order, with no CLI start-up between an edit and the request.
 * The group's file is current; an edit of the source it reads, then at once
 * the request. Before the row the daemon took it at the revision before the
 * edit and gave that revision's verdict (24 of 24 in the probe).
 */
describe(
  "squeal run <group> --wait right after an edit, on a real daemon (row 011-335)",
  SLOW,
  () => {
    const TEST = `import { expect, it } from "vitest";
import { value } from "../../src/value.ts";

it("reads the value", () => {
  expect(value()).toBe(1);
});
`;
    const source = (value: number) => `export const value = (): number => ${value};\n`;

    it("takes the group's and the narrow run's request at the edit's revision, and gives its verdict", async () => {
      const repo = fixture({
        "squeal.config.json": `${JSON.stringify(POLICY)}\n`,
        "src/value.ts": source(1),
        "test/e2e/value.test.ts": TEST,
      });
      daemon(repo);
      await waitReady(repo);
      const warm = spawnCli(suite.cli, ["run", "e2e", "--wait", "150000"], {
        cwd: repo.root,
        env: repo.env,
      });
      expect((await warm.exited).code, warm.stdout()).toBe(0);

      for (const [rest, value, code] of [
        [["e2e"], 2, 1],
        [["e2e", "test/e2e/value.test.ts"], 1, 0],
      ] as const) {
        const before = await stillRevision(repo);
        writeFileSync(join(repo.root, "src/value.ts"), source(value));
        const run = await inProcess(repo, [...rest]);
        const taken = /at revision (\d+)/.exec(run.stdout.split("\n")[1] ?? "")?.[1];
        expect(Number(taken), run.stdout).toBeGreaterThan(before);
        expect(run.code, run.stdout).toBe(code);
      }
    });
  },
);

/** The store's revision once it has not moved for 1.5 s: no edit is left to store. */
async function stillRevision(repo: FixtureRepo): Promise<number> {
  const revision = () =>
    withStore(repo, (store) => store.revisions.latest(repo.worktreeId as never)?.number ?? 0);
  let last = revision();
  let since = Date.now();
  for (const end = Date.now() + 60_000; Date.now() < end; ) {
    await sleep(100);
    const now = revision();
    if (now !== last) [last, since] = [now, Date.now()];
    else if (Date.now() - since >= 1_500) return now;
  }
  throw new Error(`the revision did not stay still: ${last}`);
}

/** `squeal run <rest> --wait 150000` in this process, as the probe's `inproc` batch. */
async function inProcess(repo: FixtureRepo, rest: string[]) {
  const out: string[] = [];
  const io: CliIo = {
    stdout: (text) => void out.push(text),
    stderr: (text) => void out.push(text),
    cwd: repo.root,
    env: repo.env,
  };
  const code = await runGroupCommand({ waitMs: 150_000, rest }, io, "");
  return { code, stdout: out.join("") };
}

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
