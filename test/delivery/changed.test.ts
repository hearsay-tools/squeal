import { beforeEach, describe, expect, it } from "vitest";
import { createDelivery } from "../../src/core/delivery/index.js";
import { revisionMetaKey } from "../../src/core/delivery/liveness.js";
import { createStateSink } from "../../src/core/state/index.js";
import type { Consumer, HarnessDelivery, StateSink, Store } from "../../src/core/types/index.js";
import { check, freshStore, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus } from "./fakes.js";

/*
 * Task 001-89, review wave 10 S4 decided (b): a header names the paths
 * changed since the revision its consumer was last told about, a union over
 * the revisions after it, so a check that broke at one edit and is reported
 * after another names both.
 */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const A = check("a");

let store: Store;
let sink: StateSink;
let delivery: HarnessDelivery;

beforeEach(() => {
  store = freshStore();
  sink = createStateSink(store);
  delivery = createDelivery(store, { status: fixedStatus() });
  setKey(store, "k1");
});

/** A revision changing `paths`, with `outcome` for check `a` when given. */
function edit(paths: readonly string[], outcome?: "pass" | "fail"): void {
  const { number } = store.revisions.append({
    worktreeId: WT,
    createdAt: 1,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: paths.map((path) => ({ path, oldHash: null, newHash: `h-${path}` })),
  });
  const results = outcome === undefined ? [] : [result(A, outcome, { revision: number })];
  sink.applyResults(WT, number, results, { checkpointId: null });
}

describe("changed paths in a delivered header (review wave 10, S4 (b))", () => {
  it("names every revision's paths since the last report, each once", async () => {
    edit(["src/a.ts"], "pass");
    expect((await delivery.register(C1)).header.changedPaths).toEqual(["src/a.ts"]);

    edit(["src/b.ts"], "fail");
    edit(["src/c.ts", "src/b.ts"]);
    const delta = await delivery.onToolBoundary(C1);
    expect(delta?.header.revision).toBe(3);
    expect(delta?.header.changedPaths).toEqual(["src/b.ts", "src/c.ts"]);
  });

  it("names the current revision's paths when it is the one last told", async () => {
    edit(["src/a.ts"], "pass");
    await delivery.register(C1);
    sink.applyResults(WT, 1, [result(A, "fail", { revision: 1 })], { checkpointId: null });
    expect((await delivery.onToolBoundary(C1))?.header.changedPaths).toEqual(["src/a.ts"]);
  });

  it("names only the current revision's paths for a consumer with no told revision", async () => {
    edit(["src/a.ts"], "pass");
    await delivery.register(C1);
    store.meta.set(revisionMetaKey(WT), "{}");
    edit(["src/b.ts"]);
    edit(["src/c.ts"], "fail");
    expect((await delivery.onToolBoundary(C1))?.header.changedPaths).toEqual(["src/c.ts"]);
  });

  it("does not count a tool boundary that delivered nothing as a report", async () => {
    edit(["src/a.ts"], "pass");
    await delivery.register(C1);
    edit(["src/b.ts"]);
    expect(await delivery.onToolBoundary(C1)).toBeNull();
    edit(["src/c.ts"], "fail");
    expect((await delivery.onToolBoundary(C1))?.header.changedPaths).toEqual([
      "src/b.ts",
      "src/c.ts",
    ]);
  });
});
