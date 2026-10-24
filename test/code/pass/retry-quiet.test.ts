import { describe, expect, it } from "vitest";
import { readUncountable } from "../../../src/core/code/pass/index.js";
import type { CodeStore } from "../../../src/core/code/store/index.js";
import { lastTransition } from "../../../src/core/delivery/code-deliver.js";
import { type CodeBound, planCodeDelta } from "../../../src/core/delivery/code-delta.js";
import { wentOverSince } from "../../../src/core/delivery/code-since.js";
import { DEFAULT_POLICY } from "../../../src/core/types/index.js";
import { open } from "../helpers.js";
import {
  type FakeWorktree,
  fakeCounter,
  flakyCounter,
  pass,
  policyOn,
  worktree,
} from "./helpers.js";

/*
 * Review 0.1.293 B1: a retry of a failed first count or policy recount, at
 * a blob that has not changed, seeds the file's states as that count would
 * have, with no transition (D5, D6): the session that registered before it
 * is told nothing and has no regression. A retry of an edit's count still
 * reports its crossing.
 */

const OLD = "src/old.ts";
const NEW = "src/new.ts";
/** The session registered at revision 1, its view seeded at 1,500 with no failing function. */
const SESSION: CodeBound = { since: 1, gaps: [] };

/** What a delivery to that session tells, and the functions its Stop check counts as gone over. */
function told(store: CodeStore, tree: FakeWorktree) {
  const plan = planCodeDelta({
    view: [],
    states: store.states.list(tree.id, { measure: "complexity" }),
    last: (check, measure) => lastTransition(store, tree.id, check, measure),
    edit: () => null,
    seededAt: 1_500,
    seenUpTo: SESSION,
    toldAt: 100_000,
  });
  return {
    entries: plan.entries.map((e) => `${e.kind} ${e.check.qualifiedName} ${e.revision}`),
    wentOver: wentOverSince(store, tree.id, SESSION).map((s) => s.check.qualifiedName),
    writes: plan.writes.map((w) => `${w.check.qualifiedName} ${w.outcome} ${w.told}`),
  };
}

