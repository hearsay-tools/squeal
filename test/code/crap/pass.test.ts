import { describe, expect, it } from "vitest";
import { readSummary, summaryKey } from "../../../src/core/code/crap/index.js";
import { afterResults } from "../../../src/core/code/pass/index.js";
import type { StateSink } from "../../../src/core/types/index.js";
import { freshStore, result, WT } from "../../state/helpers.js";
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
      closures: () => null,
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

  it("polls no record past its wait while the writer is busy (review 0.1.297 S1)", async () => {
    const tree = worktree(WT);
    tree.write("src/a.ts", "f 3 b1\n").revise();
    const main = freshStore();
    const testFile = { project: "", path: "test/a.test.ts" };
    const paths = [testFile.path, "src/a.ts"];
    main.testFiles.put({
      testFile,
      closure: { testFile, paths, complete: false, method: "static imports plus declared inputs" },
      updatedAt: 1,
      updatedBy: WT,
    });
    main.testFileKeys.upsertMany([
      { worktreeId: WT, testFile, key: "k1", revision: 1, pending: null },
    ]);
    const r = result(
      { kind: "test", project: "", testPath: testFile.path, fullName: "t" },
      "pass",
      {
        key: "k1",
      },
    );
    main.results.putMany([{ ...r, provenance: { ...r.provenance, recordedAt: 1_000 } }]);
    let steps = 0;
    const pass = daemonPass(tree, {
      policy: () => COVERED,
      now: () => 100_000,
      coverage: {
        main,
        closures: () => ({
          key: () => "k1",
          closure: () => ({ paths }),
        }),
        writing: () => {
          steps++;
          return true;
        },
      },
    });
    pass.code.nudge();
    await pass.code.idle();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await pass.code.idle();
    expect(steps).toBe(1);
    await pass.code.close();
    const store = open(tree.commonDir);
    expect(readSummary(store.meta, WT)?.files["src/a.ts"]).toMatchObject({ reason: "record" });
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

  it("drops the crap states at the next pass once crap.enabled goes off, with no result stored (015-64)", async () => {
    let policy = COVERED;
    const run = counted(() => policy);
    run.pass.code.nudge();
    await run.pass.code.idle();
    const store = open(run.tree.commonDir);
    expect(store.states.list(WT).map((s) => s.measure)).toEqual([
      "complexity",
      "crap",
      "uncovered",
    ]);
    policy = { ...COVERED, crap: { ...COVERED.crap, enabled: false } };
    run.pass.code.nudge();
    await run.pass.code.idle();
    await run.pass.code.close();
    expect(store.states.list(WT).map((s) => s.measure)).toEqual(["complexity", "uncovered"]);
    expect(readSummary(store.meta, WT)?.checks).toEqual(["uncovered"]);
  });

  it("keeps only complexity for a function an edit moves into an excluded file (review 0.1.337 B1)", async () => {
    const policy = { ...COVERED, coverage: { ...COVERED.coverage, exclude: ["src/gen/**"] } };
    const run = counted(() => policy);
    run.pass.code.nudge();
    await run.pass.code.idle();
    const store = open(run.tree.commonDir);
    const states = () => store.states.list(WT).map((s) => `${s.check.path} ${s.measure}`);
    expect(states()).toEqual(["src/a.ts complexity", "src/a.ts crap", "src/a.ts uncovered"]);
    run.tree.write("src/a.ts", "").write("src/gen/b.ts", "f 3 b1\n").revise();
    run.pass.code.nudge();
    await run.pass.code.idle();
    await run.pass.code.close();
    expect(states()).toEqual(["src/gen/b.ts complexity"]);
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
