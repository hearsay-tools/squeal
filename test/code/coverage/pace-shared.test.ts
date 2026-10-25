import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCoverageWriter, Pace } from "../../../src/core/code/coverage/index.js";
import type { Store } from "../../../src/core/types/index.js";
import { WT } from "../../state/helpers.js";
import { COVERED, coverageRig, sourceOf } from "../crap/rig.js";
import { commonDir, ON } from "../helpers.js";
import { daemonPass } from "../pass/helpers.js";
import { type PayloadSet, payloads } from "./payloads.js";

/*
 * Row 015-45 (review 0.1.305 S2): the records' writer and the coverage step
 * share one pace, so together they take about half of the main thread: a
 * unit of either starts no sooner than the unit before, of either, took.
 */

/** How long one writer job's look for its result key takes, by the clock. */
const JOB_MS = 60;
/** How long one test file's result lookup in the loader map takes, by the clock. */
const ROW_MS = 20;
const JOBS = 6;
const LOADERS = 12;

let set: PayloadSet | null = null;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setImmediate", "Date"], now: 1_000 });
});
afterEach(() => {
  vi.useRealTimers();
  set?.cleanup();
  set = null;
});

/** Each span of work by the clock, `[start, end]`, as the work's own hooks saw it. */
type Span = [number, number];

/** Spans that touch are one unit of work: a step's lookups, a job's map and store. */
function units(spans: readonly Span[]): Span[] {
  const merged: Span[] = [];
  for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last !== undefined && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

describe("one pace for the records' writer and the coverage step (row 015-45)", () => {
  it("keeps their work together within half of the main thread", async () => {
    const spans: Span[] = [];
    const busy = (ms: number) => {
      const start = Date.now();
      vi.setSystemTime(start + ms);
      spans.push([start, start + ms]);
    };
    const pace = new Pace(Date.now);

    const rig = coverageRig();
    rig.tree.write("src/a.ts", "hot 12 h1\ncold 6 c1\n").revise();
    const results = rig.main.results;
    let timed = false;
    const main = {
      testFileKeys: rig.main.testFileKeys,
      results: {
        byKey: (...args: Parameters<Store["results"]["byKey"]>) => {
          if (timed) busy(ROW_MS);
          return results.byKey(...args);
        },
      },
    } as unknown as Pick<Store, "results" | "testFileKeys">;
    const run = daemonPass(rig.tree, {
      policy: () => COVERED,
      now: Date.now,
      coverage: { main, closures: () => rig.closures, writing: () => false, pace },
    });
    run.code.nudge();
    await run.code.idle();
    await vi.advanceTimersByTimeAsync(10_000);
    const blob = rig.store.files.list(WT, ["src/a.ts"])[0]?.blob ?? "";
    for (let t = 0; t < LOADERS; t++) {
      rig.loader(`test/t${t}.test.ts`, {
        closure: ["src/a.ts"],
        record: [sourceOf("src/a.ts", blob, 2, [1])],
      });
    }

    const own = payloads(2, 5);
    set = own;
    const writer = createCoverageWriter({
      commonDir: commonDir(),
      format: "sha1",
      policy: () => ON,
      resultKey: (_run, testFile) => {
        busy(JOB_MS);
        return `key-${testFile.path}`;
      },
      log: () => {},
      worker: null,
      pace,
    });

    timed = true;
    writer.collected({
      runId: "run-1",
      files: Array.from({ length: JOBS }, (_, i) => own.file(`test/w${i}.test.ts`)),
    });
    run.code.soon();
    await vi.advanceTimersByTimeAsync(100 * JOB_MS);
    await writer.idle();
    await run.code.idle();
    await writer.close();
    await run.code.close();

    expect(rig.states("crap")).toEqual(["cold fail 42", "hot pass 12"]);
    const worked = units(spans);
    expect(worked.length).toBeGreaterThanOrEqual(JOBS + LOADERS / 3);
    for (let i = 1; i < worked.length; i++) {
      const [start, end] = worked[i - 1] ?? [0, 0];
      const [next] = worked[i] ?? [0, 0];
      expect(next - end, `unit ${i} at ${next}, after ${start} to ${end}`).toBeGreaterThanOrEqual(
        end - start,
      );
    }
    const first = worked[0]?.[0] ?? 0;
    const last = worked.at(-1)?.[1] ?? 0;
    const total = worked.reduce((sum, [start, end]) => sum + end - start, 0);
    expect(total / (last - first)).toBeLessThan(0.55);
  });
});
