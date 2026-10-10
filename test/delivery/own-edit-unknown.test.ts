import { beforeEach, describe, expect, it } from "vitest";
import { createDelivery } from "../../src/core/delivery/index.js";
import { movedPaths } from "../../src/core/delivery/own-edit.js";
import { createStateSink } from "../../src/core/state/index.js";
import type {
  Consumer,
  DeltaKind,
  HarnessDelivery,
  ResultRecord,
  StateSink,
  Store,
} from "../../src/core/types/index.js";
import { withoutFiles, withoutTouched } from "../../src/runners/vitest/moved.js";
import { WorktreePaths } from "../../src/runners/vitest/paths.js";
import { check, FILE, freshStore, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * Task 001-220, decided by the human: a PASS -> UNKNOWN whose only cause is
 * the consumer's own edit landing during the file's run (the 001-146 stamps)
 * is not delivered, and is never recorded as told, so the next delivery
 * compares against PASS. Every other UNKNOWN is delivered as before.
 */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const A = check("a");
const NONE = { checkpointId: null };

/** The reason the Vitest adapter gives a file 001-146 dropped, as the composite runner prefixes it. */
const moved = (paths: string) =>
  `vitest: vitest adapter: ${paths} changed on disk after this run loaded it; the run may have executed bytes no check key names (task 001-146)`;

let store: Store;
let sink: StateSink;
let delivery: HarnessDelivery;
let revision: number;

beforeEach(() => {
  store = freshStore();
  sink = createStateSink(store);
  delivery = createDelivery(store, { status: fixedStatus() });
  revision = 0;
  liveDaemon(store, WT);
  setKey(store, "k1");
});

function apply(...results: ResultRecord[]) {
  sink.applyResults(WT, ++revision, results, NONE);
}

/** A watched revision changing `paths`. */
function edit(paths: readonly string[]): number {
  revision = store.revisions.append({
    worktreeId: WT,
    createdAt: 1,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: paths.map((path) => ({ path, oldHash: null, newHash: `h-${path}` })),
  }).number;
  return revision;
}

/** The kinds a tool boundary delivers; the first one after the edit also carries 001-224's line. */
async function kinds(): Promise<DeltaKind[]> {
  const delta = await delivery.onToolBoundary(C1);
  return delta?.entries.map((e) => e.kind) ?? [];
}

/** A told PASS, then the consumer's edit of `src/a.ts` re-queues the file at a new key. */
async function passThenOwnEdit(): Promise<void> {
  apply(result(A, "pass"));
  await delivery.register(C1);
  edit(["src/a.ts"]);
  setKey(store, "k2", { pending: "queued" });
}

describe("a PASS -> UNKNOWN from the consumer's own edit landing mid-run (task 001-220)", () => {
  it("is not delivered while the file is pending again", async () => {
    await passThenOwnEdit();
    sink.markUnknown(WT, revision, [FILE], moved("src/a.ts"));
    expect(await kinds()).toEqual([]);
    expect(store.knownStates.list(WT)).toMatchObject([{ outcome: "unknown", validity: "pending" }]);
  });

  it("is never told, so a later failure reads PASS -> FAIL and a later pass stays quiet", async () => {
    await passThenOwnEdit();
    sink.markUnknown(WT, revision, [FILE], moved("src/a.ts"));
    expect(await kinds()).toEqual([]);
    setKey(store, "k2");
    apply(result(A, "pass", { key: "k2" }));
    expect(await kinds()).toEqual([]);
    setKey(store, "k3");
    apply(result(A, "fail", { key: "k3" }));
    expect((await delivery.onToolBoundary(C1))?.entries).toMatchObject([
      { kind: "pass-to-fail", from: "pass", to: "fail" },
    ]);
  });

  it("is delivered when the reason has another cause beside the moved file", async () => {
    await passThenOwnEdit();
    sink.markUnknown(WT, revision, [FILE], `vitest: runner crashed\n${moved("src/a.ts")}`);
    expect(await kinds()).toEqual(["to-unknown"]);
  });

  it("is delivered when another runner part failed too", async () => {
    await passThenOwnEdit();
    sink.markUnknown(WT, revision, [FILE], `${moved("src/a.ts")}; node-test: crashed`);
    expect(await kinds()).toEqual(["to-unknown"]);
  });

  it("is delivered when a moved file is not among the consumer's changes", async () => {
    await passThenOwnEdit();
    sink.markUnknown(WT, revision, [FILE], moved("src/a.ts, src/b.ts"));
    expect(await kinds()).toEqual(["to-unknown"]);
  });

  it("is delivered when the moved file changed only before the consumer registered", async () => {
    apply(result(A, "pass"));
    edit(["src/a.ts"]);
    await delivery.register(C1);
    setKey(store, "k2", { pending: "queued" });
    sink.markUnknown(WT, revision, [FILE], moved("src/a.ts"));
    expect(await kinds()).toEqual(["to-unknown"]);
  });

  it("is delivered when the file is not pending again", async () => {
    apply(result(A, "pass"));
    await delivery.register(C1);
    edit(["src/a.ts"]);
    sink.markUnknown(WT, revision, [FILE], moved("src/a.ts"));
    expect(await kinds()).toEqual(["to-unknown"]);
  });

  it("is delivered for a file written during the run that ended as it was (task 001-159)", async () => {
    await passThenOwnEdit();
    const touched =
      "vitest: vitest adapter: src/a.ts was written during this run and ended as it was; the run may have executed bytes no check key names (task 001-159)";
    sink.markUnknown(WT, revision, [FILE], touched);
    expect(await kinds()).toEqual(["to-unknown"]);
  });

  it("keeps FAIL -> UNKNOWN delivered", async () => {
    apply(result(A, "fail"));
    await delivery.register(C1);
    edit(["src/a.ts"]);
    setKey(store, "k2", { pending: "queued" });
    sink.markUnknown(WT, revision, [FILE], moved("src/a.ts"));
    expect(await kinds()).toEqual(["to-unknown"]);
  });
});

describe("movedPaths", () => {
  const report = {
    end: "completed",
    durationMs: 1,
    completedFiles: [FILE],
    results: [],
    fileErrors: [],
    failure: null,
  } as const;
  const paths = new WorktreePaths("/repo");

  it("reads the files the Vitest adapter's 001-146 reason names", () => {
    const { failure } = withoutFiles(report, [FILE], ["/repo/src/a.ts", "/repo/src/b.ts"], paths);
    expect(movedPaths(failure ?? "")).toEqual(["src/a.ts", "src/b.ts"]);
    expect(movedPaths(`vitest: ${failure}`)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("reads nothing from the 001-159 reason or a reason with another line", () => {
    const touched = withoutTouched(report, [FILE], ["src/a.ts"]).failure ?? "";
    expect(movedPaths(touched)).toBeNull();
    const both = withoutFiles({ ...report, failure: "boom" }, [FILE], ["/repo/src/a.ts"], paths);
    expect(movedPaths(both.failure ?? "")).toBeNull();
  });
});
