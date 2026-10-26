import { randomBytes } from "node:crypto";
import { loadavg } from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { Pace } from "../../../src/core/code/coverage/pace.js";
import { readSummary } from "../../../src/core/code/crap/index.js";
import type { Counter } from "../../../src/core/code/pass/index.js";
import { compare } from "../../../src/core/fs/index.js";
import { WT } from "../../state/helpers.js";
import { daemonPass, fakeCounter, policyOn } from "../pass/helpers.js";
import { TurnLog } from "../pass/turns.js";
import { COVERED, counterV2, coverageRig, sourceOf } from "./rig.js";

/*
 * Row 015-42, the 01:09 to 01:27 load of 011-197: after a run, the coverage
 * step judged a source or two per step, because each step read the loader
 * map, the signatures and the records of the file it judged again, outside
 * its budget. This repository's test files load most of its sources, so
 * each record holds most of them. Row 015-45 reads the first loader map,
 * of a size 011-197's stores held, in slices, and row 015-47 their seed at
 * a recount, and row 015-48 the recount's complexity write and coverage's
 * start. Timing is asserted only on a machine loaded no more than the
 * other timing tests allow, and with a wider bound on CI (row 015-47).
 * Row 015-56: the log names each long turn's phase.
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
/** 011-197's counted files: 12,433 functions, here `FUNCTIONS` each. */
const RECOUNT_SOURCES = 1_263;
const RECOUNT_TEST_FILES = 10;
/** The longest main-thread turn the change feed may wait behind (011-197: about 1.1 s). */
const TURN_BUDGET_MS = 100;
/**
 * Row 015-47: on GitHub's runners the 200-sources case read 63 to 119 ms at
 * 0.1.309, with no margin under 100, so CI asserts this; the log line keeps
 * the number. Row 015-56: there it bounds the main thread's own CPU time in
 * its longest turn, not the turn's wall time. A runner's turn also waits:
 * on the CPU other processes hold, and on the disk syncs of a WAL
 * checkpoint that a commit runs. A recount turn read 443 ms once in 24 runs
 * after 0.1.321, against 94 to 185 ms in the others; here a coverage
 * step's turn read 138 ms with 60 ms on the thread, its commit 79 ms. The
 * log names each long turn's phase, wall and thread time.
 */
const CI_TURN_BUDGET_MS = 250;
const turnBudget = () => (process.env.CI === undefined ? TURN_BUDGET_MS : CI_TURN_BUDGET_MS);

const sourceText = (s: number) =>
  Array.from({ length: FUNCTIONS }, (_, f) => `f${f} ${1 + (f % 4)} b${s}x${f}`).join("\n");

/** The files the summary holds judged. */
const judged = (rig: ReturnType<typeof coverageRig>) =>
  Object.values(readSummary(rig.store.meta, WT)?.files ?? {}).filter((f) => f.state === "judged")
    .length;

/** A chain other than the one `soon()` starts: how it starts, when it is over, what the log adds. */
interface Chain {
  readonly start: () => void;
  readonly done: () => boolean;
  readonly note: () => string;
}

/** Row 015-56: a counter, coverage pace and pass report that mark a chain's phases in `turns`. */
function marked(turns: TurnLog, counter: Counter) {
  class MarkedPace extends Pace {
    override measure<T>(work: () => T): T {
      turns.mark("a coverage step");
      try {
        return super.measure(work);
      } finally {
        turns.mark("between coverage steps");
      }
    }
  }
  return {
    counter: () =>
      Promise.resolve({
        version: counter.version,
        count: (text: string, language: Parameters<Counter["count"]>[1]) => {
          turns.mark("counting");
          return counter.count(text, language);
        },
      }),
    pace: new MarkedPace(Date.now),
    onPass: () => turns.mark("after the pass"),
  };
}

/**
 * Times the chain `soon()` starts until `expected` files are judged, or
 * `chain`: the longest turn the change feed waited behind, on CI the main
 * thread's work in it, asserted only on a machine loaded no more than
 * `MAX_LOAD_FOR_TIMING`.
 */
