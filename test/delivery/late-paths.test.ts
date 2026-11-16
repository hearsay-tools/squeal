import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createDelivery } from "../../src/core/delivery/delivery.js";
import { formatDelta } from "../../src/core/delivery/format.js";
import { lateMetaKey } from "../../src/core/delivery/late.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { feedDeliveredMetaKey } from "../../src/core/presence/stored.js";
import { recordRefinedApplied } from "../../src/core/scheduler/refined.js";
import { recordRekeyed } from "../../src/core/scheduler/rekeyed-record.js";
import { createStateSink } from "../../src/core/state/sink.js";
import { FEED_LATE_MS } from "../../src/core/status/feed-late.js";
import type { Consumer, Delta, HarnessDelivery } from "../../src/core/types/delivery.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { StateSink } from "../../src/core/types/state.js";
import type { Store } from "../../src/core/types/store.js";
import type { TestFileKeyRecord } from "../../src/core/types/store-records.js";
import { check, FILE, freshStore, result, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * Row 005-93, review 0.1.530 B1 and B5: the late state on every delivery path. Only a tool
 * boundary that is not a Stop says late or caught up; every path that delivers a new failure
 * ends an open late state, and no path that delivers other news loses the caught-up notice
 * it owes. With no test group at `edit`, no late form is said.
 */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const OTHER_FILE: TestFileRef = { project: "", path: "src/b.test.ts" };
const A = check("a");
const B = check("b", OTHER_FILE);
const NONE = { checkpointId: null };
const LATE = /^SQUEAL · results for your edits are late at revision \d+$/m;
const CAUGHT = /^SQUEAL · caught up at revision (\d+)$/m;

let store: Store;
let sink: StateSink;
let delivery: HarnessDelivery;
let revision: number;
let clock: number;

function setUp(root?: string): void {
  store = freshStore();
  sink = createStateSink(store);
  clock = Date.now();
  delivery = createDelivery(store, { status: fixedStatus(), now: () => clock });
  revision = 0;
  liveDaemon(store, WT);
  const row = store.worktrees.get(WT);
  if (root !== undefined && row !== null) store.worktrees.upsert({ ...row, root });
  key(FILE, "k1");
  key(OTHER_FILE, "b1");
  sink.applyResults(WT, 0, [result(A, "pass"), result(B, "pass", { key: "b1" })], NONE);
  store.results.putMany([{ ...result(A, "pass"), durationMs: 1_000 }]);
}

beforeEach(() => setUp());

function key(file: TestFileRef, k: string, pending: TestFileKeyRecord["pending"] = null): void {
  store.testFileKeys.upsertMany([{ worktreeId: WT, testFile: file, key: k, revision, pending }]);
}

function edit(paths: readonly string[], refined = true): void {
  revision = store.revisions.append({
    worktreeId: WT,
    createdAt: clock,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: paths.map((path) => ({ path, oldHash: null, newHash: `h-${path}-${revision}` })),
  }).number;
  if (refined) recordRefinedApplied(store, WT, revision);
}

function editA(): void {
  edit(["src/a.ts"]);
  key(FILE, `k${revision + 1}`, "queued");
  recordRekeyed(store, WT, [{ id: testFileId(FILE), open: revision, moved: revision }], []);
}

function finishA(): void {
  key(FILE, `k${revision + 1}`);
  sink.applyResults(WT, revision, [result(A, "pass", { key: `k${revision + 1}` })], NONE);
  recordRekeyed(store, WT, [{ id: testFileId(FILE), open: null, moved: null }], []);
}

/** B fails anew at its unchanged key: a new failure, news that delivers on any path. */
const failB = () => sink.applyResults(WT, revision, [result(B, "fail", { key: "b1" })], NONE);
const passB = () => sink.applyResults(WT, revision, [result(B, "pass", { key: "b1" })], NONE);

const text = (delta: Delta | null) => (delta === null ? null : formatDelta(delta));
const boundary = async (stop = false) => text(await delivery.onToolBoundary(C1, { stop }));
const lateOpen = () => (store.meta.get(lateMetaKey(WT)) ?? "{}") !== "{}";

/** Registered, edited A, the first-edit line spent, and the late notice said. */
async function late(): Promise<void> {
  await delivery.register(C1);
  editA();
  expect(await boundary()).toContain("Squeal saw your edit");
  clock += 61_000;
  expect(await boundary()).toMatch(LATE);
  expect(lateOpen()).toBe(true);
}

describe("a new failure ends the late state on every path (review 0.1.530 B1)", () => {
  it("at Stop: no caught-up follows once the owed file ran", async () => {
    await late();
    failB();
    const stop = await boundary(true);
    expect(stop).toContain("FAIL");
    expect(stop).not.toMatch(LATE);
    expect(lateOpen()).toBe(false);
    finishA();
    expect((await boundary()) ?? "").not.toMatch(CAUGHT);
  });

  it("by peek", async () => {
    await late();
    failB();
    expect((await delivery.peek(C1, { kinds: ["pass-to-fail"] }))?.entries).toHaveLength(1);
    expect(lateOpen()).toBe(false);
    finishA();
    expect((await boundary()) ?? "").not.toMatch(CAUGHT);
  });

  it("at a boundary while the latest revision is not refined", async () => {
    await late();
    edit(["src/c.ts"], false);
    failB();
    expect(await boundary()).toContain("FAIL");
    expect(lateOpen()).toBe(false);
    recordRefinedApplied(store, WT, revision);
    finishA();
    expect((await boundary()) ?? "").not.toMatch(CAUGHT);
  });

  it("when the turn starts (UserPromptSubmit)", async () => {
    await late();
    failB();
    expect(text(await delivery.startTurn(C1))).toContain("FAIL");
    expect(lateOpen()).toBe(false);
    finishA();
    expect((await boundary()) ?? "").not.toMatch(CAUGHT);
  });

  it("from the idle waiter", async () => {
    await late();
    await delivery.endTurn(C1);
    key(FILE, `k${revision + 1}`);
    sink.applyResults(WT, revision, [result(A, "fail", { key: `k${revision + 1}` })], NONE);
    recordRekeyed(store, WT, [{ id: testFileId(FILE), open: null, moved: null }], []);
    const woke = await delivery.waitForDelta(C1, { timeoutMs: 0 });
    expect(text(woke)).toContain("FAIL");
    expect(text(woke)).not.toMatch(CAUGHT);
    expect(lateOpen()).toBe(false);
    expect((await boundary()) ?? "").not.toMatch(CAUGHT);
  });
});

describe("other news keeps the caught-up notice owed (review 0.1.530 B1)", () => {
  it("a recovery at Stop after the owed file ran: the next boundary says caught up", async () => {
    failB();
    await late();
    expect(await boundary()).toBeNull();
    finishA();
    passB();
    const stop = await boundary(true);
    expect(stop).toContain("FAIL -> PASS");
    expect(stop).not.toMatch(CAUGHT);
    expect(lateOpen()).toBe(true);
    expect(await boundary()).toMatch(CAUGHT);
    expect(lateOpen()).toBe(false);
  });

  it("a recovery by peek or the turn start keeps it too", async () => {
    failB();
    await late();
    finishA();
    passB();
    expect(text(await delivery.startTurn(C1))).not.toMatch(CAUGHT);
    expect(await boundary()).toMatch(CAUGHT);
  });

  it("closes a late state with nothing to count once its revision affects no file", async () => {
    await delivery.register(C1);
    recordRefinedApplied(store, WT, 0);
    edit(["README.md"], false);
    clock += 61_000;
    expect(await boundary()).toMatch(LATE);
    recordRefinedApplied(store, WT, revision);
    expect(await boundary()).toBeNull();
    expect(lateOpen()).toBe(false);
    editA();
    expect(await boundary()).toContain("Squeal saw your edit");
    clock += 61_000;
    expect(await boundary()).toMatch(LATE);
  });
});

describe("no late form with no test group at edit (review 0.1.530 B5)", () => {
  function quietPolicy(): void {
    const root = mkdtempSync(join(tmpdir(), "squeal-late-quiet-"));
    writeFileSync(
      join(root, "squeal.config.json"),
      JSON.stringify({
        checks: [{ name: "unit", runner: "vitest", tests: ["src/**"], at: "stop" }],
      }),
    );
    setUp(root);
  }

  it("says no unlisted late notice", async () => {
    quietPolicy();
    await delivery.register(C1);
    recordRefinedApplied(store, WT, 0);
    edit(["src/a.ts"], false);
    clock += 61_000;
    expect((await boundary()) ?? "").not.toMatch(LATE);
  });

  it("says no unread late notice", async () => {
    quietPolicy();
    await delivery.register(C1);
    editA();
    await boundary();
    store.meta.set(feedDeliveredMetaKey(WT), String(clock - FEED_LATE_MS - 1_000));
    expect((await boundary()) ?? "").not.toMatch(LATE);
  });
});
