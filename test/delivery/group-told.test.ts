import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeCommitReports } from "../../src/core/commit/store.js";
import { commitToldMetaKey } from "../../src/core/delivery/commit-told.js";
import { createDelivery } from "../../src/core/delivery/delivery.js";
import { formatDelta } from "../../src/core/delivery/format.js";
import { createStateSink } from "../../src/core/state/sink.js";
import type { Consumer, Delta, HarnessDelivery } from "../../src/core/types/delivery.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { StateSink } from "../../src/core/types/state.js";
import type { Store } from "../../src/core/types/store.js";
import type { ResultRecord } from "../../src/core/types/store-records.js";
import { check, freshStore, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * Row 019-16 (spec 019 D5 step 3, D6): with a `checks` key, a change
 * delivery carries the group lines when a group's state changed, as the
 * slow-tier line (001-407), and each commit report once, at the next tool
 * boundary or, since row 019-38, the next Stop, as news by itself. Without
 * the key nothing is said.
 */

const E2E_FILE: TestFileRef = { project: "", path: "test/e2e/a.test.ts" };
const FAST: TestFileRef = { project: "", path: "src/a.test.ts" };
const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const E2E = check("e2e", E2E_FILE);
const UNIT = check("unit", FAST);
const CHECKS = {
  checks: [{ name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop" }],
};
const REPORT = {
  commit: "abc1234def5678",
  revision: 1,
  at: 1,
  tests: { files: 2, failures: 1, notDetermined: 0, running: 0, unknown: 0 },
};

let root: string;
let store: Store;
let sink: StateSink;
let delivery: HarnessDelivery;

function setUp(policy: object): void {
  root = mkdtempSync(join(tmpdir(), "squeal-019-16-"));
  writeFileSync(join(root, "squeal.config.json"), JSON.stringify(policy));
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
  setKey(store, "k1", { file: E2E_FILE });
  setKey(store, "u1", { file: FAST });
}
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

const lineOf = (text: string, start: string) => text.split("\n").find((l) => l.startsWith(start));

async function registered(policy: object): Promise<void> {
  setUp(policy);
  outcome = "pass";
  apply(result(E2E, "pass", { key: "k1" }), result(UNIT, "pass", { key: "u1" }));
  await delivery.register(C1, { atStart: true });
}

describe("the group lines in a change delivery (019 D6)", () => {
  beforeEach(() => registered(CHECKS));

  it("are carried once when a group's state changes, then left out", async () => {
    flipUnit();
    expect(lineOf(formatDelta(await boundary()), "e2e:")).toBeUndefined();
    setKey(store, "k2", { file: E2E_FILE, pending: "queued" });
    sink.refresh(WT, revision(), { checkpointId: null });
    flipUnit();
    const changed = await boundary();
    expect(changed.groupTiersChanged).toBe(true);
    expect(lineOf(formatDelta(changed), "e2e:")).toMatch(/^e2e: 1 test file; 1 pending\./);
    flipUnit();
    expect(lineOf(formatDelta(await boundary()), "e2e:")).toBeUndefined();
  });
});

describe("the commit line in a change delivery (019 D5 step 3)", () => {
  it("is news by itself at the next tool boundary, once per report", async () => {
    await registered(CHECKS);
    writeCommitReports(store.meta, WT, REPORT.commit, REPORT);
    const d = await boundary();
    expect(d.commitChanged).toBe(true);
    expect(formatDelta(d).split("\n")).toContain("Commit abc1234: 1 known failure");
    expect(await delivery.onToolBoundary(C1)).toBeNull();
  });

  it("is not told at registration for a commit made before it", async () => {
    setUp(CHECKS);
    apply(result(UNIT, "pass", { key: "u1" }));
    writeCommitReports(store.meta, WT, REPORT.commit, REPORT);
    await delivery.register(C1, { atStart: true });
    expect(await delivery.onToolBoundary(C1)).toBeNull();
  });

  it("says nothing without a `checks` key, and marks the report told", async () => {
    await registered({});
    writeCommitReports(store.meta, WT, REPORT.commit, REPORT);
    expect(await delivery.onToolBoundary(C1)).toBeNull();
    expect(store.meta.get(commitToldMetaKey(WT))).toContain(REPORT.commit);
    flipUnit();
    expect(formatDelta(await boundary())).not.toContain("Commit abc1234");
  });

  it("is news by itself at a Stop no boundary told it before, once (019-38)", async () => {
    await registered(CHECKS);
    writeCommitReports(store.meta, WT, REPORT.commit, REPORT);
    const d = await delivery.onToolBoundary(C1, { stop: true });
    if (d === null) throw new Error("no delta");
    expect(d.commitChanged).toBe(true);
    // Stop's form: the full header block (task 001-407).
    const text = formatDelta(d, undefined, undefined, "full");
    expect(text.split("\n")).toContain("Commit abc1234: 1 known failure");
    expect(await delivery.onToolBoundary(C1, { stop: true })).toBeNull();
    expect(await delivery.onToolBoundary(C1)).toBeNull();
  });

  it("says nothing at a Stop without a `checks` key, and marks the report told (019-38)", async () => {
    await registered({});
    writeCommitReports(store.meta, WT, REPORT.commit, REPORT);
    expect(await delivery.onToolBoundary(C1, { stop: true })).toBeNull();
    expect(store.meta.get(commitToldMetaKey(WT))).toContain(REPORT.commit);
  });
});
