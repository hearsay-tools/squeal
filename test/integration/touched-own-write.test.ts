import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, type PolicyInputs } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { type Harness, openHarness, openRepoStore, SLOW } from "../scheduler/helpers.js";
import {
  createRepo,
  freshOutcomes,
  NEW,
  OLD,
  scheduledRuns,
  stored,
  withheldByBarrier,
} from "./stamps-repo.js";
import {
  CSS_HELD,
  NEW_CSS,
  OLD_CSS,
  release,
  touchWhileHeld,
  VIRTUAL_HELD,
  warmOn,
} from "./touched-repo.js";

/*
 * Review wave-13e B1 (task 001-168): a run that rewrites a file with the
 * bytes it holds, while a cache serves it that file's other bytes. Its own
 * write proves nothing about which bytes it ran, so the touch withholds it
 * with observation on as with it off. The barrier's withhold runs the
 * files once more, on the bytes on disk (task 007-30). The stylesheet is in
 * no closure, so only the runner's touch, not the scheduler's barrier, can
 * withhold it; that withhold queues the file again too, counted toward
 * `MAX_DISCARDS` (issue 10, task 011-06), and the run once more, released,
 * no longer rewrites it.
 */

const ref = (path: string) => ({ project: "", path });
const VIRTUAL_TEST = ref("test/virtual.test.ts");
const PLAIN_TEST = ref("test/plain.test.ts");
const CSS_TEST = ref("test/css.test.ts");

const open = (files: Readonly<Record<string, string>>, observe: boolean, inputs: PolicyInputs) => {
  const repo = createRepo(files);
  return openHarness(repo.main, openRepoStore(repo.commonDir), repo.commonDir, {
    observe,
    tierSize: 4,
    runnerPartBesideRun: true,
    policy: { ...RUN_MISSING, inputs },
  });
};

/** The reasons `markUnknown` stored for `path`. */
const reasons = (h: Harness, path: string) =>
  h.sink
    .callsOf("markUnknown")
    .filter((call) => call.testFiles.some((f) => f.path === path))
    .map((call) => call.reason);

const written = (path: string) =>
  expect.stringMatching(new RegExp(`${path} was written .*and ended as it was`));

describe("a run that rewrites a cached virtual module's declared input (review wave-13e B1)", () => {
  it("fails on the bytes on disk under a fresh adapter (the control)", SLOW, async () => {
    const repo = createRepo(VIRTUAL_HELD);
    release(repo.main);
    expect(await freshOutcomes(repo.main, [VIRTUAL_TEST, PLAIN_TEST])).toEqual([
      ["", "test/plain.test.ts", "fail"],
      ["", "test/virtual.test.ts", "fail"],
    ]);
  });

  it.each([true, false])("stores none of the run (observe %s)", SLOW, async (observe) => {
    const h = await open(VIRTUAL_HELD, observe, ["src/mod.ts"]);
    const runs = scheduledRuns(h);
    await touchWhileHeld(
      h,
      async (adapter) => {
        await warmOn(h, adapter, [VIRTUAL_TEST], "src/mod.ts", NEW, OLD);
        await adapter.closure(PLAIN_TEST);
      },
      "src/mod.ts",
    );
    expect(stored(h)).toEqual([
      ["", "test/plain.test.ts", "current", "fail"],
      ["", "test/virtual.test.ts", "current", "fail"],
    ]);
    withheldByBarrier(h, runs, "test/virtual.test.ts");
  });
});

describe("a run that rewrites a stylesheet no closure names (review wave-13e B1)", () => {
  it("fails on the bytes on disk under a fresh adapter (the control)", SLOW, async () => {
    const repo = createRepo(CSS_HELD);
    release(repo.main);
    expect(await freshOutcomes(repo.main, [CSS_TEST])).toEqual([["", "test/css.test.ts", "fail"]]);
  });

  // Task 011-06 replaces "stores nothing, unknown with the reason": the runner's withhold
  // queues the file again, and what is stored is the run once more's, the control's fail
  // (a new failure is then run again to confirm it, task 001-171).
  it.each([true, false])(
    "stores none of the run, then the bytes on disk (observe %s)",
    SLOW,
    async (observe) => {
      const h = await open(CSS_HELD, observe, DEFAULT_POLICY.inputs);
      const runs = scheduledRuns(h);
      await touchWhileHeld(
        h,
        (adapter) => warmOn(h, adapter, [CSS_TEST], "src/base.css", NEW_CSS, OLD_CSS),
        "src/base.css",
      );
      const ids = new Set(runs.map((run) => run.runId));
      const ran = h.runsOf(CSS_TEST.path).filter((run) => ids.has(run.options.runId));
      expect(ran.length).toBeGreaterThanOrEqual(2);
      expect(ran[0]?.report.failure).toEqual(written("src/base.css"));
      expect(ran[0]?.report.completedFiles).toEqual([]);
      for (const run of ran.slice(1)) expect(run.report.completedFiles).toEqual([CSS_TEST]);
      expect(stored(h)).toEqual([["", "test/css.test.ts", "current", "fail"]]);
      expect(reasons(h, "test/css.test.ts")).toEqual([]);
    },
  );
});
