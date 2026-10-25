import { setImmediate as nextTurn } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import type { Counter } from "../../../src/core/code/pass/index.js";
import { PART_FILES, stagedId } from "../../../src/core/code/pass/stage.js";
import type { CodeStore } from "../../../src/core/code/store/index.js";
import { commonDir, open } from "../helpers.js";
import { type FakeWorktree, fakeCounter, pass, worktree } from "./helpers.js";

/*
 * Row 015-48: a recount judges and stages its states in parts a turn
 * apart, then one transaction makes them the worktree's. A hook that reads
 * on every turn of the recount sees the old states or the new ones, never
 * a mix, and the old ones while the parts are staged.
 */

const FILES = 4 * PART_FILES;
const paths = Array.from({ length: FILES }, (_, f) => `src/m${f}.ts`);

/** Version 2 of the fake counter: `f` is CC 27, over 20, and `g` is renamed `h` at CC 5. */
function version2(): Counter {
  const inner = fakeCounter();
  return {
    version: 2,
    async count(text, language) {
      const counted = await inner.count(text, language);
      return {
        ...counted,
        functions: counted.functions.map((fn) =>
          fn.qualifiedName === "g"
            ? { ...fn, qualifiedName: "h", complexity: 5 }
            : { ...fn, complexity: 27 },
        ),
      };
    },
  };
}

const OLD = paths.flatMap((path) => [`${path} f pass 3`, `${path} g fail 25`]).sort();
const NEW = paths.flatMap((path) => [`${path} f fail 27`, `${path} h pass 5`]).sort();

const states = (store: CodeStore) =>
  store.states
    .list("w1", { measure: "complexity" })
    .map((s) => `${s.check.path} ${s.check.qualifiedName} ${s.outcome} ${s.value}`)
    .sort();

/** Every file counted at version 1: `f` at CC 3 and `g` at CC 25. */
async function counted() {
  const dir = commonDir();
  const tree = worktree("w1", dir);
  for (const [f, path] of paths.entries()) tree.write(path, `f 3 b${f}\ng 25 c${f}\n`);
  tree.revise();
  const store = open(dir);
  await pass(tree, store, fakeCounter());
  expect(states(store)).toEqual(OLD);
  return { tree, store, hook: open(dir) };
}

/** A clock each read moves 10 ms, so each part spends its budget in a few files. */
const ticking = () => {
  let clock = 1_000;
  return () => (clock += 10);
};

/**
 * The recount at version 2, with `hook` reading on each turn until it
 * ends: what it read, and whether every count of version 2 was stored.
 */
async function watched(
  tree: FakeWorktree,
  store: CodeStore,
  hook: CodeStore,
  onTurn: () => void = () => {},
) {
  let over = false;
  const recount = pass(tree, store, version2(), { now: ticking() }).finally(() => {
    over = true;
  });
  const seen: { states: string[]; counted: boolean }[] = [];
  while (!over) {
    seen.push(
      hook.read(() => ({
        states: states(hook),
        counted: paths.every(
          (path) => hook.counts.get(tree.source.file(path)?.hash ?? "", "typescript", 2) !== null,
        ),
      })),
    );
    onTurn();
    await nextTurn();
  }
  await recount;
  return seen;
}

describe("a recount stages its states in parts (row 015-48)", () => {
  it("shows a hook the old states or the new ones, never a mix, and the old ones while it stages", async () => {
    const { tree, store, hook } = await counted();
    const seen = await watched(tree, store, hook);

    for (const read of seen) expect([OLD, NEW]).toContainEqual(read.states);
    // Every count was stored, and the states were still the old ones: the parts took turns.
    expect(seen.some((read) => read.counted && read.states.join() === OLD.join())).toBe(true);
    expect(states(store)).toEqual(NEW);
    expect(store.states.list(stagedId("w1"))).toEqual([]);
  });

  it("never adopts the staged rows an earlier pass left", async () => {
    const { tree, store } = await counted();
    const left = store.states.list("w1", { measure: "complexity", paths: ["src/m0.ts"] });
    store.states.upsertMany(
      left.map((s) => ({
        ...s,
        worktreeId: stagedId("w1"),
        check: { ...s.check, qualifiedName: `${s.check.qualifiedName}-crashed` },
      })),
    );

    await pass(tree, store, version2());
    expect(states(store)).toEqual(NEW);
    expect(store.states.list(stagedId("w1"))).toEqual([]);
  });

  it("writes the whole set when a prune took staged rows between two parts", async () => {
    const { tree, store, hook } = await counted();
    let pruned: string[] | null = null;
    const seen = await watched(tree, store, hook, () => {
      if (pruned !== null || hook.states.list(stagedId("w1")).length === 0) return;
      // The staged id is no live worktree's: a prune takes its rows.
      pruned = states(hook);
      hook.prune({ now: Date.now(), retentionDays: 30, worktrees: ["w1"], consumers: [] });
      expect(hook.states.list(stagedId("w1"))).toEqual([]);
    });

    expect(pruned).toEqual(OLD);
    for (const read of seen) expect([OLD, NEW]).toContainEqual(read.states);
    expect(states(store)).toEqual(NEW);
  });
});
