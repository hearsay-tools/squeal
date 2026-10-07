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

/** A daemon's start scan: what changed while no daemon ran, and any edit made before it. */
function startScan(paths: readonly string[]): number {
  return store.revisions.append({
    worktreeId: WT,
    createdAt: 1,
    head: null,
    dirty: true,
    trigger: "start",
    changes: paths.map((path) => ({ path, oldHash: "old", newHash: `h-${path}` })),
  }).number;
}

/** A daemon spawned with `startedAt`: its heartbeat first, its scan, then its marker. */
function restart(startedAt: number, paths: readonly string[] = []): void {
  liveDaemon(store, WT, { scanned: false, startedAt });
  if (paths.length > 0) startScan(paths);
  liveDaemon(store, WT, { startedAt });
}

/*
 * Task 001-96 (review wave 10c B1, wave 10b B2): no `start` revision is the
 * agent's. A failure whose closure holds a path one changed gets neither
 * line, whether the scan came after registration (a spawn, a restart) or is
 * the revision the consumer registered at.
 */
describe("a start revision", () => {
  it("of a daemon spawned at registration counts none of it (wave 10b B2 probe)", async () => {
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

  it("of a daemon restarted while the consumer stayed registered gives neither line (wave 10c B1 probe)", async () => {
    apply(edit(["src/a.test.ts"]), result(A, "pass"));
    await delivery.register(C1);
    restart(99, ["src/x.ts"]); // someone's git pull while no daemon ran
    apply(edit(["README.md"]), result(A, "fail"));
    const { entry, text } = await failing();
    expect(entry.changesInClosure).toBeUndefined();
    expect(text).not.toContain("your changes");
  });

  it("that absorbed an edit before it was recorded gives neither line, never none", async () => {
    apply(edit(["src/a.test.ts"]), result(A, "pass"));
    liveDaemon(store, WT, { scanned: false, startedAt: 2 });
    await delivery.register(C1);
    startScan(["src/x.ts"]); // the agent's first edit, made before the scan read the file
    liveDaemon(store, WT, { startedAt: 2 });
    edit(["src/x.ts"]); // and edited again since
    apply(edit(["README.md"]), result(A, "fail"));
    const { entry, text } = await failing();
    expect(entry.changesInClosure).toBeUndefined();
    expect(text).not.toContain("none of your changes");
  });

  it("that is the registration revision gives neither line", async () => {
    apply(edit(["src/a.test.ts"]), result(A, "pass"));
    restart(2, ["src/x.ts"]);
    await delivery.register(C1);
    apply(edit(["README.md"]), result(A, "fail"));
    expect((await failing()).entry.changesInClosure).toBeUndefined();
  });

  it("whose paths miss the closure leaves the agent's changes named", async () => {
    apply(edit(["src/a.test.ts"]), result(A, "pass"));
    await delivery.register(C1);
    restart(2, ["src/other.ts"]);
    apply(edit(["src/x.ts"]), result(A, "fail"));
    expect((await failing()).text).toContain("touches your changes: src/x.ts");
  });
});

/*
 * Task 001-96: a start scan hashes the files it has no hash for without a
 * revision, so an edit made before it can be in none. "None of your
 * changes" appears only while the daemon that had finished its start scan
 * when the consumer registered is still the one recorded.
 */
describe("none of your changes", () => {
  it("is said when the live daemon had scanned at registration", async () => {
    apply(edit(["src/a.test.ts"]), result(A, "pass"));
    await delivery.register(C1);
    apply(edit(["README.md"]), result(A, "fail"));
    expect((await failing()).text).toContain("none of your changes are in its imports");
  });

  it("is not said for a registration before the start scan, a new worktree's seeding", async () => {
    liveDaemon(store, WT, { scanned: false, startedAt: 2 });
    await delivery.register(C1);
    // The scan seeds every file without a revision, the agent's early edit of src/x.ts too.
    liveDaemon(store, WT, { startedAt: 2 });
    apply(edit(["README.md"]), result(A, "fail"));
    const { entry, text } = await failing();
    expect(entry.changesInClosure).toBeUndefined();
    expect(text).not.toContain("your changes");
  });

  it("is not said once another daemon started, even with no start revision", async () => {
    apply(edit(["src/a.test.ts"]), result(A, "pass"));
    await delivery.register(C1);
    restart(2);
    apply(edit(["README.md"]), result(A, "fail"));
    expect((await failing()).entry.changesInClosure).toBeUndefined();
  });

  it("is not said for a registration while no daemon is alive", async () => {
    apply(edit(["src/a.test.ts"]), result(A, "pass"));
    store.worktrees.setDaemon(WT, null);
    await delivery.register(C1);
    restart(3);
    apply(edit(["README.md"]), result(A, "fail"));
    expect((await failing()).entry.changesInClosure).toBeUndefined();
  });

  it("is not said while the marker is an earlier daemon's", async () => {
    apply(edit(["src/a.test.ts"]), result(A, "pass"));
    liveDaemon(store, WT, { scanned: false, startedAt: 2 });
    await delivery.register(C1);
    apply(edit(["README.md"]), result(A, "fail"));
    expect((await failing()).entry.changesInClosure).toBeUndefined();
  });

  it("leaves the agent's changes named before the start scan", async () => {
    apply(edit(["src/a.test.ts"]), result(A, "pass"));
    liveDaemon(store, WT, { scanned: false, startedAt: 2 });
    await delivery.register(C1);
    liveDaemon(store, WT, { startedAt: 2 });
    apply(edit(["src/x.ts"]), result(A, "fail"));
    expect((await failing()).text).toContain("touches your changes: src/x.ts");
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

  it("is not told none of its changes once another daemon started while it was away", async () => {
    apply(edit(["src/a.test.ts"]), result(A, "pass"));
    await delivery.register(C1);
    await delivery.unregister(C1);
    restart(2);
    await delivery.register(C1);
    apply(edit(["README.md"]), result(A, "fail"));
    expect((await failing()).entry.changesInClosure).toBeUndefined();
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
