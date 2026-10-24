import { describe, expect, it } from "vitest";
import { readSummary, summaryKey } from "../../../src/core/code/crap/index.js";
import { afterResults } from "../../../src/core/code/pass/index.js";
import type { StateSink } from "../../../src/core/types/index.js";
import { freshStore, WT } from "../../state/helpers.js";
import { open } from "../helpers.js";
import { daemonPass, policyOn, worktree } from "../pass/helpers.js";
import { COVERED } from "./rig.js";

/*
 * Row 015-12, the coordinator's conditions: with coverage off the code pass
 * makes no extra pass and writes nothing of D9; a burst of stored results
 * or records gives one pass; the sink's nudge never fails the sink.
 */

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

function counted(policy: () => ReturnType<typeof policyOn>) {
  const tree = worktree(WT);
  tree.write("src/a.ts", "f 3 b1\n").revise();
  let steps = 0;
  let revisions = 0;
  const source = {
    ...tree.source,
    latestRevision: () => {
      revisions++;
      return tree.source.latestRevision();
    },
  };
  const main = freshStore();
  const pass = daemonPass(tree, {
    source,
    policy,
    coverage: {
      main,
      writing: () => {
        steps++;
        return false;
      },
    },
  });
  return { tree, pass, steps: () => steps, revisions: () => revisions };
}

describe("the code pass and the coverage step", () => {
  it("with coverage off, a burst of results makes no pass and the store keeps no D9 state", async () => {
    const run = counted(() => policyOn());
    run.pass.code.nudge();
    await run.pass.code.idle();
    const before = run.revisions();
    for (let i = 0; i < 50; i++) run.pass.code.soon();
    await settle();
    await run.pass.code.idle();
    expect(run.revisions()).toBe(before);
    expect(run.steps()).toBe(0);
    await run.pass.code.close();
    const store = open(run.tree.commonDir);
    expect(store.meta.get(summaryKey(WT))).toBeNull();
    expect(store.states.list(WT).map((s) => s.measure)).toEqual(["complexity"]);
  });

  it("with coverage on, a burst of results gives one pass", async () => {
    const run = counted(() => COVERED);
    run.pass.code.nudge();
    await run.pass.code.idle();
    expect(run.steps()).toBe(1);
    for (let i = 0; i < 50; i++) run.pass.code.soon();
    await settle();
    await run.pass.code.idle();
    expect(run.steps()).toBe(2);
    await run.pass.code.close();
  });

  it("drops the D9 states when coverage goes off", async () => {
    let policy = COVERED;
    const run = counted(() => policy);
    run.pass.code.nudge();
    await run.pass.code.idle();
    policy = policyOn();
    run.pass.code.nudge();
    await run.pass.code.idle();
    await run.pass.code.close();
    const store = open(run.tree.commonDir);
    expect(readSummary(store.meta, WT)).toBeNull();
    expect(store.states.list(WT).map((s) => s.measure)).toEqual(["complexity"]);
  });

  it("calls the sink's nudge after it stores results, and a throw from it is not the sink's", () => {
    const calls: string[] = [];
    const sink = {
      applyResults: () => {
        calls.push("apply");
        return [];
      },
      markUnknown: () => {
        calls.push("unknown");
        return [];
      },
    } as unknown as StateSink;
    const wrapped = afterResults(sink, () => {
      calls.push("then");
      throw new Error("boom");
    });
    expect(wrapped.applyResults(WT, 1, [], { kind: "own" } as never)).toEqual([]);
    wrapped.markUnknown(WT, 1, [], "r");
    expect(calls).toEqual(["apply", "then", "unknown", "then"]);
  });
});
