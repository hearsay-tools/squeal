import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDelivery, formatDelta } from "../../src/core/delivery/index.js";
import { slowToldMetaKey } from "../../src/core/delivery/slow-told.js";
import { createStateSink } from "../../src/core/state/index.js";
import type {
  Consumer,
  Delta,
  HarnessDelivery,
  ResultRecord,
  StateSink,
  Store,
  TestFileRef,
} from "../../src/core/types/index.js";
import { newsText } from "../../src/harness/shared/stop.js";
import { check, freshStore, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * Task 001-407: a change delivery carries the slow-tier line only when the
 * slow tier's state changed since the consumer was last shown it, at its
 * registration, at Stop or in a delivery that carried it.
 */

const SLOW: TestFileRef = { project: "", path: "test/e2e/a.test.ts" };
const FAST: TestFileRef = { project: "", path: "src/a.test.ts" };
const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const E2E = check("e2e", SLOW);
const UNIT = check("unit", FAST);

let root: string;
let store: Store;
let sink: StateSink;
let delivery: HarnessDelivery;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-001-407-"));
  writeFileSync(
    join(root, "squeal.config.json"),
    JSON.stringify({ slow: { include: ["test/e2e/**"] } }),
  );
  store = freshStore();
  store.worktrees.upsert({
    id: WT,
    root,
    commonDir: join(root, ".git"),
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  liveDaemon(store, WT);
  sink = createStateSink(store);
  delivery = createDelivery(store, { status: fixedStatus() });
  setKey(store, "k1", { file: SLOW });
  setKey(store, "u1", { file: FAST });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function revision(): number {
  return store.revisions.append({
    worktreeId: WT,
    createdAt: 1,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: [{ path: "src/x.ts", oldHash: null, newHash: "h" }],
  }).number;
}

function apply(...results: ResultRecord[]): void {
  const at = revision();
  store.results.putMany(results);
  sink.applyResults(WT, at, results, { checkpointId: null });
}

/** The unit test flips, so the next tool boundary has news. */
let outcome: "pass" | "fail" = "pass";
function flipUnit(): void {
  outcome = outcome === "pass" ? "fail" : "pass";
  apply(result(UNIT, outcome, { key: "u1" }));
}

async function boundary(): Promise<Delta> {
  const d = await delivery.onToolBoundary(C1);
  if (d === null) throw new Error("no delta");
  return d;
}

/** An edit re-keys the slow file and queues it: the slow tier goes pending. */
function queueSlow(): void {
  setKey(store, "k2", { file: SLOW, pending: "queued" });
  sink.refresh(WT, revision(), { checkpointId: null });
}

const slowLine = (text: string) => text.split("\n").find((l) => l.startsWith("Slow tier:"));

beforeEach(async () => {
  outcome = "pass";
  apply(result(E2E, "pass", { key: "k1" }), result(UNIT, "pass", { key: "u1" }));
  await delivery.register(C1, { atStart: true });
});

describe("the slow-tier line in a change delivery (task 001-407)", () => {
  it("is left out while the slow tier is as the registration showed it", async () => {
    flipUnit();
    const d = await boundary();
    expect(d.slowTierChanged).toBeUndefined();
    expect(slowLine(formatDelta(d))).toBeUndefined();
  });

  it("is carried once when the slow tier changes, then left out again", async () => {
    queueSlow();
    flipUnit();
    const changed = await boundary();
    expect(changed.slowTierChanged).toBe(true);
    expect(slowLine(formatDelta(changed))).toMatch(/^Slow tier: 1 test file; 1 pending\./);
    flipUnit();
    expect(slowLine(formatDelta(await boundary()))).toBeUndefined();
  });

  it("stays owed when no delivery carried the change", async () => {
    queueSlow();
    // A change of the slow tier alone is no news to deliver.
    expect(await delivery.onToolBoundary(C1)).toBeNull();
    flipUnit();
    expect((await boundary()).slowTierChanged).toBe(true);
  });

  it("is always in Stop's report, which counts as showing it", async () => {
    // Stop's context: only the store, the delivery and the consumer are read here.
    const context = { store, delivery, consumer: C1 } as Parameters<typeof newsText>[0];
    flipUnit();
    const unchanged = await newsText(context, {});
    expect(slowLine(unchanged ?? "")).toMatch(/^Slow tier: 1 test file; 1 current/);
    expect(unchanged).toContain("Full-suite checkpoint:");
    queueSlow();
    flipUnit();
    expect(slowLine((await newsText(context, {})) ?? "")).toMatch(
      /^Slow tier: 1 test file; 1 pending\./,
    );
    flipUnit();
    expect((await boundary()).slowTierChanged).toBeUndefined();
  });

  it("forgets what the consumer was shown when it unregisters", async () => {
    await delivery.unregister(C1);
    expect(store.meta.get(slowToldMetaKey(WT))).toBe("{}");
  });
});
