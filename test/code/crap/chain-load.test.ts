import { loadavg } from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { readSummary } from "../../../src/core/code/crap/index.js";
import { WT } from "../../state/helpers.js";
import { daemonPass } from "../pass/helpers.js";
import { COVERED, coverageRig, sourceOf } from "./rig.js";

/*
 * Row 015-42, the 01:09 to 01:27 load of 011-197: after a run, the coverage
 * step judged a source or two per step, because each step read the loader
 * map, the signatures and the records of the file it judged again, outside
 * its budget. This repository's test files load most of its sources, so
 * each record holds most of them. Timing is asserted only on a machine
 * loaded no more than the other timing tests allow.
 */

const MAX_LOAD_FOR_TIMING = 8;
const SOURCES = 200;
const FUNCTIONS = 10;
const TEST_FILES = 300;
/** The longest main-thread turn the change feed may wait behind (011-197: about 1.1 s). */
const TURN_BUDGET_MS = 100;

const sourceText = (s: number) =>
  Array.from({ length: FUNCTIONS }, (_, f) => `f${f} ${1 + (f % 4)} b${s}x${f}`).join("\n");

describe("the coverage chain after a run (row 015-42)", () => {
  it(`judges ${SOURCES} sources each loaded by ${TEST_FILES} test files with no long turn`, async (ctx) => {
    const rig = coverageRig();
    const paths = Array.from({ length: SOURCES }, (_, s) => `src/m${s}.ts`);
    for (const [s, path] of paths.entries()) rig.tree.write(path, `${sourceText(s)}\n`);
    rig.tree.revise();
    const run = daemonPass(rig.tree, {
      policy: () => COVERED,
      now: Date.now,
      coverage: { main: rig.main, closures: () => rig.closures, writing: () => false },
    });
    run.code.nudge();
    await run.code.idle();
    const blobs = new Map(rig.store.files.list(WT).map((f) => [f.path, f.blob]));
    const ran = Array.from({ length: FUNCTIONS / 2 }, (_, f) => f + 1);
    const record = paths.map((path) => sourceOf(path, blobs.get(path) ?? "", FUNCTIONS, ran));
    for (let t = 0; t < TEST_FILES; t++) {
      rig.loader(`test/t${t}.test.ts`, { closure: paths, record });
    }

    const delay = monitorEventLoopDelay({ resolution: 10 });
    const judged = () =>
      Object.values(readSummary(rig.store.meta, WT)?.files ?? {}).filter(
        (f) => f.state === "judged",
      ).length;
    const began = performance.now();
    delay.enable();
    run.code.soon();
    await expect.poll(judged, { timeout: 120_000, interval: 50 }).toBe(SOURCES);
    const took = Math.round(performance.now() - began);
    delay.disable();
    await run.code.close();

    const longest = Math.round(delay.max / 1e6);
    const load = loadavg()[0] ?? 0;
    console.log(
      `coverage chain: ${SOURCES} sources by ${TEST_FILES} test files judged in ${took} ms; longest turn ${longest} ms; load average ${load.toFixed(1)}`,
    );
    if (load > MAX_LOAD_FOR_TIMING) {
      ctx.skip(
        `load average ${load.toFixed(1)} > ${MAX_LOAD_FOR_TIMING}; longest turn ${longest} ms`,
      );
    }
    expect(longest).toBeLessThan(TURN_BUDGET_MS);
  }, 180_000);
});
