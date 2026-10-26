import { loadavg } from "node:os";
import { describe, expect, it } from "vitest";
import type { Counter } from "../../../src/core/code/pass/index.js";
import { open } from "../helpers.js";
import { fakeCounter, pass, worktree } from "./helpers.js";
import { TurnLog } from "./turns.js";

/*
 * Row 015-55: a pull or checkout of every file of 011-197's store, 1,263
 * files of 10 functions, half of them newly over, made a first turn of
 * 110 ms (the plan, `oldBodies`, the files rows) and a last one of 309 ms
 * (count reads, judge, writes) at load 7.3. Timing is asserted only on a
 * machine loaded no more than the other timing tests allow, and with a
 * wider bound on CI, as `chain-load.test.ts` does.
 */

const MAX_LOAD_FOR_TIMING = 8;
const FILES = 1_263;
const FUNCTIONS = 10;
/** The longest main-thread turn the change feed may wait behind. */
const TURN_BUDGET_MS = 100;
const CI_TURN_BUDGET_MS = 250;
const turnBudget = () => (process.env.CI === undefined ? TURN_BUDGET_MS : CI_TURN_BUDGET_MS);

const paths = Array.from({ length: FILES }, (_, s) => `src/m${s}.ts`);

/** File `s` before the change: every function at CC 1 to 4. After it: the first half at CC 25, with new bodies. */
const older = (s: number) =>
  Array.from({ length: FUNCTIONS }, (_, f) => `f${f} ${1 + (f % 4)} b${s}x${f}`).join("\n");
const newer = (s: number) =>
  Array.from({ length: FUNCTIONS }, (_, f) =>
    f < FUNCTIONS / 2 ? `f${f} 25 c${s}x${f}` : `f${f} ${1 + (f % 4)} b${s}x${f}`,
  ).join("\n");

/** The fake counter, marking the phase in `turns`. */
function marked(turns: TurnLog): Counter {
  const inner = fakeCounter();
  return {
    version: inner.version,
    count(text, language) {
      turns.mark("counting");
      return inner.count(text, language);
    },
  };
}

/** Every file counted, committed, then changed by `change`; the pass over it, timed. */
async function timed(
  label: string,
  change: (tree: ReturnType<typeof worktree>) => void,
  ctx: { skip: (note: string) => void },
) {
  const tree = worktree();
  const store = open(tree.commonDir);
  for (const [s, path] of paths.entries()) tree.write(path, `${older(s)}\n`);
  tree.commit();
  tree.revise();
  await pass(tree, store, fakeCounter(), { now: Date.now });
  change(tree);
  tree.revise();

  const turns = new TurnLog();
  turns.start("the first turn");
  const began = performance.now();
  const report = await pass(tree, store, marked(turns), { now: Date.now });
  const took = Math.round(performance.now() - began);
  // The pass begins and ends inside a turn of its own: `stop` takes the last one.
  turns.stop();

  const longest = turns.longest();
  const load = loadavg()[0] ?? 0;
  console.log(
    `${label}: ${took} ms; longest turn ${longest} ms; load average ${load.toFixed(1)}; ${turns.summary()}`,
  );
  const timing = () => {
    if (load > MAX_LOAD_FOR_TIMING) {
      ctx.skip(
        `load average ${load.toFixed(1)} > ${MAX_LOAD_FOR_TIMING}; longest turn ${longest} ms`,
      );
    }
    expect(longest).toBeLessThan(turnBudget());
  };
  return { tree, store, report, timing };
}

describe(`an edit pass over every file of ${FILES} (row 015-55)`, () => {
  it("a pull keeps every turn short", async (ctx) => {
    const pulled = (tree: ReturnType<typeof worktree>) => {
      for (const [s, path] of paths.entries()) tree.write(path, `${newer(s)}\n`);
      tree.commit();
    };
    const { store, report, timing } = await timed(`a pull of ${FILES} files`, pulled, ctx);
    expect(report).toMatchObject({ mode: "edit", files: FILES, transitions: FILES * 5 });
    expect(report?.edited).toEqual([]);
    expect(store.states.list("w1", { measure: "complexity", outcome: "fail" })).toHaveLength(
      FILES * 5,
    );
    timing();
  }, 300_000);

  it("an edit of every file keeps every turn short", async (ctx) => {
    const edited = (tree: ReturnType<typeof worktree>) => {
      for (const [s, path] of paths.entries()) tree.write(path, `${newer(s)}\n`);
    };
    const { store, report, timing } = await timed(`an edit of ${FILES} files`, edited, ctx);
    expect(report).toMatchObject({ mode: "edit", files: FILES, transitions: FILES * 5 });
    expect(report?.edited).toHaveLength(FILES * 5);
    expect(store.states.edits("w1", "complexity")).toHaveLength(FILES * 5);
    timing();
  }, 300_000);
});
