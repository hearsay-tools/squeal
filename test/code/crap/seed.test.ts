import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEED_FILES, STEP_BUDGET_MS } from "../../../src/core/code/crap/index.js";
import { WT } from "../../state/helpers.js";
import { daemonPass, policyOn } from "../pass/helpers.js";
import { COVERED, counterV2, coverageRig, sourceOf } from "./rig.js";

/*
 * Row 015-47: the seed at coverage's start or at a recount reads the counts
 * of `SEED_FILES` files and seeds their functions as one unit of the step's
 * budget, so it goes on over several steps. No file is judged before every
 * function is seeded, and a recount's judgement stays quiet (review 0.1.297
 * B1, B2).
 */

/** How long one read of a count takes, by the clock, while `slow.on` holds: a unit is over budget. */
const ROW_MS = 2;
const FILES = 3 * SEED_FILES;

const slow = vi.hoisted(() => ({ on: false, reads: [] as number[] }));

vi.mock("../../../src/core/code/store/counts.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../src/core/code/store/counts.js")>();
  return {
    ...real,
    createCountRepo: (...args: Parameters<typeof real.createCountRepo>) => {
      const repo = real.createCountRepo(...args);
      return {
        ...repo,
        get: (...read: Parameters<typeof repo.get>) => {
          if (slow.on && slow.reads.length > 0) {
            slow.reads[slow.reads.length - 1] = (slow.reads.at(-1) ?? 0) + 1;
            vi.setSystemTime(Date.now() + ROW_MS);
          }
          return repo.get(...read);
        },
      };
    },
  };
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setImmediate", "Date"], now: 1_000 });
  slow.on = false;
  slow.reads.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

const paths = Array.from({ length: FILES }, (_, f) => `src/m${f}.ts`);

/**
 * `FILES` sources of `hot` (CC 12) and `cold` (CC 3) counted, and one test
 * file that loads them all and ran `hot`. Each step's start records the
 * count reads of the step before and the `crap` states.
 */
async function rigged() {
  const rig = coverageRig();
  for (const [f, path] of paths.entries()) rig.tree.write(path, `hot 12 h${f}\ncold 3 c${f}\n`);
  rig.tree.revise();
  const seen: (readonly string[])[] = [];
  let policy = policyOn();
  const options = {
    policy: () => policy,
    now: Date.now,
    coverage: {
      main: rig.main,
      closures: () => rig.closures,
      writing: () => {
        seen.push(rig.states("crap"));
        slow.reads.push(0);
        return false;
      },
    },
  };
  let run = daemonPass(rig.tree, options);
  run.code.nudge();
  await run.code.idle();
  const blobs = new Map(rig.store.files.list(WT).map((f) => [f.path, f.blob]));
  rig.loader("test/all.test.ts", {
    closure: paths,
    record: paths.map((path) => sourceOf(path, blobs.get(path) ?? "", 2, [1])),
  });
  /** Runs `start` with the count reads slow, and every step it leads to. */
  const chain = async (start: (code: typeof run.code) => void) => {
    seen.length = 0;
    slow.reads.length = 0;
    slow.on = true;
    start(run.code);
    // A pass that reads files waits for them in real time: the clock moves on after it.
    await run.code.idle();
    await vi.advanceTimersByTimeAsync(2_000 * STEP_BUDGET_MS);
    await run.code.idle();
    slow.on = false;
    // Each step's count reads.
    return [...slow.reads];
  };
  return {
    rig,
    seen,
    chain,
    coverage: (on: boolean) => {
      policy = on ? COVERED : policyOn();
    },
    restart: async (over: Partial<Parameters<typeof daemonPass>[1]>) => {
      await run.code.close();
      run = daemonPass(rig.tree, { ...options, ...over });
    },
    close: () => run.code.close(),
  };
}

const transitions = (rig: ReturnType<typeof coverageRig>) =>
  paths.flatMap((path) => rig.transitions(path, ["hot", "cold", "chill"]));

describe("the seed in slices (row 015-47)", () => {
  it("seeds the functions there at coverage's start over several steps, then judges them quietly", async () => {
    const { rig, seen, chain, coverage, close } = await rigged();
    coverage(true);
    const reads = await chain((code) => code.nudge());

    // One unit of the seed a step, or the files a step judges within its budget.
    for (const read of reads) expect(read).toBeLessThanOrEqual(SEED_FILES);
    // Part of the files seeded at the start of some step: the seed went on over steps.
    expect(seen.some((states) => states.length > 0 && states.length < 2 * FILES)).toBe(true);
    // No state is judged before every function is seeded.
    for (const states of seen.filter((s) => s.length < 2 * FILES)) {
      expect(states.filter((s) => !s.endsWith(" pending -"))).toEqual([]);
    }
    expect(rig.states("crap")).toEqual(paths.flatMap(() => ["cold pass 12", "hot pass 12"]));
    expect(transitions(rig)).toEqual([]);
    await close();
  });

  it("seeds a recount's functions over several steps and keeps its judgement quiet", async () => {
    const { rig, seen, chain, coverage, restart, close } = await rigged();
    coverage(true);
    await chain((code) => code.soon());
    expect(rig.states("crap")).toEqual(paths.flatMap(() => ["cold pass 12", "hot pass 12"]));

    // Version 2 renames `cold` to `chill` at CC 8, a CRAP of 72, and makes `hot` CC 31: both fail.
    const v2 = counterV2({ cold: ["chill", 8], hot: ["hot", 31] });
    await restart({ counter: () => Promise.resolve(v2) });
    const reads = await chain((code) => code.nudge());

    // One unit of the seed a step, or the files a step judges within its budget.
    for (const read of reads) expect(read).toBeLessThanOrEqual(SEED_FILES);
    const chill = (states: readonly string[]) => states.filter((s) => s.startsWith("chill "));
    expect(seen.some((states) => chill(states).length > 0 && chill(states).length < FILES)).toBe(
      true,
    );
    // Until every renamed function is seeded, no file is judged at version 2.
    for (const states of seen.filter((s) => chill(s).length < FILES)) {
      expect(chill(states).filter((s) => s !== "chill pending -")).toEqual([]);
      expect(states.filter((s) => s.startsWith("hot ") && s !== "hot pass 12")).toEqual([]);
    }
    expect(rig.states("crap")).toEqual(paths.flatMap(() => ["chill fail 72", "hot fail 31"]));
    expect(transitions(rig)).toEqual([]);
    await close();
  });
});
