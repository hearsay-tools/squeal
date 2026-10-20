import { describe, expect, it } from "vitest";
import { type NextStep, nextStep, type Standing } from "../../src/core/status/next-step.js";
import {
  PATHS_IN_COMMAND,
  reasonWords,
  stepCommand,
  stepText,
} from "../../src/core/status/next-step-text.js";
import type { EpochMs } from "../../src/core/types/index.js";

/*
 * Row 011-27 (011 C15 as amended 2026-10-20; `tasks/011-24/design.md`
 * section 3): one case per row of the table, each state's reason and its
 * next step as a group of one file words them. The seeded-store rows are in
 * `test/cli/next-step-rows.test.ts` and `next-step-pending.test.ts`.
 */

const AT = new Date(2026, 9, 20, 16, 14, 56).getTime() as EpochMs;
const F = "test/a.test.ts";

/** The class line's reason and step for one file, and its command. */
function one(s: Standing, named = true) {
  const next: NextStep = nextStep(s, { named });
  return {
    reason: reasonWords(next, [F], "squeal"),
    step: stepText(next.step, [F], "squeal"),
    command: stepCommand(next.step, [F], "squeal"),
  };
}

describe("nextStep: design 011-24 section 3, row by row (011-27)", () => {
  it("no daemon validating: `squeal start` starts one", () => {
    expect(one({ kind: "no-daemon", since: Date.UTC(2026, 9, 19, 16, 5), revision: 837 })).toEqual({
      reason:
        "no daemon has validated since 2026-10-19T16:05:00.000Z; results are as of revision 837",
      step: "`squeal start` starts one",
      command: "squeal start",
    });
  });

  it("discovery, the revision not listed: none needed in a named wait, the wait in status", () => {
    const s: Standing = { kind: "unlisted", revision: 5, callBoundMs: 666_000 };
    expect(one(s)).toEqual({
      reason:
        "revision 5 not listed yet, because the runner part waits for the run in flight, each of its calls bounded at 666 s",
      step: "",
      command: null,
    });
    expect(one(s, false).step).toBe("`squeal status --wait 60000` waits for it");
  });

  it("stale, nothing queued, under lookup-only: `squeal retry <file>` runs it once (gh-38)", () => {
    expect(one({ kind: "stale", verdict: "pass", lookupOnly: true })).toEqual({
      reason: "last passed at other inputs, nothing queued it (the baseline is lookup-only)",
      step: "`squeal retry test/a.test.ts` runs it once",
      command: "squeal retry test/a.test.ts",
    });
  });

  it("never run at its inputs, nothing queued: retry runs it once", () => {
    expect(one({ kind: "never-run", lookupOnly: false })).toMatchObject({
      reason: "never run at its inputs, nothing queued it",
      step: "`squeal retry test/a.test.ts` runs it once",
    });
  });

  it("timed out in a tier of its own: retry, with the load while it is at or above the CPU count (gh-43)", () => {
    const busy = { oneMinute: 30.2, cpus: 24 };
    expect(one({ kind: "timed-out", reason: "timed out after 600 s", load: busy })).toEqual({
      reason: "timed out after 600 s; Squeal does not run it again at these inputs by itself",
      step: "`squeal retry test/a.test.ts` runs it once (load average 30.20 on 24 CPUs now: under that load it may time out again)",
      command: "squeal retry test/a.test.ts",
    });
    const quiet = { oneMinute: 7.45, cpus: 24 };
    expect(one({ kind: "timed-out", reason: "timed out after 600 s", load: quiet }).step).toBe(
      "`squeal retry test/a.test.ts` runs it once",
    );
  });

  it("ran and recorded nothing: the recorded reason, retry runs it once", () => {
    const reason = "ran, nothing recorded: inputs changed during 3 runs in a row";
    expect(one({ kind: "no-result", reason })).toMatchObject({
      reason,
      step: "`squeal retry test/a.test.ts` runs it once",
    });
  });

  it("its project's global setup failed: the next edit or run --all starts the runner again", () => {
    expect(one({ kind: "setup-failed" })).toMatchObject({
      reason: "its project's global setup failed",
      step: "the next edit or `squeal run --all --wait` starts the runner again",
    });
  });

  it("no key, a runner call failed: the runner's message, the next edit or run --all calls it again", () => {
    expect(one({ kind: "runner", reason: "vitest: config failed to load" })).toMatchObject({
      reason: "vitest: config failed to load",
      step: "the next edit or `squeal run --all --wait` calls the runner again",
    });
  });

  it("no dependencies installed: the header's install command installs them", () => {
    expect(one({ kind: "no-install", command: "npm ci" })).toEqual({
      reason: "no dependencies are installed in this worktree",
      step: "`npm ci` installs them",
      command: "npm ci",
    });
    expect(one({ kind: "no-install", command: null }).command).toBeNull();
  });

  it("another worktree's claim: none, its result is shared here", () => {
    const until = AT + 606_000;
    expect(one({ kind: "claim", worktree: "/repo/other", until })).toEqual({
      reason: "waiting for /repo/other's run of its key, at most until 16:25:02",
      step: "its result is shared here when that run stores it",
      command: null,
    });
  });

  it("slow: the command is in the reason", () => {
    expect(one({ kind: "slow" })).toEqual({
      reason: "slow, run after the fast tests or on `squeal run --slow`",
      step: "",
      command: "squeal run --slow",
    });
  });

  it("running alone in its run: none needed", () => {
    expect(one({ kind: "running", lane: "vitest", since: AT, files: 1 })).toEqual({
      reason: "running since 16:14:56 in the vitest lane",
      step: "",
      command: null,
    });
  });

  it("in a run of several files: in that tier, not running, and no command runs it sooner (gh-40 A)", () => {
    expect(one({ kind: "running", lane: "vitest", since: AT, files: 27 })).toEqual({
      reason: "in the vitest tier of 27 test files running since 16:14:56",
      step: "no command runs it sooner (a running tier is not interrupted)",
      command: null,
    });
  });

  it("queued behind a running tier: no command in a named wait, a named wait in status (gh-40 B)", () => {
    const s: Standing = { kind: "queued", lane: "vitest", behind: AT, files: 4 };
    expect(one(s)).toEqual({
      reason: "queued behind the vitest tier of 4 test files running since 16:14:56",
      step: "no command runs it sooner (a running tier is not interrupted)",
      command: null,
    });
    expect(one(s, false).step).toBe(
      "`squeal status --wait 60000 <test file>` moves a named one ahead when that tier ends",
    );
  });

  it("queued with nothing recorded holding it: says so and where each file's state is (gh-41)", () => {
    expect(one({ kind: "queued", lane: "vitest", behind: null })).toEqual({
      reason: "queued; no run is open and nothing recorded holds it",
      step: "the store records no reason the daemon has not taken it (`squeal status --json` lists each file's state)",
      command: null,
    });
  });

  it("a checkpoint in progress: `squeal run --all --wait` waits for it", () => {
    expect(one({ kind: "checkpoint" }).step).toBe("`squeal run --all --wait` waits for it");
  });

  it("a running slow file whose project has a global setup: the one-file environment retry (gh-46)", () => {
    const s: Standing = {
      kind: "running",
      lane: "slow:vitest",
      since: AT,
      files: 1,
      setup: { file: "e2e/environment.ts" },
    };
    expect(one(s)).toEqual({
      reason:
        "running since 16:14:56 in the slow vitest lane; its project's global setup (e2e/environment.ts) ran once when this slow pass started, and Squeal does not hold what it started, so another run of that project meanwhile may replace it",
      step: "after an environment failure, `squeal retry test/a.test.ts --reason environment` runs this one file again",
      command: "squeal retry test/a.test.ts --reason environment",
    });
    // Without a setup the store knows of, the clause is left out and the retry hint stays.
    const { setup: _setup, ...bare } = s;
    expect(one(bare).reason).toBe("running since 16:14:56 in the slow vitest lane");
    expect(one(bare).command).toBe("squeal retry test/a.test.ts --reason environment");
  });
});

describe("a group's command names its paths up to three (design 011-24 Q5)", () => {
  const stale = nextStep({ kind: "stale", verdict: "pass", lookupOnly: false });
  const paths = (n: number) => Array.from({ length: n }, (_, i) => `test/f${i}.test.ts`);

  it(`names every path up to ${PATHS_IN_COMMAND}`, () => {
    expect(stepText(stale.step, paths(3), "squeal")).toBe(
      "`squeal retry test/f0.test.ts test/f1.test.ts test/f2.test.ts` runs each once",
    );
  });

  it("names <test file>... and how many files the full-suite run runs above that", () => {
    const counted = nextStep({ kind: "stale", verdict: "pass", lookupOnly: false, notCurrent: 24 });
    expect(stepText(counted.step, paths(4), "squeal")).toBe(
      "`squeal retry <test file>...` runs each once, `squeal run --all --wait` runs all 24 test files not current here",
    );
    expect(stepText(stale.step, paths(4), "squeal")).toBe(
      "`squeal retry <test file>...` runs each once, `squeal run --all --wait` runs every test file not current here",
    );
  });
});
