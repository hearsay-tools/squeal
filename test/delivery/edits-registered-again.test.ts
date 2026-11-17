import { beforeEach, describe, expect, it } from "vitest";
import { createDelivery } from "../../src/core/delivery/delivery.js";
import { drop } from "../../src/core/delivery/expiry.js";
import { formatDelta } from "../../src/core/delivery/format.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { recordRefinedApplied } from "../../src/core/scheduler/refined.js";
import { recordRekeyed } from "../../src/core/scheduler/rekeyed-record.js";
import { createStateSink } from "../../src/core/state/sink.js";
import type { Consumer, HarnessDelivery } from "../../src/core/types/delivery.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { StateSink } from "../../src/core/types/state.js";
import type { Store } from "../../src/core/types/store.js";
import { CONSUMER_EXPIRY_MS } from "../../src/core/types/store-records.js";
import { check, FILE, freshStore, result, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * Row 005-100 (the human 2026-11-17, option A on the eval flag): a session that registers
 * again, while registered or parked for a resume, keeps the own count of the test files its
 * edits affect; it does not start again at the registration's revision. Under Codex each turn
 * ends the session (SessionEnd parks it) and the next one resumes it, so the failure delivery
 * after a resume carried no count ("Revision 1 (changed src/invoice.ts)."). A first
 * registration and a new session count from their registration.
 */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const NEW_SESSION: Consumer = { ...C1, sessionId: "s2" };
const OTHER_FILE: TestFileRef = { project: "", path: "src/b.test.ts" };
const A = check("a");
const B = check("b", OTHER_FILE);
const NONE = { checkpointId: null };
const NOT_RUN = "the 1 test file your edits affect has not run.";
const ALL_RAN = "the 1 test file your edits affect has run.";

let store: Store;
let sink: StateSink;
let delivery: HarnessDelivery;
let revision: number;
let now: number;

beforeEach(() => {
  store = freshStore();
  sink = createStateSink(store);
  now = Date.now();
  delivery = createDelivery(store, { status: fixedStatus(), now: () => now });
  revision = 0;
  liveDaemon(store, WT);
  store.testFileKeys.upsertMany([
    { worktreeId: WT, testFile: FILE, key: "k1", revision, pending: null },
    { worktreeId: WT, testFile: OTHER_FILE, key: "b1", revision, pending: null },
  ]);
  sink.applyResults(WT, 0, [result(A, "pass"), result(B, "pass", { key: "b1" })], NONE);
});

/** The consumer's edit of `src/a.ts`: a revision that re-keys `FILE` and queues it. */
function editA(): void {
  revision = store.revisions.append({
    worktreeId: WT,
    createdAt: Date.now(),
    head: null,
    dirty: true,
    trigger: "watch",
    changes: [{ path: "src/a.ts", oldHash: null, newHash: `h-${revision}` }],
  }).number;
  recordRefinedApplied(store, WT, revision);
  store.testFileKeys.upsertMany([
    { worktreeId: WT, testFile: FILE, key: `k${revision + 1}`, revision, pending: "queued" },
  ]);
  recordRekeyed(store, WT, [{ id: testFileId(FILE), open: revision, moved: revision }], []);
}

/** `FILE`'s result at its current key lands: `outcome`. */
function finishA(outcome: "pass" | "fail"): void {
  const key = `k${revision + 1}`;
  store.testFileKeys.upsertMany([{ worktreeId: WT, testFile: FILE, key, revision, pending: null }]);
  sink.applyResults(WT, revision, [result(A, outcome, { key })], NONE);
  recordRekeyed(store, WT, [{ id: testFileId(FILE), open: null, moved: null }], []);
}

async function boundary(consumer: Consumer = C1): Promise<string | null> {
  const delta = await delivery.onToolBoundary(consumer);
  return delta === null ? null : formatDelta(delta);
}

/** Registered, one edit, its first-edit line delivered. */
async function editedThenTold(consumer: Consumer = C1): Promise<void> {
  await delivery.register(consumer);
  editA();
  expect(await boundary(consumer)).toMatch(/Squeal saw your edit/);
}

describe("a registration in a running session keeps the own count (row 005-100)", () => {
  it("while still registered: the failure after it carries the count", async () => {
    await editedThenTold();
    await delivery.register(C1);
    finishA("fail");
    const text = await boundary();
    expect(text).toContain("PASS -> FAIL");
    expect(text).toContain(ALL_RAN);
  });

  it("through park and resume: the failure after it carries the count", async () => {
    await editedThenTold();
    await delivery.unregister(C1);
    await delivery.register(C1);
    finishA("fail");
    const text = await boundary();
    expect(text).toContain("PASS -> FAIL");
    expect(text).toContain(ALL_RAN);
  });

  it("through a waiterless expiry and resume, with the file still owed", async () => {
    await editedThenTold();
    store.transaction(() => drop(store, C1, now));
    await delivery.register(C1);
    sink.applyResults(WT, revision, [result(B, "fail", { key: "b1", message: "b2" })], NONE);
    expect(await boundary()).toContain(NOT_RUN);
  });

  it("keeps the files resolved while it was parked in the count", async () => {
    await editedThenTold();
    await delivery.unregister(C1);
    finishA("pass");
    // Another consumer's delivery prunes the resolved entries no registered consumer counts.
    await delivery.register(NEW_SESSION);
    await delivery.unregister(NEW_SESSION);
    await delivery.register(C1);
    sink.applyResults(WT, revision, [result(B, "fail", { key: "b1", message: "b2" })], NONE);
    expect(await boundary()).toContain(ALL_RAN);
  });

  it("starts again for a parked registration past its lifetime", async () => {
    await editedThenTold();
    await delivery.unregister(C1);
    now += CONSUMER_EXPIRY_MS + 1;
    await delivery.register(C1);
    finishA("fail");
    const text = await boundary();
    expect(text).toContain("PASS -> FAIL");
    expect(text).not.toContain("your edits affect");
  });
});

describe("a first registration and a new session count from their registration", () => {
  it("a new session of the same worktree does not take another session's edits", async () => {
    await editedThenTold();
    await delivery.unregister(C1);
    await delivery.register(NEW_SESSION);
    finishA("fail");
    const text = await boundary(NEW_SESSION);
    expect(text).toContain("PASS -> FAIL");
    expect(text).not.toContain("your edits affect");
  });

  it("a first registration after an edit counts none of it", async () => {
    editA();
    await delivery.register(C1);
    finishA("fail");
    const text = await boundary();
    expect(text).toContain("PASS -> FAIL");
    expect(text).not.toContain("your edits affect");
  });
});
