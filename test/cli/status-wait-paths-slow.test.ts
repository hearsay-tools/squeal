import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import type { DaemonSync, SyncState } from "../../src/cli/status-sync.js";
import { namedText } from "../../src/cli/status-wait-lines.js";
import { namedCode, waitForNamed } from "../../src/cli/status-wait-paths.js";
import type { RevisionNumber, Store } from "../../src/core/types/index.js";
import { check, state } from "../status/helpers.js";
import { A, finish, key, later, NOW, ref, repoWith, SLOW_FILE } from "./status-wait-fixture.js";

/*
 * Task 004-78 (research `atomic-flags-0215.md` 1, 2 and 4, item 1): a named
 * wait over a slow file that runs only on a pause held until its deadline,
 * 60 s in the eval cells, and returned no verdict. It now leaves such files
 * out of what it holds for and names them, under `stop.requireSlowSuite`
 * off and on.
 */

const synced = (): SyncState => ({
  state: "synced",
  revision: 4 as RevisionNumber,
  incarnation: null,
});
const sync = () => (): DaemonSync => ({ current: synced, stop: () => {} });

/**
 * `A` pending, then passing after 100 ms; the slow file queued, never run;
 * the policy's `stop` and `slow.trigger`, `"idle"` unless named (004-80).
 */
function fastAndSlow(stop: Record<string, unknown>, fast = true, trigger = "idle") {
  const { repo, store } = repoWith(fast ? [A, SLOW_FILE] : [SLOW_FILE]);
  writeFileSync(
    join(repo.main, "squeal.config.json"),
    JSON.stringify({ slow: { include: [SLOW_FILE], trigger }, stop }),
  );
  if (fast) later(100, () => finish(store, repo.mainId, A));
  return { repo, store };
}

async function named(root: string, paths: readonly string[], timeoutMs = 5_000) {
  const wait = await waitForNamed(root, paths, {
    timeoutMs,
    pollMs: 20,
    settleMs: 0,
    now: () => NOW,
    sync: sync(),
  });
  if (wait.outcome === "unavailable") throw new Error("unavailable");
  return {
    wait,
    text: namedText(wait, NOW),
    last: namedText(wait, NOW).trimEnd().split("\n").at(-1),
  };
}

async function run(argv: string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
    now: () => NOW,
    env: {},
  };
  const code = await main(argv, io);
  return { code, stdout, stderr };
}

const OFF =
  "; 1 slow test file waits for a pause or `squeal run --slow`, which this wait does not hold for: test/slow.test.ts; this repository does not require it before you finish; `squeal run --slow --wait 60000` waits for its result. Worktree: ";
const ON =
  "; 1 slow test file waits for a pause or `squeal run --slow`, which this wait does not hold for: test/slow.test.ts; this repository requires it before you finish: `squeal run --slow --wait 60000` runs and waits for it. Worktree: ";