async function longestTurn(
  rig: ReturnType<typeof coverageRig>,
  run: ReturnType<typeof daemonPass>,
  expected: number,
  label: string,
  ctx: { skip: (note: string) => void },
  chain?: Chain,
  turns = new TurnLog(),
): Promise<number> {
  const delay = monitorEventLoopDelay({ resolution: 10 });
  const began = performance.now();
  delay.enable();
  turns.start("the pass");
  if (chain === undefined) run.code.soon();
  else chain.start();
  const done = chain?.done ?? (() => judged(rig) === expected);
  await expect.poll(done, { timeout: 120_000, interval: 50 }).toBe(true);
  const took = Math.round(performance.now() - began);
  delay.disable();
  turns.stop();
  await run.code.close();

  const longest = Math.round(delay.max / 1e6);
  const work = turns.longestWork();
  const load = loadavg()[0] ?? 0;
  console.log(
    `coverage chain: ${label} judged in ${took} ms; longest turn ${longest} ms, most work in a turn ${work} ms${chain?.note() ?? ""}; load average ${load.toFixed(1)}; ${turns.summary()}`,
  );
  if (load > MAX_LOAD_FOR_TIMING) {
    ctx.skip(
      `load average ${load.toFixed(1)} > ${MAX_LOAD_FOR_TIMING}; longest turn ${longest} ms`,
    );
  }
  return process.env.CI === undefined ? longest : work;
}

/** A rig whose sources are counted, and a code pass on it, by default with coverage on. */
async function counted(paths: readonly string[], policy = COVERED) {
  const rig = coverageRig();
  for (const [s, path] of paths.entries()) rig.tree.write(path, `${sourceText(s)}\n`);
  rig.tree.revise();
  const run = daemonPass(rig.tree, {
    policy: () => policy,
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

  // Row 015-47: 011-197's stores held 1,263 counted files of 12,433 functions, and a recount's
  // seed of their coverage states was one turn of 429 to 489 ms. Row 015-48: so was the recount's
  // complexity write, 437 ms at load 42, with the first coverage step in the same turn. Version 2
  // renames half of them.
  it(`recounts ${RECOUNT_SOURCES} sources of ${FUNCTIONS} functions with no long turn`, async (ctx) => {
    const paths = Array.from({ length: RECOUNT_SOURCES }, (_, s) => `src/m${s}.ts`);
    const { rig, run } = await counted(paths);
    for (let t = 0; t < RECOUNT_TEST_FILES; t++) {
      rig.loader(`test/t${t}.test.ts`, { closure: paths, record: [] });
    }
    run.code.soon();
    await expect.poll(() => judged(rig), { timeout: 120_000, interval: 100 }).toBe(RECOUNT_SOURCES);
    await run.code.close();

    const renamed = Array.from(
      { length: FUNCTIONS / 2 },
      (_, f) => [`f${f}`, [`g${f}`, 0]] as const,
    );
    const turns = new TurnLog();
    const { counter, pace, onPass } = marked(turns, counterV2(Object.fromEntries(renamed)));
    const recount = daemonPass(rig.tree, {
      policy: () => COVERED,
      now: Date.now,
      counter,
      onPass,
      coverage: { main: rig.main, closures: () => rig.closures, writing: () => false, pace },
    });
    // The last file judged: its renamed function's state is judged once the chain is over.
    const last = [...paths].sort(compare).at(-1) ?? "";
    const done = () =>
      rig.store.states
        .list(WT, { measure: "crap", paths: [last] })
        .some((s) => s.check.qualifiedName === "g0" && s.outcome !== "pending");
    const label = `a recount of ${RECOUNT_SOURCES} sources`;
    const chain = { start: () => recount.code.nudge(), done, note: () => "" };
    expect(await longestTurn(rig, recount, 0, label, ctx, chain, turns)).toBeLessThan(turnBudget());
  }, 300_000);

  // Row 015-48: coverage switched on over 011-197's counted files. Its first-count check read every
  // file's count in one turn, 479 ms cold.
  it(`starts coverage on ${RECOUNT_SOURCES} counted sources with no long turn`, async (ctx) => {
    const paths = Array.from({ length: RECOUNT_SOURCES }, (_, s) => `src/m${s}.ts`);
    const { rig, run } = await counted(paths, policyOn());
    await run.code.close();
    for (let t = 0; t < RECOUNT_TEST_FILES; t++) {
      rig.loader(`test/t${t}.test.ts`, { closure: paths, record: [] });
    }
    const turns = new TurnLog();
    const { counter, pace, onPass } = marked(turns, fakeCounter());
    const start = daemonPass(rig.tree, {
      policy: () => COVERED,
      now: Date.now,
      counter,
      onPass,
      coverage: { main: rig.main, closures: () => rig.closures, writing: () => false, pace },
    });
    const label = `coverage's start on ${RECOUNT_SOURCES} sources`;
    const chain = {
      start: () => start.code.nudge(),
      done: () => judged(rig) === RECOUNT_SOURCES,
      note: () => "",
    };
    expect(await longestTurn(rig, start, 0, label, ctx, chain, turns)).toBeLessThan(turnBudget());
  }, 300_000);
});
