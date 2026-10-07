import { beforeEach, describe, expect, it } from "vitest";
import { createDelivery, formatDelta } from "../../src/core/delivery/index.js";
import { createStateSink } from "../../src/core/state/index.js";
import type {
  Consumer,
  Delta,
  HarnessDelivery,
  ResultRecord,
  StateSink,
  Store,
  TransitionEntry,
} from "../../src/core/types/index.js";
import { check, FILE, freshStore, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus } from "./fakes.js";

/*
 * Task 001-94, review wave 10b B1: the revision a consumer registered at is
 * where "your changes" start, so a registration of a consumer still
 * registered (SessionStart `resume`) keeps it.
 */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const A = check("a");
const NONE = { checkpointId: null };

let store: Store;
let sink: StateSink;
let delivery: HarnessDelivery;

beforeEach(() => {
  store = freshStore();
  sink = createStateSink(store);
  delivery = createDelivery(store, { status: fixedStatus() });
  setKey(store, "k1");
  store.testFiles.put({
    testFile: FILE,
    closure: {
      testFile: FILE,
      paths: ["src/a.test.ts", "src/x.ts"],
      complete: false,
      method: "static imports plus declared inputs",
    },
    updatedAt: 1,
    updatedBy: WT,
  });
});

function edit(paths: readonly string[]): number {
  return store.revisions.append({
    worktreeId: WT,
    createdAt: 1,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: paths.map((path) => ({ path, oldHash: null, newHash: `h-${path}` })),
  }).number;
}

function apply(revision: number, ...results: ResultRecord[]): void {
  store.results.putMany(results);
  sink.applyResults(WT, revision, results, NONE);
}

async function failing(): Promise<{ entry: TransitionEntry; text: string }> {
  const delta = await delivery.onToolBoundary(C1);
  const entry = delta?.entries.find((e) => e.to === "fail");
  if (entry === undefined || entry.kind === "fail-retired") throw new Error("no failure delivered");
  return { entry, text: formatDelta(delta as Delta) };
}

describe("a registration of a consumer still registered", () => {
  it("keeps the revision it first registered at (B1 probe)", async () => {
    apply(edit(["src/a.test.ts"]), result(A, "pass"));
    await delivery.register(C1);
    edit(["src/x.ts"]);
    await delivery.register(C1);
    apply(edit(["README.md"]), result(A, "fail"));
    const { entry, text } = await failing();
    expect(entry.changesInClosure).toEqual(["src/x.ts"]);
    expect(text).toContain("touches your changes: src/x.ts");
    expect(text).not.toContain("none of your changes");
  });
});
