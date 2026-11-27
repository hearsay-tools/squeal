import { loadavg } from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { open } from "../helpers.js";
import { fakeCounter, pass, worktree } from "./helpers.js";

/*
 * Row 015-55: a pull or checkout of every file of 011-197's store, 1,263
 * files of 10 functions, half of them newly over, made a first turn of
 * 110 ms (the plan, `oldBodies`, the files rows) and a last one of 309 ms
 * (count reads, judge, writes) at load 7.3. Such a pass now reads, judges
 * and stages in parts and switches in one turn.
 *
 * Row 011-429 (G1): the tests assert what the pass stores at that scale,
 * not how long its turns are. A bound on the longest turn (100 ms, its
 * main-thread CPU under 250 ms on CI) failed at 204 ms with four test
 * files running at once. The parts are asserted by counted units: counts
 * a slice at a time with the store writable between turns
 * (`slices.test.ts`), states staged in parts and switched in one
 * transaction (`staged.test.ts`, `staged-edit.test.ts`). The longest turn
 * stays in the log; its figure is the `bench/` cells' `hook.writeWait.max`
 * and `hook.longWriteWaits`.
 */

const FILES = 1_263;
const FUNCTIONS = 10;

const paths = Array.from({ length: FILES }, (_, s) => `src/m${s}.ts`);

/** File `s` before the change: every function at CC 1 to 4. After it: the first half at CC 25, with new bodies. */
const older = (s: number) =>
  Array.from({ length: FUNCTIONS }, (_, f) => `f${f} ${1 + (f % 4)} b${s}x${f}`).join("\n");
const newer = (s: number) =>
  Array.from({ length: FUNCTIONS }, (_, f) =>
    f < FUNCTIONS / 2 ? `f${f} 25 c${s}x${f}` : `f${f} ${1 + (f % 4)} b${s}x${f}`,
  ).join("\n");

/** Every file counted, committed, then changed by `change`; the pass over it, its time logged. */
async function changed(label: string, change: (tree: ReturnType<typeof worktree>) => void) {
  const tree = worktree();
  const store = open(tree.commonDir);
  for (const [s, path] of paths.entries()) tree.write(path, `${older(s)}\n`);
  tree.commit();
  tree.revise();
  await pass(tree, store, fakeCounter(), { now: Date.now });
  change(tree);
  tree.revise();

  const delay = monitorEventLoopDelay({ resolution: 10 });
  delay.enable();
  const began = performance.now();
  const report = await pass(tree, store, fakeCounter(), { now: Date.now });
  const took = Math.round(performance.now() - began);
  delay.disable();
  const load = loadavg()[0] ?? 0;
  console.log(
    `${label}: ${took} ms; longest turn ${Math.round(delay.max / 1e6)} ms; load average ${load.toFixed(1)}`,
  );
  return { store, report };
}

describe(`an edit pass over every file of ${FILES} (row 015-55)`, () => {
  it("a pull of every file fails every function that crossed over and marks no edit", async () => {
    const pulled = (tree: ReturnType<typeof worktree>) => {
      for (const [s, path] of paths.entries()) tree.write(path, `${newer(s)}\n`);
      tree.commit();
    };
    const { store, report } = await changed(`a pull of ${FILES} files`, pulled);
    expect(report).toMatchObject({ mode: "edit", files: FILES, transitions: FILES * 5 });
    expect(report?.edited).toEqual([]);
    expect(store.states.list("w1", { measure: "complexity", outcome: "fail" })).toHaveLength(
      FILES * 5,
    );
  }, 300_000);

  it("an edit of every file fails every function that crossed over and marks it edited", async () => {
    const edited = (tree: ReturnType<typeof worktree>) => {
      for (const [s, path] of paths.entries()) tree.write(path, `${newer(s)}\n`);
    };
    const { store, report } = await changed(`an edit of ${FILES} files`, edited);
    expect(report).toMatchObject({ mode: "edit", files: FILES, transitions: FILES * 5 });
    expect(report?.edited).toHaveLength(FILES * 5);
    expect(store.states.edits("w1", "complexity")).toHaveLength(FILES * 5);
  }, 300_000);
});
