import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFsHasher } from "../../src/core/hash/index.js";
import { statCandidates } from "../../src/core/revision/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { heldRun, pause, SETTLE_MS } from "./tier-yields-fixture.js";

/*
 * Row 011-117, review `reviews/0.1.268.md` B1 (spec 011 C4 step 5 as
 * amended 2026-10-22): a listing a run observes for the first time is
 * judged at the run's end like one its key already held. The test file's
 * closure holds only itself; its first run lists `lib/`, passes when it saw
 * `expected` there, and waits at a gate. A scratch file's add or delete
 * puts no listing in `Tier.changes`, so before the repair the run's result
 * was stored under the grown key, with `lib/` as it stood at the end, and
 * was current: a false PASS no second run corrected.
 */

const OBSERVES: CatchUpFile = { path: "test/observes.test.ts", ms: 100, imports: [] };
const SWAP = "lib/.a.txt.swp";
const ADDED = "lib/added.txt";

interface Observer {
  readonly side: CatchUpSide;
  batch(path: string): Promise<void>;
  /** Releases the held run and every later one. */
  release(): void;
  /** How many runs held `OBSERVES`. */
  runs(): number;
  /** The outcome of each of its test checks, `outcome/validity`. */
  states(): string[];
}

/** A side whose start's run of `OBSERVES` lists `lib/` and is held; `before` paths exist from the start. */
async function observer(expected: readonly string[], before: readonly string[] = []) {
  const repo = catchUpRepo([OBSERVES], ["lib/a.txt"]);
  const side = catchUpSide(repo, repo.main, {
    files: [OBSERVES],
    hostSlots: 8,
    policy: RUN_MISSING,
  });
  for (const path of before) writeFileSync(join(side.root, path), "scratch\n");
  const run = side.runner.run.bind(side.runner);
  side.runner.run = async (files, options) => {
    // The run lists `lib/` before its gate; what it saw decides its outcome.
    const seen = readdirSync(join(side.root, "lib")).sort();
    if (seen.join() === [...expected].sort().join()) side.runner.failing.delete(OBSERVES.path);
    else side.runner.failing.add(OBSERVES.path);
    const report = await run(files, options);
    const observed = report.completedFiles.map((testFile) => ({
      testFile,
      paths: [],
      directories: ["lib"],
    }));
    return { ...report, observed };
  };
  let held = true;
  side.runner.beforeRun = () => (held ? side.runner.hold() : side.runner.release());
  await side.scheduler.start();
  const first = await heldRun(side, OBSERVES.path, 0);
  expect(side.store.testFiles.get({ project: "", path: OBSERVES.path })?.closure.paths).toEqual([
    OBSERVES.path,
  ]);
  const hasher = createFsHasher(side.root, "sha1");
  const o: Observer = {
    side,
    batch: async (path) =>
      side.scheduler.handleBatch({ trigger: "watch", paths: await statCandidates([path], hasher) }),
    release: () => {
      held = false;
      side.runner.release();
    },
    runs: () => side.runner.runsOf(OBSERVES.path).length,
    states: () =>
      side.store.knownStates
        .list(side.worktreeId)
        .filter((s) => s.check.kind === "test" && s.check.testPath === OBSERVES.path)
        .map((s) => `${s.outcome}/${s.validity}`),
  };
  return { o, first };
}

/** Creates `path` during the held run, applies its batch, then lets every run go. */
async function addDuringRun(o: Observer, path: string): Promise<void> {
  writeFileSync(join(o.side.root, path), "new\n");
  await o.batch(path);
  await pause(SETTLE_MS);
  o.release();
  await o.side.scheduler.idle();
}

describe("a listing a run observes first is judged at its end (row 011-117, review 0.1.268 B1)", {
  timeout: 120_000,
}, () => {
  it("control: an ordinary add during the run discards its result; the re-run fails", async () => {
    const { o } = await observer(["a.txt"]);
    await addDuringRun(o, ADDED);
    expect(o.runs()).toBeGreaterThan(1);
    expect(o.states()).toEqual(["fail/current"]);
  });

  it("a swap file left present: the result is not stored as current; it re-runs and fails like the control", async () => {
    const { o, first } = await observer(["a.txt"]);
    await addDuringRun(o, SWAP);
    expect(first.cancelled).toBe(false);
    expect(first.completed.map((f) => f.path)).toEqual([OBSERVES.path]);
    // Red before the repair: one run, and its PASS current under the grown key.
    expect(o.runs()).toBeGreaterThan(1);
    expect(o.states()).toEqual(["fail/current"]);
    expect(o.side.store.testFiles.get({ project: "", path: OBSERVES.path })?.closure.paths).toEqual(
      ["lib/", OBSERVES.path],
    );
  });

  it("a swap file created and removed during the run: the result stores and is current", async () => {
    const { o, first } = await observer(["a.txt"]);
    writeFileSync(join(o.side.root, SWAP), "new\n");
    await o.batch(SWAP);
    rmSync(join(o.side.root, SWAP));
    await o.batch(SWAP);
    await pause(SETTLE_MS);
    o.release();
    await o.side.scheduler.idle();
    expect(first.cancelled).toBe(false);
    expect(o.runs()).toBe(1);
    expect(o.states()).toEqual(["pass/current"]);
  });

  it("a swap file there when the run listed it and removed during it: no false PASS", async () => {
    const { o } = await observer([".a.txt.swp", "a.txt"], [SWAP]);
    rmSync(join(o.side.root, SWAP));
    await o.batch(SWAP);
    await pause(SETTLE_MS);
    o.release();
    await o.side.scheduler.idle();
    // Red before the repair: its PASS, from a listing with the swap file, current without it.
    expect(o.runs()).toBeGreaterThan(1);
    expect(o.states()).toEqual(["fail/current"]);
  });
});