describe("a named wait leaves out slow files that run only on a pause (004-78)", () => {
  for (const [label, stop, clause] of [
    ["off", { requireSlowSuite: false }, OFF],
    ["on", { requireSlowSuite: true, slowWaitMs: 1_000 }, ON],
  ] as const) {
    it(`gives the fast file's verdict once it has one and names the slow file pending, policy ${label}`, async () => {
      const { repo } = fastAndSlow(stop);

      const { wait, last } = await named(repo.main, [A, SLOW_FILE]);

      expect(wait.outcome).toBe("settled");
      expect(wait.waitedMs).toBeLessThan(2_000);
      expect(wait.leftForPause?.map((f) => f.path)).toEqual([SLOW_FILE]);
      expect(wait.verdict).toMatchObject({ testFiles: 1, byClass: { current: 1, pending: 0 } });
      expect(namedCode(wait)).toBe(0);
      expect(last).toMatch(
        /^Named test files at revision 4: no known failures; 1 test file, each with a current result, after \d+\.\d s/,
      );
      expect(last).toContain(clause);
    });
  }

  it("returns at once without a verdict when it selects only slow files, and says so", async () => {
    const { repo } = fastAndSlow({}, false);

    const { wait, text, last } = await named(repo.main, [SLOW_FILE]);

    expect(wait.outcome).toBe("slow");
    expect(wait.waitedMs).toBeLessThan(2_000);
    expect(namedCode(wait)).toBe(3);
    expect(text).toContain(
      `Pending (1):\n  1 slow, run when the agent pauses or on \`squeal run --slow\`: ${SLOW_FILE}\n`,
    );
    expect(last).toMatch(
      /^Named test files have no verdict: every selected test file is slow: 1 slow test file waits for a pause or `squeal run --slow`, which this wait does not hold for: test\/slow\.test\.ts; this repository does not require it before you finish; `squeal run --slow --wait 60000` waits for its result\. Worktree: /,
    );
  });

  it("says so in JSON: `leftForPause`, the verdict on the fast file, the line on stderr", async () => {
    const { repo } = fastAndSlow({});

    const out = await run(["status", "--json", "--wait", "5000", A, SLOW_FILE], repo.main);

    expect(out.code).toBe(0);
    const payload = JSON.parse(out.stdout).wait;
    expect(payload).toMatchObject({
      outcome: "settled",
      code: 0,
      leftForPause: [ref(SLOW_FILE)],
      verdict: { testFiles: 1 },
    });
    expect(payload.testFiles).toContainEqual({
      ...ref(SLOW_FILE),
      state: "pending",
      reason: "slow, run when the agent pauses or on `squeal run --slow`",
      command: "squeal run --slow",
    });
    expect(out.stderr).toContain(OFF);
  });

  it("still holds for a slow file that is running", async () => {
    const { repo, store } = fastAndSlow({});
    running(store, repo.mainId, SLOW_FILE);
    later(300, () => finish(store, repo.mainId, SLOW_FILE));

    const { wait, last } = await named(repo.main, [A, SLOW_FILE]);

    expect(wait.outcome).toBe("settled");
    expect(wait.leftForPause).toEqual([]);
    expect(wait.verdict).toMatchObject({ testFiles: 2, byClass: { current: 2 } });
    expect(last).not.toContain("waits for a pause");
  });

  it("counts a slow file that has a current result in the verdict", async () => {
    const { repo, store } = fastAndSlow({});
    finish(store, repo.mainId, SLOW_FILE);

    const { wait } = await named(repo.main, [A, SLOW_FILE]);

    expect(wait.outcome).toBe("settled");
    expect(wait.leftForPause).toEqual([]);
    expect(wait.verdict.testFiles).toBe(2);
  });
});

/*
 * Task 004-80: under `slow.trigger: "continuous"` a queued slow file runs in
 * the agent's turn once the revision is `slow.quietMs` old, so a named wait
 * holds for it as for any pending file.
 */
describe('a named wait under slow.trigger "continuous" holds for a queued slow file (004-80)', () => {
  it("holds until the slow file's result and counts it in the verdict", async () => {
    const { repo, store } = fastAndSlow({}, true, "continuous");
    later(400, () => finish(store, repo.mainId, SLOW_FILE));

    const { wait, last } = await named(repo.main, [A, SLOW_FILE]);

    expect(wait.outcome).toBe("settled");
    expect(wait.waitedMs).toBeGreaterThanOrEqual(300);
    expect(wait.leftForPause).toEqual([]);
    expect(wait.verdict).toMatchObject({ testFiles: 2, byClass: { current: 2, pending: 0 } });
    expect(last).not.toContain("waits for a pause");
  });

  it("over slow files alone, holds for their result rather than returning without a verdict", async () => {
    const { repo, store } = fastAndSlow({}, false, "continuous");
    later(400, () => finish(store, repo.mainId, SLOW_FILE));

    const { wait } = await named(repo.main, [SLOW_FILE]);

    expect(wait.outcome).toBe("settled");
    expect(wait.verdict).toMatchObject({ testFiles: 1, byClass: { current: 1 } });
  });
});

/** `path`'s row as running, as `startTier` writes it, with its check running. */
function running(store: Store, worktreeId: string, path: string) {
  key(store, worktreeId, path, "running");
  store.knownStates.upsertMany([
    state(worktreeId, check(path, "holds"), { validity: "pending", pendingPhase: "running" }),
  ]);
}
