import { describe, expect, it } from "vitest";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { expectAgrees } from "./agree.js";
import { type E2E, e2eSuite, HOOK_BUDGET_MS, MATH, OTHER_SESSION, until } from "./harness.js";

/*
 * Spec 001 goal 6, D10 and D11, end to end, and review wave 3 S2 and S3: a
 * SIGKILLed daemon is replaced by the next SessionStart; a consumer told at a
 * tool boundary while no daemon validates hears it once, and once more when
 * one does again; a bad `squeal.config.json` is one note and a running daemon.
 */

const fixture = e2eSuite();
const ADDS = "test/math.test.ts > math > adds";
const quiet = (s: StatusSnapshot) => s.knownFailures.length === 0;
/** Two heartbeat intervals of 5 s, the grace before status calls a daemon down, plus slack. */
const DOWN_WAIT_MS = 30_000;

async function registered(e: E2E) {
  await e.hook("session-start", e.main);
  const ping = await e.daemonReady(e.main);
  await e.settle(e.main, "a passing baseline", (s) => s.counts.current > 0 && quiet(s));
  const first = await e.hook("post-tool-batch", e.main);
  expect(first.text).toMatch(/^SQUEAL · registered at revision \d+\n/);
  return ping;
}

async function kill(e: E2E, pid: number): Promise<void> {
  process.kill(pid, "SIGKILL");
  await until("the killed daemon to stop answering", 10_000, async () =>
    (await e.ping(e.main)) === null ? true : null,
  );
}

describe("a dead daemon", () => {
  it("is replaced by the next SessionStart", async (ctx) => {
    const e = fixture(ctx);
    const first = await registered(e);
    await kill(e, first.pid);

    // The socket file is left behind; SessionStart must not trust it.
    const start = await e.hook("session-start", e.main, { session_id: OTHER_SESSION });
    expect(start).toMatchObject({ code: 0, stderr: "" });
    expect(start.ms).toBeLessThan(HOOK_BUDGET_MS);
    expect(start.text).toMatch(/^SQUEAL · registered at revision \d+\n/);
    const second = await e.daemonReady(e.main, first.pid);
    expect(second.pid).not.toBe(first.pid);

    // The replacement validates: the first consumer hears the next regression.
    const broken = await e.edit(e.main, "math", MATH("-"), (s) => s.knownFailures.length === 1);
    expect(broken.daemon.state).toBe("alive");
    const told = await e.hook("post-tool-batch", e.main);
    expect(told.text).toContain(`FAIL  ${ADDS}\n      PASS -> FAIL`);
    expectAgrees(told.text, await e.status(e.main));
  }, 240_000);

  it("is named in the delivered header once while down and once when replaced", async (ctx) => {
    const e = fixture(ctx);
    const first = await registered(e);
    await kill(e, first.pid);
    const down = await until("status to report the daemon down", DOWN_WAIT_MS, async () => {
      const s = await e.status(e.main);
      return s.daemon.state === "down" ? s : null;
    });
    if (down.daemon.state !== "down" || down.daemon.since === null) throw new Error("not down");
    const since = new Date(down.daemon.since).toISOString();

    // Goal 6: hooks serve from the store with no daemon, within budget.
    const pre = await e.hook("pre-tool-use", e.main);
    expect(pre).toMatchObject({ code: 0, stdout: "" });
    expect(pre.ms).toBeLessThan(HOOK_BUDGET_MS);

    const told = await e.hook("post-tool-batch", e.main);
    expect(told).toMatchObject({ code: 0, stderr: "" });
    expect(told.ms).toBeLessThan(HOOK_BUDGET_MS);
    expect(told.text).toMatch(/^SQUEAL · no daemon is validating at revision \d+\n/);
    expect(told.text).toContain(
      `No daemon has validated since ${since}; results are as of revision ${down.revision}.`,
    );
    expectAgrees(told.text, down);

    // That boundary found the heartbeat stale and started a replacement (S2); SessionStart finds it.
    const start = await e.hook("session-start", e.main, { session_id: OTHER_SESSION });
    expect(start).toMatchObject({ code: 0, stderr: "" });
    const second = await e.daemonReady(e.main, first.pid);
    expect(second.pid).not.toBe(first.pid);
    const alive = await e.settle(e.main, "the replacement's heartbeat", quiet);

    const back = await e.hook("post-tool-batch", e.main);
    expect(back.text).toMatch(/^SQUEAL · a daemon is validating again at revision \d+\n/);
    expect(back.text).not.toContain("No daemon");
    expectAgrees(back.text, alive);
    expect((await e.hook("post-tool-batch", e.main)).stdout).toBe("");
  }, 240_000);
});

describe("a bad squeal.config.json", () => {
  const BAD = `${JSON.stringify({ stop: { waitMs: "500" }, runner: { tierSzie: 2 } }, null, 2)}\n`;
  const policyNotes = (s: StatusSnapshot) =>
    s.daemonNotes.filter((n) => n.text.includes("squeal.config.json"));

  it("yields one note and a running daemon", async (ctx) => {
    const e = fixture(ctx, { policy: BAD });
    const first = await registered(e);
    const status = await e.status(e.main);
    expect(status.daemon.state).toBe("alive");
    const notes = policyNotes(status);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.text).toContain('"stop.waitMs" must be a number >= 0, got "500"');
    expect(notes[0]?.text).toContain('unknown key "runner.tierSzie"');

    // Defaults apply: the daemon validates and the hooks deliver.
    await e.edit(e.main, "math", MATH("-"), (s) => s.knownFailures.length === 1);
    const told = await e.hook("post-tool-batch", e.main);
    expect(told.text).toContain(`FAIL  ${ADDS}\n      PASS -> FAIL`);
    const stop = await e.hook("stop", e.main);
    expect(stop).toMatchObject({ code: 0, stdout: "", stderr: "" });

    // More sessions and a restart with the same problems add no note.
    await e.hook("session-start", e.main, { session_id: OTHER_SESSION });
    expect((await e.ping(e.main))?.pid).toBe(first.pid);
    expect((await e.cli(e.main, ["stop"])).code).toBe(0);
    await e.hook("session-start", e.main, { session_id: "third-session" });
    await e.daemonReady(e.main, first.pid);
    const after = await e.settle(
      e.main,
      "the restarted daemon",
      (s) => s.knownFailures.length === 1,
    );
    expect(policyNotes(after)).toHaveLength(1);
  }, 240_000);
});
