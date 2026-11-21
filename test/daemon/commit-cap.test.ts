import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import type { CommitWorktrees } from "../../src/core/daemon/commit-mode.js";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import type { AbsolutePath, EpochMs } from "../../src/core/types/common.js";
import { createFixtureRepo, SLOW, waitFor } from "./helpers.js";

/*
 * Review wave-22 B2 (spec 023 D7.2: "at most 3 hours after start"): the
 * cap stops a commit daemon whose tier never ends. One requested test
 * signals its start and waits for a release file it never gets; with
 * `runner.timeoutMs: null` nothing else would end it. The cap cancels the
 * tier and ends the test's process, then the worktree is removed.
 */

const MINUTE = 60_000;
const CAP_MS = 30 * MINUTE;

/** A test that writes its pid to `started`, then waits for `release`. */
function blockedTest(started: string, release: string): string {
  return [
    'import { existsSync, writeFileSync } from "node:fs";',
    'import { setTimeout as sleep } from "node:timers/promises";',
    'import { test } from "vitest";',
    "",
    'test("blocked", async () => {',
    `  writeFileSync(${JSON.stringify(started)}, String(process.pid));`,
    `  while (!existsSync(${JSON.stringify(release)})) await sleep(50);`,
    "}, 600_000);",
    "",
  ].join("\n");
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("a commit daemon's cap with a tier that never ends (review wave-22 B2)", SLOW, () => {
  it("cancels the tier, ends its process, exits with lifetime-cap and removes the worktree", async () => {
    const signals = mkdtempSync("/tmp/sq-cap-");
    onTestFinished(() => rmSync(signals, { recursive: true, force: true }));
    const started = join(signals, "started");
    const release = join(signals, "release");
    const repo = createFixtureRepo({
      files: {
        "squeal.config.json": `${JSON.stringify({
          baseline: { onStart: "lookup-only" },
          runner: { timeoutMs: null },
          complexity: { enabled: false },
          coverage: { enabled: false },
        })}\n`,
        "test/blocked.test.ts": blockedTest(started, release),
      },
    });
    onTestFinished(repo.cleanup);
    let clock = Date.now();
    const removed: string[] = [];
    const worktrees: CommitWorktrees = {
      read: () => null,
      claim: () => {},
      remove: async (root: AbsolutePath) => void removed.push(root),
    };
    const daemon = await startDaemon({
      root: repo.root,
      env: repo.env,
      now: () => clock as EpochMs,
      timings: { checkMs: 20 },
      commitMode: true,
      commitWorktrees: worktrees,
      commitTimes: { maxLifeMs: CAP_MS },
    });
    if ("reason" in daemon) throw new Error(daemon.message);
    let exited = false;
    void daemon.exited.then(() => {
      exited = true;
    });
    onTestFinished(async () => {
      if (exited) return;
      // Without the cap's cancel the daemon waits for the test: release it to clean up.
      writeFileSync(release, "");
      await daemon.stop("stop-requested");
    });
    await daemon.ready;

    const answer = await requestDaemon(
      daemon.socketPath,
      { type: "run-group-paths", group: "tests", paths: ["test/blocked.test.ts"] },
      5_000,
    );
    expect(answer).toMatchObject({ ok: true, type: "run-group" });
    await waitFor(() => existsSync(started), 60_000, "the blocked test's start");
    const pid = Number(readFileSync(started, "utf8"));
    expect(alive(pid)).toBe(true);

    clock += CAP_MS;
    const exit = await Promise.race([
      daemon.exited,
      new Promise<null>((done) => setTimeout(() => done(null), 20_000)),
    ]);
    expect({ reason: exit?.reason ?? null, removed }).toEqual({
      reason: "lifetime-cap",
      removed: [repo.root],
    });
    expect(existsSync(release)).toBe(false);
    await waitFor(() => !alive(pid), 5_000, "the blocked test's process to end");
  });
});
