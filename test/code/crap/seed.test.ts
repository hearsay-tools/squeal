import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoverageSource } from "../../../src/core/code/coverage/index.js";
import { SEED_FILES, STEP_BUDGET_MS } from "../../../src/core/code/crap/index.js";
import { WT } from "../../state/helpers.js";
import { daemonPass, policyOn } from "../pass/helpers.js";
import { COVERED, counterV2, coverageRig, sourceOf } from "./rig.js";

/*
 * Row 015-47: the seed at coverage's start or at a recount reads the counts
 * of `SEED_FILES` files and seeds their functions as one unit of the step's
 * budget, so it goes on over several steps. No file is judged before every
 * function is seeded, and a recount's judgement stays quiet (review 0.1.297
 * B1, B2). A function an edit moves before the seed reaches it keeps its
 * quiet first judgement (D2; review 0.1.311 B1); one an edit adds does not.
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
 * `FILES` sources counted, by default of `hot` (CC 12) and `cold` (CC 3),
 * and one test file that loads them all with the record `sources` gives,
 * by default one that ran `hot`. Each step's start records the count reads
 * of the step before and the `crap` states.
 */
async function rigged(
  text = (f: number) => `hot 12 h${f}\ncold 3 c${f}\n`,
  sources = (path: string, blob: string): CoverageSource[] => [sourceOf(path, blob, 2, [1])],
) {
  const rig = coverageRig();
  for (const [f, path] of paths.entries()) rig.tree.write(path, text(f));
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
    record: paths.flatMap((path) => sources(path, blobs.get(path) ?? "")),
  });
  /** Runs `start` with the count reads slow, up to the end of its first step. */
  const begin = async (start: (code: typeof run.code) => void) => {
    seen.length = 0;
    slow.reads.length = 0;
    slow.on = true;
    start(run.code);
    // A pass that reads files waits for them in real time: the clock moves on after it.
    await run.code.idle();
  };
  /** Runs every step left with the count reads slow; each step's count reads. */
  const finish = async () => {
    slow.on = true;
    await vi.advanceTimersByTimeAsync(2_000 * STEP_BUDGET_MS);
    await run.code.idle();
    slow.on = false;
    return [...slow.reads];
  };
  return {
    rig,
    seen,
    begin,
    finish,
    /** Runs `start` and every step it leads to. */
    chain: async (start: (code: typeof run.code) => void) => {
      await begin(start);
      return finish();
    },
    /** A revision of `files` and its complexity pass, with the clock still: no step is due. */
    edit: async (files: Record<string, string>) => {
      slow.on = false;
      for (const [path, text] of Object.entries(files)) rig.tree.write(path, text);
      rig.tree.revise();
      run.code.nudge();
      await run.code.idle();
    },
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

describe("the seed follows the complexity pass's moves and removals (review 0.1.311 B1)", () => {
  /** One function a file, CC 3, a body of its own; the test file ran none of them. */
  const one = (f: number) => `old 3 b${f}\n`;
  const seeded = (rig: ReturnType<typeof coverageRig>) =>
    new Set(rig.store.states.list(WT, { measure: "crap" }).map((s) => s.check.path));
  const told = (rig: ReturnType<typeof coverageRig>) =>
    paths.flatMap((path) => rig.transitions(path, ["old", "renamed", "moved", "fresh"]));

  /** Coverage starts and its first step seeds one unit: `src/m0.ts` in it, `src/m94.ts` and `src/m95.ts` not. */
  async function partly() {
    const r = await rigged(one, () => []);
    r.coverage(true);
    await r.begin((code) => code.nudge());
    expect(seeded(r.rig).size).toBe(SEED_FILES);
    expect(
      [...seeded(r.rig)].filter((p) => ["src/m0.ts", "src/m94.ts", "src/m95.ts"].includes(p)),
    ).toEqual(["src/m0.ts"]);
    return r;
  }

  it.each([
    ["a rename in a file not seeded yet", [{ "src/m95.ts": "renamed 3 b95\n" }], "renamed"],
    [
      "a move between two files not seeded yet",
      [{ "src/m94.ts": "\n", "src/m95.ts": "old 3 b95\nmoved 3 b94\n" }],
      "moved",
    ],
    [
      "a move from a file not seeded yet into a seeded one",
      [{ "src/m95.ts": "\n", "src/m0.ts": "old 3 b0\nmoved 3 b95\n" }],
      "moved",
    ],
    [
      "a move from a seeded file into one not seeded yet",
      [{ "src/m0.ts": "\n", "src/m95.ts": "old 3 b95\nmoved 3 b0\n" }],
      "moved",
    ],
    [
      "a rename in a file not seeded yet, then an edit of its body",
      [{ "src/m95.ts": "renamed 3 b95\n" }, { "src/m95.ts": "renamed 3 b95x\n" }],
      "renamed",
    ],
  ])("keeps %s quiet", async (_, edits, name) => {
    const { rig, edit, finish, close } = await partly();
    for (const files of edits) await edit(files);
    await finish();

    expect(rig.states("uncovered").filter((s) => s.startsWith(`${name} `))).toEqual([
      `${name} fail -`,
    ]);
    expect(told(rig)).toEqual([]);
    await close();
  });

  it("keeps a rename and a move quiet after their files are seeded", async () => {
    const { rig, chain, edit, finish, coverage, close } = await rigged(one, () => []);
    coverage(true);
    await chain((code) => code.nudge());
    await edit({
      "src/m0.ts": "renamed 3 b0\n",
      "src/m1.ts": "\n",
      "src/m2.ts": "old 3 b2\nmoved 3 b1\n",
    });
    await finish();

    expect(rig.states("uncovered").filter((s) => !s.startsWith("old "))).toEqual([
      "renamed fail -",
      "moved fail -",
    ]);
    expect(told(rig)).toEqual([]);
    await close();
  });

  it.each([
    ["added to a file not seeded yet", [{ "src/m95.ts": "old 3 b95\nfresh 3 n1\n" }], "fresh"],
    [
      "removed, then added again under its name",
      [{ "src/m95.ts": "\n" }, { "src/m95.ts": "old 3 n1\n" }],
      "old",
    ],
  ])("tells a function %s as a first-seen fail", async (_, edits, name) => {
    const { rig, edit, finish, close } = await partly();
    for (const files of edits) await edit(files);
    await finish();

    expect(rig.transitions("src/m95.ts", [name])).toEqual([`uncovered first-seen-fail ${name}`]);
    expect(told(rig).filter((t) => !t.endsWith(` ${name}`) || t.includes("crap"))).toEqual([]);
    await close();
  });
});
