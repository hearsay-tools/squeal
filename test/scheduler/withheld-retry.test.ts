import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readDaemonNotes } from "../../src/core/notes.js";
import type { Store, TestCheckId } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { claimRepo, fileName, side } from "./claims-fixture.js";
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

/**
 * The run ids of every result `store` is given from now on (review 007-31,
 * S1): `putMany` replaces a check's result at its key, so the final store
 * cannot show that a withheld run's result was there for a moment.
 */
function puts(store: Store, testPath?: string): () => string[] {
  const spy = vi.spyOn(store.results, "putMany");
  return () => [
    ...new Set(
      spy.mock.calls.flatMap(([records]) =>
        records
          .filter((r) => testPath === undefined || r.check.testPath === testPath)
          .map((r) => r.provenance.runId),
      ),
    ),
  ];
}

const notes = (h: Harness) => readDaemonNotes(h.store, h.worktreeId).map((note) => note.text);

describe("a tier the completion barrier withholds (task 007-30)", SLOW, () => {
  it("runs once more when no revision follows the touch, and is current", async () => {
    const repo = createRepo();
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
      tierSize: 1,
      policy: RUN_MISSING,
    });
    touchDuringRuns(h, 1);
    const put = puts(h.store, MATH);
    await h.scheduler.start();
    await h.scheduler.idle();

    const runs = h.runsOf(MATH);
    expect(runs).toHaveLength(2);
    // Not even for a moment: the withheld run gave the store nothing (review 007-31, S1).
    expect(put()).not.toContain(runs[0]?.options.runId);
    expect(put()).toContain(runs[1]?.options.runId);
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
      policy: RUN_MISSING,
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

  it("keeps a validated file's state while its retry is pending", async () => {
    const repo = createRepo();
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
      tierSize: 1,
      policy: RUN_MISSING,
    });
    await h.scheduler.start();
    await h.scheduler.idle();
    expect(h.sink.stateOf(adds)).toMatchObject({ outcome: "pass", validity: "current" });
    const validated = h.store.results.listForCheck(adds, 10).map((r) => r.provenance.runId);

    // An edit re-keys it; its run at the new key is touched and withheld.
    h.write("src/math.ts", `${readFileSync(join(h.root, "src/math.ts"), "utf8")}\n`);
    const put = puts(h.store, MATH);
    const before = h.runsOf(MATH).length;
    touchDuringRuns(h, 1);
    let pending: unknown = null;
    const touch = h.runner.beforeRun;
    h.runner.beforeRun = (files) => {
      if (h.runsOf(MATH).length === before + 1 && files.some((f) => f.path === MATH)) {
        // The retry is starting: the withheld run stored nothing and marked nothing unknown.
        pending = {
          state: h.sink.stateOf(adds),
          unknown: h.sink.callsOf("markUnknown"),
          stored: h.store.results.listForCheck(adds, 10).map((r) => r.provenance.runId),
          put: put(),
        };
      }
      return touch?.(files);
    };
    await h.batch("src/math.ts");
    await h.scheduler.idle();

    const runs = h.runsOf(MATH).slice(before);
    expect(runs).toHaveLength(2);
    expect(pending).toEqual({
      state: expect.objectContaining({ outcome: "pass" }),
      unknown: [],
      stored: validated,
      put: [],
    });
    expect(put()).toEqual([runs[1]?.options.runId]);
    expect(h.sink.stateOf(adds)).toMatchObject({ outcome: "pass", validity: "current" });
  });

  it("runs once more when a re-keyed file is withheld at its new key", async () => {
    const repo = createRepo();
    const h = await openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
      tierSize: 1,
      policy: RUN_MISSING,
    });
    // The first run is withheld at K1 and edited, so the run once more is at K2, and withheld too.
    touchDuringRuns(h, 2);
    const touch = h.runner.beforeRun;
    let edited = false;
    h.runner.beforeRun = (files) => {
      touch?.(files);
      if (edited || !files.some((f) => f.path === MATH)) return;
      edited = true;
      writeFileSync(join(h.root, MATH), `${readFileSync(join(h.root, MATH), "utf8")}\n`);
    };
    const put = puts(h.store, MATH);
    await h.scheduler.start();
    await h.scheduler.idle();

    // K2 is new work: its first withhold is a first one, so it runs once more and is current.
    const runs = h.runsOf(MATH);
    expect(runs).toHaveLength(3);
    expect(put()).toEqual([runs[2]?.options.runId]);
    expect(h.sink.stateOf(adds)).toMatchObject({ outcome: "pass", validity: "current" });
    expect(notes(h).filter((text) => text.includes("runs once more"))).toHaveLength(2);
    expect(notes(h).filter((text) => text.includes("stays unknown"))).toEqual([]);
  });

  it("stops a file at its second withhold even beside a file withheld once (review 007-31, B1)", async () => {
    const { main } = claimRepo(3);
    const a = side(main, { count: 3, tierSize: 2, backlogTierSize: 2, policy: RUN_MISSING });
    a.runner.during = (files) => {
      for (const file of files) {
        const path = join(main, file.path);
        writeFileSync(path, readFileSync(path));
      }
    };
    const put = puts(a.store);
    await a.scheduler.start();
    await a.scheduler.idle();

    // No revision moves a key: each file runs twice at its key, whatever tier it shares.
    expect([0, 1, 2].map((i) => a.runner.ran(fileName(i)))).toEqual([2, 2, 2]);
    expect(put()).toEqual([]);
    expect([0, 1, 2].map((i) => a.phase(fileName(i)))).toEqual([null, null, null]);
    // Each file's second withhold is named once, in the note of the tier it stopped in.
    const stopped = readDaemonNotes(a.store, a.worktreeId)
      .map((note) => / in a row of (.*) and ended as it was/.exec(note.text)?.[1])
      .flatMap((ran) => ran?.split(", ") ?? []);
    expect(stopped.sort()).toEqual([0, 1, 2].map(fileName));
  });

  it("never queues an exhausted file again under a forced checkpoint (review 007-33, B1)", async () => {
    const { main } = claimRepo(3);
    const a = side(main, { count: 3, tierSize: 2, backlogTierSize: 2 });
    await a.scheduler.start();
    await a.scheduler.idle();
    const files = [0, 1, 2].map(fileName);
    const before = files.map((path) => a.runner.ran(path));
    const keys = files.map((path) => a.keyOf(path));
    const revision = a.store.revisions.latest(a.worktreeId)?.number;
    a.runner.during = (ran) => {
      for (const file of ran) {
        const path = join(main, file.path);
        writeFileSync(path, readFileSync(path));
      }
    };
    const put = puts(a.store);
    await a.scheduler.requestFullSuite({ force: true });
    await a.scheduler.idle();

    // The forced entry of a file withheld twice is not queued again: each runs twice at its key.
    expect(files.map((path, i) => a.runner.ran(path) - (before[i] ?? 0))).toEqual([2, 2, 2]);
    expect(files.map((path) => a.keyOf(path))).toEqual(keys);
    expect(a.store.revisions.latest(a.worktreeId)?.number).toBe(revision);
    expect(put()).toEqual([]);
    expect(files.map((path) => a.phase(path))).toEqual([null, null, null]);
    const stopped = readDaemonNotes(a.store, a.worktreeId)
      .map((note) => / in a row of (.*) and ended as it was/.exec(note.text)?.[1])
      .flatMap((ran) => ran?.split(", ") ?? []);
    expect(stopped.sort()).toEqual(files);
  });
});