describe("a retry of a quiet count seeds quietly (review 0.1.293 B1)", () => {
  it("tells nothing of an unchanged file whose first count threw, retried after another edit", async () => {
    const tree = worktree();
    const store = open(tree.commonDir);
    tree.write(OLD, "old 23 B1\n").revise();
    const counter = flakyCounter(1);
    expect(await pass(tree, store, counter, { now: () => 1_000 })).toMatchObject({
      mode: "first",
      counted: 0,
    });
    expect(readUncountable(store.meta, tree.id).get(OLD)).toMatchObject({ quiet: true });
    tree.write(NEW, "fresh 22 B2\n").revise();
    expect(await pass(tree, store, counter, { now: () => 2_000 })).toMatchObject({
      revision: 2,
      transitions: 1,
    });
    expect(await pass(tree, store, counter, { now: () => 6_000 })).toMatchObject({
      revision: 2,
      mode: "edit",
      counted: 1,
      transitions: 0,
    });
    expect(store.states.list(tree.id, { paths: [OLD] })).toMatchObject([
      { value: 23, outcome: "fail" },
    ]);
    expect(told(store, tree)).toEqual({
      entries: ["first-seen-fail fresh 2"],
      wentOver: ["fresh"],
      writes: ["fresh fail full", "old fail count"],
    });
  });

  it("tells nothing of a file whose count threw at a policy recount, retried after another edit", async () => {
    const tree = worktree();
    const store = open(tree.commonDir);
    const excluded = policyOn({ exclude: [...DEFAULT_POLICY.complexity.exclude, OLD] });
    tree.write(OLD, "old 23 B1\n").write("src/a.ts", "a 2 A\n").revise();
    await pass(tree, store, fakeCounter(), { now: () => 1_000, policy: excluded });
    const counter = flakyCounter(1);
    expect(await pass(tree, store, counter, { now: () => 2_000 })).toMatchObject({
      mode: "include",
      counted: 0,
    });
    tree.write(NEW, "fresh 2 B2\n").revise();
    await pass(tree, store, counter, { now: () => 3_000 });
    expect(await pass(tree, store, counter, { now: () => 7_000 })).toMatchObject({
      mode: "edit",
      counted: 1,
      transitions: 0,
    });
    expect(told(store, tree)).toEqual({ entries: [], wentOver: [], writes: ["old fail count"] });
  });

  it("keeps a first count's quiet seed through a policy recount that held it", async () => {
    const tree = worktree();
    const store = open(tree.commonDir);
    tree.write(OLD, "old 23 B1\n").revise();
    const counter = flakyCounter(1);
    await pass(tree, store, counter, { now: () => 1_000 });
    const lower = policyOn({ threshold: 10 });
    expect(await pass(tree, store, counter, { now: () => 2_000, policy: lower })).toMatchObject({
      mode: "threshold",
      counted: 0,
    });
    tree.write(NEW, "fresh 2 B2\n").revise();
    await pass(tree, store, counter, { now: () => 3_000, policy: lower });
    expect(await pass(tree, store, counter, { now: () => 6_000, policy: lower })).toMatchObject({
      mode: "edit",
      counted: 1,
      transitions: 0,
    });
    expect(counter.calls).toHaveLength(3);
    expect(told(store, tree)).toEqual({ entries: [], wentOver: [], writes: ["old fail count"] });
  });

  it("keeps the quiet seed when another worktree counted the spent blob", async () => {
    const tree = worktree();
    const store = open(tree.commonDir);
    tree.write(OLD, "old 23 B1\n").revise();
    for (const now of [1_000, 6_000, 66_000]) {
      await pass(tree, store, flakyCounter(Infinity), { now: () => now });
    }
    expect(readUncountable(store.meta, tree.id).get(OLD)).toMatchObject({
      attempts: 3,
      retryAt: null,
      quiet: true,
    });
    const other = worktree("w2", tree.commonDir);
    other.write(OLD, "old 23 B1\n").revise();
    await pass(other, store, fakeCounter(), { now: () => 70_000 });
    tree.write(NEW, "fresh 2 B2\n").revise();
    const counter = fakeCounter();
    expect(await pass(tree, store, counter, { now: () => 71_000 })).toMatchObject({
      counted: 1,
      transitions: 0,
    });
    expect(counter.calls).toEqual(["fresh 2 B2\n"]);
    expect(told(store, tree)).toEqual({ entries: [], wentOver: [], writes: ["old fail count"] });
  });

  it("still tells the crossing of a session edit whose count threw once", async () => {
    const tree = worktree();
    const store = open(tree.commonDir);
    tree.write(OLD, "old 3 B1\n").revise();
    await pass(tree, store, fakeCounter(), { now: () => 1_000 });
    tree.write(OLD, "old 23 B2\n").revise();
    const counter = flakyCounter(1);
    await pass(tree, store, counter, { now: () => 2_000 });
    expect(readUncountable(store.meta, tree.id).get(OLD)).not.toHaveProperty("quiet");
    expect(await pass(tree, store, counter, { now: () => 7_000 })).toMatchObject({
      transitions: 1,
    });
    expect(told(store, tree)).toEqual({
      entries: ["pass-to-fail old 2"],
      wentOver: ["old"],
      writes: ["old fail full"],
    });
  });

  it("gives the next blob of a quiet failure normal transitions", async () => {
    const tree = worktree();
    const store = open(tree.commonDir);
    tree.write(OLD, "old 23 B1\n").revise();
    await pass(tree, store, flakyCounter(1), { now: () => 1_000 });
    tree.write(OLD, "old 24 B2\n").revise();
    expect(await pass(tree, store, fakeCounter(), { now: () => 2_000 })).toMatchObject({
      counted: 1,
      transitions: 1,
    });
    expect(told(store, tree)).toMatchObject({ entries: ["first-seen-fail old 2"] });
  });
});
