import { beforeEach, describe, expect, it } from "vitest";
import {
  createDelivery,
  DAEMON_START_GRACE_MS,
  formatDelta,
  markRest,
  spawnedAfterRest,
  worktreeLiveness,
} from "../../src/core/delivery/index.js";
import { testFileId } from "../../src/core/keys/index.js";
import { recordRekeyed } from "../../src/core/scheduler/rekeyed-record.js";
import { createStateSink } from "../../src/core/state/index.js";
import {
  type Consumer,
  type HarnessDelivery,
  refinedMetaKey,
  type StateSink,
  type Store,
} from "../../src/core/types/index.js";
import { check, FILE, freshStore, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus } from "./fakes.js";

/*
 * Review 001-417 B2: while a daemon rests after its unused stop (D10 as
 * amended by task 001-415), no delivered header says no daemon is
 * validating, whatever news it carries. A start overdue past
 * `DAEMON_START_GRACE_MS`, and a later real stop, still say so.
 */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const A = check("a");
const NONE = { checkpointId: null };
const DOWN = /No daemon (has validated|is running)/;

let store: Store;
let sink: StateSink;
let delivery: HarnessDelivery;
let clock: number;

beforeEach(async () => {
  store = freshStore();
  clock = 100;
  sink = createStateSink(store, { now: () => clock });
  delivery = createDelivery(store, { status: fixedStatus(), now: () => clock });
  setKey(store, "k1");
  store.worktrees.upsert({
    id: WT,
    root: "/repo",
    commonDir: "/repo/.git",
    isMain: true,
    registeredAt: 1,
    daemon: {
      socketPath: "/run/squeal.sock",
      startedAt: 1,
      heartbeatAt: 100,
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0-test",
    },
  });
  sink.applyResults(WT, 1, [result(A, "pass")], NONE);
  await delivery.register(C1);
});

/** The daemon stops unused at 200, its record cleared; a hook spawns its successor at 300. */
function rest(spawn = true): void {
  markRest(store, WT, 200);
  store.worktrees.setDaemon(WT, null);
  if (spawn) spawnedAfterRest(store, WT, 300);
}

async function text(at: number): Promise<string | null> {
  clock = at;
  const delta = await delivery.onToolBoundary(C1);
  return delta === null ? null : formatDelta(delta);
}

describe("a header delivered while the daemon rests (review 001-417 B2)", () => {
  it("carries an undelivered failure without a down warning", async () => {
    sink.applyResults(WT, 1, [result(A, "fail")], NONE);
    rest();
    const said = await text(301);
    expect(said).toContain("FAIL  src/a.test.ts > a");
    expect(said).not.toMatch(DOWN);
    expect(said).toMatch(/ A daemon is starting; results are as of revision \d+\./);
    // Status judges the record alone, as `worktreeLiveness` does: still down.
    expect(worktreeLiveness(store.worktrees.get(WT), 301).state).toBe("down");
  });

  it("carries edit news without a down warning, before any successor was spawned", async () => {
    rest(false);
    const revision = store.revisions.append({
      worktreeId: WT,
      createdAt: 250,
      head: null,
      dirty: true,
      trigger: "watch",
      changes: [{ path: "src/a.ts", oldHash: null, newHash: "h2" }],
    }).number;
    store.meta.set(refinedMetaKey(WT), String(revision));
    store.testFileKeys.upsertMany([
      { worktreeId: WT, testFile: FILE, key: "k2", revision, pending: "queued" },
    ]);
    recordRekeyed(store, WT, [{ id: testFileId(FILE), open: revision, moved: revision }], []);
    const said = await text(301);
    expect(said).toMatch(/Squeal saw your edit and queued 1 test file/);
    expect(said).not.toMatch(DOWN);
    expect(said).toContain("The daemon stopped while unused; results are as of revision 1.");
  });

  it("warns once the successor is overdue past the start grace", async () => {
    sink.applyResults(WT, 1, [result(A, "fail")], NONE);
    rest();
    const said = await text(300 + DAEMON_START_GRACE_MS + 1);
    expect(said).toContain("FAIL  src/a.test.ts > a");
    expect(said).toMatch(DOWN);
  });

  it("warns for a real stop after a heartbeat newer than an old rest mark", async () => {
    sink.applyResults(WT, 1, [result(A, "fail")], NONE);
    markRest(store, WT, 50);
    store.worktrees.setDaemon(WT, null);
    expect(await text(301)).toMatch(DOWN);
  });
});
