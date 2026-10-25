import { randomBytes } from "node:crypto";
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
 * each record holds most of them. Row 015-45 reads the first loader map,
 * of a size 011-197's stores held, in slices. Timing is asserted only on a
 * machine loaded no more than the other timing tests allow, and with a wider
 * bound on CI (row 015-47).
 */

const MAX_LOAD_FOR_TIMING = 8;
const SOURCES = 200;
const FUNCTIONS = 10;
const TEST_FILES = 300;
/** 011-197's stores: keyed test files, the paths each closure names, and the files they name. */
const INCIDENT_TEST_FILES = 1_072;
const CLOSURE_PATHS = 290;
const CLOSED_FILES = 4_744;
const INCIDENT_SOURCES = 20;
/** Their records' mean size: each holds every source its test file ran. */
const RECORD_BYTES = 25_000;
/** The longest main-thread turn the change feed may wait behind (011-197: about 1.1 s). */
const TURN_BUDGET_MS = 100;
/**
 * Row 015-47: on GitHub's runners the 200-sources case read 63 to 119 ms at
 * 0.1.309, with no margin under 100, so CI asserts this; the log line keeps
 * the number.
 */
const CI_TURN_BUDGET_MS = 250;
const turnBudget = () => (process.env.CI === undefined ? TURN_BUDGET_MS : CI_TURN_BUDGET_MS);

const sourceText = (s: number) =>
  Array.from({ length: FUNCTIONS }, (_, f) => `f${f} ${1 + (f % 4)} b${s}x${f}`).join("\n");

/**
 * Times the chain `soon()` starts until `expected` files are judged: the
 * longest turn the change feed waited behind, asserted only on a machine
 * loaded no more than `MAX_LOAD_FOR_TIMING`.
 */
async function longestTurn(
  rig: ReturnType<typeof coverageRig>,
  run: ReturnType<typeof daemonPass>,
  expected: number,
  label: string,
  ctx: { skip: (note: string) => void },
): Promise<number> {
  const delay = monitorEventLoopDelay({ resolution: 10 });
  const judged = () =>
    Object.values(readSummary(rig.store.meta, WT)?.files ?? {}).filter((f) => f.state === "judged")
      .length;
  const began = performance.now();
  delay.enable();
  run.code.soon();
  await expect.poll(judged, { timeout: 120_000, interval: 50 }).toBe(expected);
  const took = Math.round(performance.now() - began);
  delay.disable();
  await run.code.close();

  const longest = Math.round(delay.max / 1e6);
  const load = loadavg()[0] ?? 0;
  console.log(
    `coverage chain: ${label} judged in ${took} ms; longest turn ${longest} ms; load average ${load.toFixed(1)}`,
  );
  if (load > MAX_LOAD_FOR_TIMING) {
    ctx.skip(
      `load average ${load.toFixed(1)} > ${MAX_LOAD_FOR_TIMING}; longest turn ${longest} ms`,
    );
  }
  return longest;
}

/** A rig whose sources are counted, and a code pass on it with coverage on. */
async function counted(paths: readonly string[]) {
  const rig = coverageRig();
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
  return { rig, run, record };
}

describe("the coverage chain after a run (row 015-42)", () => {
  it(`judges ${SOURCES} sources each loaded by ${TEST_FILES} test files with no long turn`, async (ctx) => {
    const paths = Array.from({ length: SOURCES }, (_, s) => `src/m${s}.ts`);
    const { rig, run, record } = await counted(paths);
    for (let t = 0; t < TEST_FILES; t++) {
      rig.loader(`test/t${t}.test.ts`, { closure: paths, record });
    }
    const label = `${SOURCES} sources by ${TEST_FILES} test files`;
    expect(await longestTurn(rig, run, SOURCES, label, ctx)).toBeLessThan(turnBudget());
  }, 180_000);

  // Row 015-45 (review 0.1.305 S1): 011-197's stores held 1,072 keyed test files whose
  // closures named 310,012 paths of 4,744 files, and records of 25 KiB; that first read took
  // 1.0 to 1.2 s in one turn. Here a record's bytes past its sources are one source no count has.
  it(`reads the loader map of ${INCIDENT_TEST_FILES} test files whose closures hold ${CLOSURE_PATHS} paths with no long turn`, async (ctx) => {
    const paths = Array.from({ length: INCIDENT_SOURCES }, (_, s) => `src/m${s}.ts`);
    const { rig, run, record: own } = await counted(paths);
    const bulk = { path: "lib/bulk.ts", blob: "0", lines: "", covered: "", functions: [] };
    const others = CLOSURE_PATHS - INCIDENT_SOURCES;
    for (let t = 0; t < INCIDENT_TEST_FILES; t++) {
      const closure = Array.from(
        { length: others },
        (_, i) => `lib/p${(t * 7 + i) % CLOSED_FILES}.ts`,
      );
      const lines = randomBytes(RECORD_BYTES).toString("base64");
      const record = [...own, { ...bulk, lines }];
      rig.loader(`test/t${t}.test.ts`, { closure: [...paths, ...closure], record });
    }
    const label = `${INCIDENT_SOURCES} sources by ${INCIDENT_TEST_FILES} test files of ${CLOSURE_PATHS} paths`;
    expect(await longestTurn(rig, run, INCIDENT_SOURCES, label, ctx)).toBeLessThan(turnBudget());
  }, 180_000);
});
