import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDelivery, formatDelta } from "../../src/core/delivery/index.js";
import { createStateSink } from "../../src/core/state/index.js";
import {
  CONSUMER_EXPIRY_MS,
  type Consumer,
  type Delta,
  type HarnessDelivery,
  type ResultRecord,
  type StateSink,
  type Store,
  type TransitionEntry,
} from "../../src/core/types/index.js";
import { check, FILE, freshStore, OTHER, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

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
  liveDaemon(store, WT);
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

describe("a registration before the daemon's start scan (B2)", () => {
  /** The start scan records what changed while no daemon ran. */
  function startScan(paths: readonly string[]): void {
    store.revisions.append({
      worktreeId: WT,
      createdAt: 1,
      head: null,
      dirty: true,
      trigger: "start",
      changes: paths.map((path) => ({ path, oldHash: "old", newHash: `h-${path}` })),
    });
  }

  it("records no revision, so a start revision is never the agent's (B2 probe)", async () => {
    apply(edit(["src/a.test.ts"]), result(A, "pass"));
    liveDaemon(store, WT, { scanned: false, startedAt: 2 });
    await delivery.register(C1);
    startScan(["src/x.ts"]);
    liveDaemon(store, WT, { startedAt: 2 });
    apply(edit(["README.md"]), result(A, "fail"));
    const { entry, text } = await failing();
    expect(entry.changesInClosure).toBeUndefined();
    expect(text).not.toContain("your changes");
  });

  it("records none while the marker is an earlier daemon's", async () => {
    apply(edit(["src/a.test.ts"]), result(A, "pass"));
    liveDaemon(store, WT, { startedAt: 1 });
    liveDaemon(store, WT, { scanned: false, startedAt: 2 });
    await delivery.register(C1);
    apply(edit(["src/x.ts"]), result(A, "fail"));
    expect((await failing()).entry.changesInClosure).toBeUndefined();
  });

  it("records none while no daemon is alive", async () => {
    apply(edit(["src/a.test.ts"]), result(A, "pass"));
    store.worktrees.setDaemon(WT, null);
    await delivery.register(C1);
    liveDaemon(store, WT, { startedAt: 3 });
    apply(edit(["src/x.ts"]), result(A, "fail"));
    expect((await failing()).entry.changesInClosure).toBeUndefined();
  });

  it("records the revision once the scan is recorded", async () => {
    apply(edit(["src/a.test.ts"]), result(A, "pass"));
    startScan(["src/x.ts"]);
    liveDaemon(store, WT, { startedAt: 2 });
    await delivery.register(C1);
    apply(edit(["README.md"]), result(A, "fail"));
    const { text } = await failing();
    expect(text).toContain("none of your changes are in its imports");
  });
});

describe("a consumer that left and registers again (N4)", () => {
  let clock = 1_000;

  beforeEach(() => {
    delivery = createDelivery(store, { status: fixedStatus(), now: () => clock });
    store.testFiles.put({
      testFile: FILE,
      closure: {
        testFile: FILE,
        paths: ["src/a.test.ts", "src/x.ts", "src/y.ts"],
        complete: false,
        method: "static imports plus declared inputs",
      },
      updatedAt: 1,
      updatedBy: WT,
    });
  });

  it("keeps its changes from before it left, without the ones made while it was away", async () => {
    apply(edit(["src/a.test.ts"]), result(A, "pass"));
    await delivery.register(C1);
    edit(["src/x.ts"]); // the agent
    await delivery.unregister(C1);
    edit(["src/y.ts"]); // someone else, while the session was gone
    await delivery.register(C1);
    apply(edit(["README.md"]), result(A, "fail"));
    expect((await failing()).entry.changesInClosure).toEqual(["src/x.ts"]);
  });

  it("starts over after the consumer expiry", async () => {
    apply(edit(["src/a.test.ts"]), result(A, "pass"));
    await delivery.register(C1);
    edit(["src/x.ts"]);
    await delivery.unregister(C1);
    clock += CONSUMER_EXPIRY_MS + 1;
    await delivery.register(C1);
    apply(edit(["README.md"]), result(A, "fail"));
    expect((await failing()).entry.changesInClosure).toEqual([]);
  });

  it("is kept for its session and agent only", async () => {
    apply(edit(["src/a.test.ts"]), result(A, "pass"));
    await delivery.register(C1);
    edit(["src/x.ts"]);
    await delivery.unregister(C1);
    const other: Consumer = { ...C1, sessionId: "s2" };
    await delivery.register(other);
    apply(edit(["README.md"]), result(A, "fail"));
    const delta = await delivery.onToolBoundary(other);
    const entry = delta?.entries.find((e) => e.to === "fail");
    expect(entry !== undefined && "changesInClosure" in entry && entry.changesInClosure).toEqual(
      [],
    );
  });
});

/*
 * Review wave 10b S2: the stored closure is repository-wide, newest wins. A
 * failure is read against it only when it is this worktree's: written by
 * this worktree, or by one whose current key for the test file is this
 * worktree's. Otherwise neither line appears.
 */
describe("whose closure a failure is read against (S2)", () => {
  function storedBy(worktreeId: string, paths: readonly string[]): void {
    store.testFiles.put({
      testFile: FILE,
      closure: {
        testFile: FILE,
        paths,
        complete: false,
        method: "static imports plus declared inputs",
      },
      updatedAt: 2,
      updatedBy: worktreeId,
    });
  }

  beforeEach(async () => {
    apply(edit(["src/a.test.ts"]), result(A, "pass"));
    await delivery.register(C1);
  });

  it("ignores another worktree's closure under a different key (S2 probe)", async () => {
    setKey(store, "k-other", { worktreeId: OTHER });
    storedBy(OTHER, ["src/a.test.ts"]);
    apply(edit(["src/x.ts"]), result(A, "fail"));
    const { entry, text } = await failing();
    expect(entry.changesInClosure).toBeUndefined();
    expect(text).not.toContain("your changes");
  });

  it("reads another worktree's closure stored under this worktree's key", async () => {
    setKey(store, "k1", { worktreeId: OTHER });
    storedBy(OTHER, ["src/a.test.ts", "src/x.ts"]);
    apply(edit(["src/x.ts"]), result(A, "fail"));
    expect((await failing()).entry.changesInClosure).toEqual(["src/x.ts"]);
  });

  it("gives each worktree its own when both wrote one", async () => {
    const C2: Consumer = { worktreeId: OTHER, sessionId: "s2", agentId: "main" };
    liveDaemon(store, OTHER);
    setKey(store, "k-other", { worktreeId: OTHER });
    await delivery.register(C2);
    storedBy(OTHER, ["src/a.test.ts", "src/y.ts"]);
    const other = store.revisions.append({
      worktreeId: OTHER,
      createdAt: 1,
      head: null,
      dirty: true,
      trigger: "watch",
      changes: [{ path: "src/y.ts", oldHash: null, newHash: "y" }],
    }).number;
    const failed = result(A, "fail", { worktreeId: OTHER, key: "k-other", revision: other });
    store.results.putMany([failed]);
    sink.applyResults(OTHER, other, [failed], NONE);
    const delta = await delivery.onToolBoundary(C2);
    expect(formatDelta(delta as Delta)).toContain("touches your changes: src/y.ts");

    // This worktree's daemon stores its own closure last; the other worktree's is gone.
    storedBy(WT, ["src/a.test.ts", "src/x.ts"]);
    apply(edit(["src/x.ts"]), result(A, "fail"));
    expect((await failing()).text).toContain("touches your changes: src/x.ts");
  });
});

describe("the revisions since registration (review wave 10b, N3)", () => {
  it("are read in one query, however many there are", async () => {
    apply(edit(["src/a.test.ts"]), result(A, "pass"));
    await delivery.register(C1);
    for (let i = 0; i < 3_000; i++) edit([`src/f${i % 50}.ts`]);
    apply(edit(["src/x.ts"]), result(A, "fail"));
    const get = vi.spyOn(store.revisions, "get");
    const range = vi.spyOn(store.revisions, "range");
    const started = performance.now();
    const { entry } = await failing();
    const elapsed = performance.now() - started;
    expect(entry.changesInClosure).toEqual(["src/x.ts"]);
    expect(get).not.toHaveBeenCalled();
    // The attribution's and the header's changed paths, one query each.
    expect(range).toHaveBeenCalledTimes(2);
    console.log(`N3: delivery with 3,002 revisions since registration: ${elapsed.toFixed(1)} ms`);
  });
});
