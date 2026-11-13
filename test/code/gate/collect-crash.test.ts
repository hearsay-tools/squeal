import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Overrun } from "../../../src/core/code/gate/progress.js";
import { git } from "../../hash/git-repo.js";
import { changedSet, collect, judged, project } from "./collect-fixture.js";

/*
 * Review 0.1.464 B1 (row 020-43): the reviewer's probe. In the `lanes`
 * fixture, `test/b1.test.ts` kills its own Vitest worker, so Vitest never
 * ends its module, while node:test's `n1/slow.test.ts` holds the budget.
 * Before, the dead file's timer outlived Vitest's run, and the gate named
 * it "still running" about ten seconds after Vitest had returned. Now
 * Vitest's run ends its files with it: only the node:test file is named.
 */

/** As `collect-lanes.test.ts`: room for a loaded host, past the 10 s floor of a name. */
const BUDGET = 25;

/** Kills the worker process only: the fixture's Vitest runs each file in a forked process. */
const KILLS_ITS_WORKER = `import { isMainThread } from "node:worker_threads";
import { expect, it } from "vitest";
import { b } from "../src/b";

it("b1", () => {
  expect(b(1)).toBe(1);
  expect(isMainThread).toBe(true);
  process.kill(process.pid, "SIGKILL");
});
`;

describe("collectEvidence: a Vitest worker dies beside a running node:test lane (review 0.1.464 B1)", () => {
  it("names only the file still running", { timeout: 180_000 }, async () => {
    const root = project("lanes");
    writeFileSync(join(root, "test/b1.test.ts"), KILLS_ITS_WORKER);
    git(root, ["commit", "-qam", "b1 kills its worker"]);
    const changed = await changedSet(root, ["src/a.ts", "src/b.ts"]);
    const overran: Overrun[] = [];
    const { evidence } = await collect(root, changed, {
      budgetSeconds: BUDGET,
      overran: (file) => overran.push(file),
    });

    expect(overran.map((o) => [o.runner, o.path])).toEqual([["node-test", "n1/slow.test.ts"]]);
    expect(overran[0]?.usedSeconds).toBeLessThan(BUDGET);
    expect(evidence.timedOut).toBe(true);
    // A crashed Vitest run completes none of its files; each started, so none reads not started.
    const unfinished = evidence.testFiles.filter((f) => !f.completed);
    expect(unfinished.map((f) => [f.runner, f.path, f.notStarted])).toEqual([
      ["vitest", "test/b1.test.ts", undefined],
      ["vitest", "test/b2.test.ts", undefined],
      ["vitest", "test/b3.test.ts", undefined],
      ["node-test", "n1/slow.test.ts", undefined],
    ]);
    const { report } = await judged(root, changed, evidence);
    expect(report.verdict).toBe("incomplete");
  });
});
