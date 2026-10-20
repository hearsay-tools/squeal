import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { waitForStatus } from "../../src/cli/status-wait.js";
import { type EndedWait, waitLine } from "../../src/cli/status-wait-lines.js";
import {
  A,
  answering,
  finish,
  key,
  later,
  options,
  repoWith,
  SLOW_FILE,
} from "./status-wait-fixture.js";

/*
 * Spec 004 D8 as amended 2026-10-18 (gh-35, task 004-71;
 * `research/issue-35.md`, its reproduction): a docs edit re-keys one fast
 * test file, whose result comes in, while the slow files were never run.
 * The quiet line's slow-file clause follows `stop.requireSlowSuite`, as the
 * `Slow tier:` line's ending does. Amended 2026-10-19 (row 004-83): off, it
 * names `run --slow --wait 60000` as the wait for their results.
 */

const SECOND = "test/slow-two.test.ts";

/**
 * The issue's sequence: `A` re-keyed by the edit and finished, two slow files
 * not run, or with `queued` that many of them queued instead (004-80).
 */
async function docsOnly(stop: Record<string, unknown>, trigger = "continuous", queued = 0) {
  const { repo, store } = repoWith([A]);
  [SLOW_FILE, SECOND].forEach((path, i) => {
    key(store, repo.mainId, path, i < queued ? "queued" : null);
  });
  writeFileSync(
    join(repo.main, "squeal.config.json"),
    JSON.stringify({ slow: { include: [SLOW_FILE, SECOND], trigger }, stop }),
  );
  later(200, () => finish(store, repo.mainId, A));
  const wait = await waitForStatus(repo.main, options(answering(store, repo.mainId, [A]).sync));
  expect(wait.outcome).toBe("quiet");
  expect(wait.result).toMatchObject({ slowTier: { notRun: 2 - queued, pending: queued } });
  return waitLine(wait as EndedWait);
}

const EDIT =
  /^Returned on quiet: the 1 test file the edits since revision 4 re-keyed is not pending, at revision 4 after \d+\.\d s/;

describe("the quiet `status --wait` line follows `stop.requireSlowSuite` (004-71)", () => {
  it("off: says the slow files are not required before the agent finishes", async () => {
    const line = await docsOnly({ requireSlowSuite: false });

    expect(line).toMatch(EDIT);
    expect(line).toContain(
      "; 2 slow files are not current; this repository does not require them before you finish; `squeal run --slow --wait 60000` waits for their results. Worktree: ",
    );
    // Row 004-83: off names the wait too, as the way to their results; it no longer says "runs".
    expect(line).not.toContain("runs them");
  });

  it("off by default, with no `stop` key", async () => {
    const line = await docsOnly({});

    expect(line).toContain("this repository does not require them before you finish");
  });

  it("on: unchanged, naming the command that runs and waits for them", async () => {
    const line = await docsOnly({ requireSlowSuite: true });

    expect(line).toMatch(EDIT);
    expect(line).toContain(
      "; 2 slow files are not current, which this wait does not hold for: `squeal run --slow --wait 60000` runs and waits for them. Worktree: ",
    );
    expect(line).not.toContain("does not require");
  });
});

/*
 * Row 004-80 (the coordinator's condition on the brief's quiet-line clause,
 * 2026-10-19): under `slow.trigger: "continuous"` the quiet line says the
 * pending slow files run after the fast tests, so the return on quiet does
 * not read as their running only on a pause; under `"idle"` it is 004-71's.
 */
describe("the quiet `status --wait` line's slow clause by slow.trigger (004-80)", () => {
  it("continuous, off: the queued slow files run after the fast tests", async () => {
    const line = await docsOnly({}, "continuous", 2);

    expect(line).toContain(
      "; 2 slow files are not current and Squeal runs them after the fast tests; this repository does not require them before you finish; `squeal run --slow --wait 60000` waits for their results. Worktree: ",
    );
  });

  it("continuous, on: the same clause before the command that waits for them", async () => {
    const line = await docsOnly({ requireSlowSuite: true }, "continuous", 2);

    expect(line).toContain(
      "; 2 slow files are not current and Squeal runs them after the fast tests, which this wait does not hold for: `squeal run --slow --wait 60000` runs and waits for them. Worktree: ",
    );
  });

  it("continuous, one queued and one not run: only the pending one is said to run", async () => {
    const line = await docsOnly({}, "continuous", 1);

    expect(line).toContain(
      "; 2 slow files are not current and Squeal runs the pending ones after the fast tests; this repository",
    );
  });

  it("idle: 004-71's clause, with no claim of when they run", async () => {
    const line = await docsOnly({}, "idle", 2);

    expect(line).toContain(
      "; 2 slow files are not current; this repository does not require them before you finish; `squeal run --slow --wait 60000` waits for their results. Worktree: ",
    );
    expect(line).not.toContain("after the fast tests");
  });
});
