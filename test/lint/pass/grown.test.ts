import { describe, expect, it } from "vitest";
import type { LintPassReport } from "../../../src/core/lint/pass/types.js";
import { commonDir } from "../helpers.js";
import { history, lintPass, lintTree, outcomes, storeOf } from "./helpers.js";
import { Clock, LazyRules, NODE_MAJOR, unheld } from "./lazy-rules.js";

/*
 * Row 017-29 (`tasks/017-29/design.md`; 011 `research/issue-154-cause.md`
 * F4): a closure input a lint call read first joins the keys from its part
 * on. It moves no key of a check judged before it, so a lazily read rule
 * input costs one part, not a re-key of every check; its later change still
 * re-keys every check whose key holds it.
 */

/**
 * `uses one` reads `rules/one.json` (parts 1 and 2), `uses two`
 * `rules/two.json` (parts 2 and 3); `uses three` reads `rules/three.json`,
 * which says `strict`, and no file uses it at first.
 */
const LAZY = new Map([
  ["uses one", "rules/one.json"],
  ["uses two", "rules/two.json"],
  ["uses three", "rules/three.json"],
]);
const USES: Record<string, string> = {
  "src/f05.js": "uses one\n",
  "src/f20.js": "uses two\n",
  "src/f21.js": "uses one\n",
  "src/f35.js": "uses two\n",
};
const FILES = Array.from({ length: 40 }, (_, i) => `src/f${String(i).padStart(2, "0")}.js`);

/** A worktree of 40 files, 3 parts, and its rules' inputs, revised once. */
function lazyTree(id = "w1", dir = commonDir(), one = "{}\n") {
  const tree = lintTree(id, dir)
    .write("rules/one.json", one)
    .write("rules/two.json", "{}\n")
    .write("rules/three.json", '"strict"\n');
  for (const path of FILES) tree.write(path, USES[path] ?? "ok\n");
  tree.revise();
  return tree;
}

/** The pass over `tree` with a provider whose rules read `LAZY`, on one clock. */
function rigOf(tree: ReturnType<typeof lazyTree>, clock = new Clock()) {
  const provider = new LazyRules(tree.root, LAZY, clock);
  return {
    tree,
    clock,
    provider,
    ...lintPass(tree, provider, { now: clock.now, nodeMajor: NODE_MAJOR }),
  };
}

async function settled(rig: { pass: { nudge(): void; idle(): Promise<void> } }) {
  rig.pass.nudge();
  await rig.pass.idle();
}

/** The keyings that key every check. */
const full = (reports: readonly LintPassReport[]) =>
  reports.map((r) => r.mode).filter((m) => m !== "edit");

/** The most lint calls any one file was in. */
function most(calls: readonly string[][]): number {
  const counts = new Map<string, number>();
  for (const path of calls.flat()) counts.set(path, (counts.get(path) ?? 0) + 1);
  return Math.max(...counts.values());
}

/** Every file passes but those named. */
const expected = (...failing: string[]) =>
  Object.fromEntries(FILES.map((p) => [p, failing.includes(p) ? "fail" : "pass"]));

describe("a closure input a lint call read first (row 017-29)", () => {
  it("keys every check once in a first run; each file lints at most twice", async () => {
    const rig = rigOf(lazyTree());
    await settled(rig);
    expect(full(rig.reports)).toEqual(["first"]);
    expect(most(rig.provider.calls)).toBe(2);
    expect(outcomes(storeOf(rig.tree), rig.tree)).toEqual(expected());
    expect(unheld(storeOf(rig.tree), rig.provider, FILES)).toEqual({ checked: 40, missing: [] });
    await rig.pass.close();
  });

  it("after a restart keys every check once more and lints each file at most once", async () => {
    const rig = rigOf(lazyTree());
    await settled(rig);
    await rig.pass.close();
    const before = rig.provider.calls.length;
    const next = lintPass(rig.tree, rig.provider, { now: rig.clock.now, nodeMajor: NODE_MAJOR });
    await settled(next);
    expect(full(next.reports)).toEqual(["config"]);
    expect(most(rig.provider.calls.slice(before))).toBe(1);
    expect(outcomes(storeOf(rig.tree), rig.tree)).toEqual(expected());
    expect(unheld(storeOf(rig.tree), rig.provider, FILES).missing).toEqual([]);

    // Validity after the restart: a change to an input a check's key holds re-keys it.
    const two = rig.provider.calls.length;
    const reported = next.reports.length;
    rig.tree.write("rules/two.json", '"strict"\n').revise();
    await settled(next);
    expect(full(next.reports.slice(reported))).toEqual(["config"]);
    const relinted = new Set(rig.provider.calls.slice(two).flat());
    expect(FILES.filter((p) => p >= "src/f16.js").every((p) => relinted.has(p))).toBe(true);
    expect(outcomes(storeOf(rig.tree), rig.tree)).toEqual(expected("src/f20.js", "src/f35.js"));

    const one = rig.provider.calls.length;
    rig.tree.write("rules/one.json", '"strict"\n').revise();
    await settled(next);
    expect(new Set(rig.provider.calls.slice(one).flat())).toEqual(new Set(FILES));
    expect(outcomes(storeOf(rig.tree), rig.tree)).toEqual(
      expected("src/f05.js", "src/f20.js", "src/f21.js", "src/f35.js"),
    );
    await next.pass.close();
  });

  it("an edit whose own file reads a new input keys only it again, and keeps its transition", async () => {
    const rig = rigOf(lazyTree());
    await settled(rig);
    const calls = rig.provider.calls.length;
    const reported = rig.reports.length;
    rig.tree.write("src/f10.js", "uses three\n").revise();
    await settled(rig);
    expect(rig.provider.calls.slice(calls)).toEqual([["src/f10.js"], ["src/f10.js"]]);
    expect(full(rig.reports.slice(reported))).toEqual([]);
    expect(history(storeOf(rig.tree), rig.tree, "src/f10.js")).toEqual([
      "pass-to-fail +uses-three",
    ]);
    expect(unheld(storeOf(rig.tree), rig.provider, FILES).missing).toEqual([]);
    await rig.pass.close();
  });

  it("a new thread inside the provider keys its files with what the old one read; another worktree gets no hit", async () => {
    const one = rigOf(lazyTree("w1", commonDir(), '"strict"\n'));
    // The ESLint provider starts a new thread after a failed one (D9): before part 2's second
    // call, which reads both inputs again, and before part 3's, which reads only `two.json`.
    one.provider.threadAt.add(3).add(4);
    await settled(one);
    expect(one.provider.opened).toBe(1);
    expect(outcomes(storeOf(one.tree), one.tree)).toEqual(expected("src/f05.js", "src/f21.js"));
    // Part 3's thread read only `two.json`; its keys hold `one.json` too.
    expect(one.provider.ran.at(-1)).toMatchObject({ held: ["rules/two.json"] });
    expect(unheld(storeOf(one.tree), one.provider, FILES).missing).toEqual([]);
    await one.pass.close();

    const two = rigOf(lazyTree("w2", one.tree.commonDir), one.clock);
    await settled(two);
    expect(outcomes(storeOf(two.tree), two.tree)).toEqual(expected());
    expect(two.provider.calls.flat()).toEqual(expect.arrayContaining(["src/f05.js", "src/f21.js"]));
    await two.pass.close();
  });
});
