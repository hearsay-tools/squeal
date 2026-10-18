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
 * `Slow tier:` line's ending does.
 */

const SECOND = "test/slow-two.test.ts";

/** The issue's sequence: `A` re-keyed by the edit and finished, two slow files not run. */
async function docsOnly(stop: Record<string, unknown>) {
  const { repo, store } = repoWith([A]);
  for (const path of [SLOW_FILE, SECOND]) key(store, repo.mainId, path, null);
  writeFileSync(
    join(repo.main, "squeal.config.json"),
    JSON.stringify({ slow: { include: [SLOW_FILE, SECOND] }, stop }),
  );
  later(200, () => finish(store, repo.mainId, A));
  const wait = await waitForStatus(repo.main, options(answering(store, repo.mainId, [A]).sync));
  expect(wait.outcome).toBe("quiet");
  expect(wait.result).toMatchObject({ slowTier: { notRun: 2, pending: 0 } });
  return waitLine(wait as EndedWait);
}

const EDIT =
  /^Returned on quiet: nothing the edits since revision 4 re-keyed is pending \(1 test file\) at revision 4 after \d+\.\d s/;

describe("the quiet `status --wait` line follows `stop.requireSlowSuite` (004-71)", () => {
  it("off: says the slow files are not required before the agent finishes", async () => {
    const line = await docsOnly({ requireSlowSuite: false });

    expect(line).toMatch(EDIT);
    expect(line).toContain(
      "; 2 slow files are not current; this repository does not require them before you finish (`squeal run --slow` runs them). Worktree: ",
    );
    expect(line).not.toContain("--wait 60000");
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
