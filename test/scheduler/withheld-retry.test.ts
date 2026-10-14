import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDaemonNotes } from "../../src/core/notes.js";
import type { TestCheckId } from "../../src/core/types/index.js";
import { createRepo, type Harness, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Task 007-30: the completion barrier (task 001-168) withholds a run whose
 * input was written while it was in flight and ended as it was. No revision
 * follows such a touch, so before 007-30 the withheld files stayed `unknown`
 * with nothing queued. Now their previous state stands and they run once
 * more under their keys; a second withhold in a row leaves them `unknown`
 * with a note naming the path, and nothing runs again.
 */

const MATH = "test/math.test.ts";
const adds: TestCheckId = { kind: "test", project: "", testPath: MATH, fullName: "adds" };

/** Rewrites `src/math.ts` with its own bytes while `MATH` runs, `times` times; no batch reports it. */
function touchDuringRuns(h: Harness, times: number): void {
  let touches = 0;
  h.runner.beforeRun = (files) => {
    if (touches >= times || !files.some((f) => f.path === MATH)) return;
    touches += 1;
    const path = join(h.root, "src/math.ts");
    h.write("src/math.ts", readFileSync(path, "utf8"));
  };
}

const notes = (h: Harness) => readDaemonNotes(h.store, h.worktreeId).map((note) => note.text);

describe("a tier the completion barrier withholds (task 007-30)", SLOW, () => {
  it("runs once more when no revision follows the touch, and is current", async () => {
    const repo = createRepo();
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
      tierSize: 1,
    });
    touchDuringRuns(h, 1);
    await h.scheduler.start();
    await h.scheduler.idle();

    const runs = h.runsOf(MATH);
    expect(runs).toHaveLength(2);
    // Nothing of the withheld run is stored: the result is the second run's.
    const kept = h.store.results.listForCheck(adds, 10).map((r) => r.provenance.runId);
    expect(kept).toEqual([runs[1]?.options.runId]);
    expect(h.sink.stateOf(adds)).toMatchObject({ outcome: "pass", validity: "current" });
    expect(h.sink.callsOf("markUnknown")).toEqual([]);
    expect(h.header()).toMatchObject({
      counts: { pending: 0, unknown: 0 },
      testFilesWithoutChecks: { pending: 0, unknown: 0 },
    });
    // The withhold's reason is shown while the run is pending.
    expect(notes(h)).toEqual([
      expect.stringMatching(
        /src\/math\.ts was written while test\/math\.test\.ts ran.*runs once more/,
      ),
    ]);
  });

  it("is unknown with one note naming the path when it is touched on every run", async () => {
    const repo = createRepo();
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
      tierSize: 1,
    });
    touchDuringRuns(h, Number.POSITIVE_INFINITY);
    await h.scheduler.start();
    await h.scheduler.idle();

    expect(h.runsOf(MATH)).toHaveLength(2);
    expect(h.store.results.listForCheck(adds, 10)).toEqual([]);
    const reasons = h.sink
      .callsOf("markUnknown")
      .filter((call) => call.testFiles.some((f) => f.path === MATH))
      .map((call) => call.reason);
    expect(reasons).toEqual([
      expect.stringMatching(/src\/math\.ts was written while this run was in flight.*001-168/),
    ]);
    expect(h.header()).toMatchObject({
      counts: { pending: 0 },
      testFilesWithoutChecks: { pending: 0 },
    });
    const exhausted = notes(h).filter((text) => text.includes("stays unknown"));
    expect(exhausted).toEqual([
      expect.stringMatching(
        /src\/math\.ts was written during 2 runs in a row of test\/math\.test\.ts/,
      ),
    ]);

    // It stays unknown: an unrelated edit runs other files, never this one again.
    h.write("src/strings.ts", `${readFileSync(join(h.root, "src/strings.ts"), "utf8")}\n`);
    await h.batch("src/strings.ts");
    await h.scheduler.idle();
    expect(h.runsOf(MATH)).toHaveLength(2);
    expect(notes(h).filter((text) => text.includes("stays unknown"))).toHaveLength(1);
  });
});
