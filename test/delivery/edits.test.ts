import { beforeEach, describe, expect, it, vi } from "vitest";
import { editKeysMetaKey } from "../../src/core/delivery/edits.js";
import { createDelivery, formatDelta } from "../../src/core/delivery/index.js";
import { createStateSink } from "../../src/core/state/index.js";
import {
  type Consumer,
  type HarnessDelivery,
  refinedMetaKey,
  type StateSink,
  type Store,
  type TestFileKeyRecord,
  type TestFileRef,
} from "../../src/core/types/index.js";
import { check, FILE, freshStore, result, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * Tasks 001-223 and 001-224 (spec 005 D6, proposals a and c): the first
 * delivery after a consumer's first edit says Squeal saw it and how many test
 * files it queued, once; once every test file its edits re-keyed is no
 * longer pending, the next delivery says so, once.
 */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const OTHER_FILE: TestFileRef = { project: "", path: "src/b.test.ts" };
const BACKLOG: TestFileRef = { project: "", path: "src/c.test.ts" };
const A = check("a");
const B = check("b", OTHER_FILE);
const NONE = { checkpointId: null };
const SAW = /Squeal saw your edit and queued (\d+) test files?; results arrive/;
const SETTLED = /your edits since revision \d+ re-keyed (is|are) current\./;

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
  key(FILE, "k1");
  key(OTHER_FILE, "b1");
  key(BACKLOG, "c1", "queued");
  sink.applyResults(WT, 0, [result(A, "pass"), result(B, "pass", { key: "b1" })], NONE);
});

/** `file`'s row as the scheduler writes it at the current revision. */
function key(file: TestFileRef, k: string, pending: TestFileKeyRecord["pending"] = null): void {
  store.testFileKeys.upsertMany([{ worktreeId: WT, testFile: file, key: k, revision, pending }]);
}

/** A watched revision changing `paths`; the runner part is applied unless `refinedTo` says. */
function edit(paths: readonly string[], refinedTo = Number.NaN): void {
  revision = store.revisions.append({
    worktreeId: WT,
    createdAt: 1,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: paths.map((path) => ({ path, oldHash: null, newHash: `h-${path}-${revision}` })),
  }).number;
  store.meta.set(refinedMetaKey(WT), String(Number.isNaN(refinedTo) ? revision : refinedTo));
}

/** The consumer's edit of `src/a.ts` re-keys `FILE` and queues it. */
function editA(): void {
  edit(["src/a.ts"]);
  key(FILE, `k${revision + 1}`, "queued");
}

/** `FILE`'s result at its current key lands. */
function finishA(): void {
  key(FILE, `k${revision + 1}`);
  sink.applyResults(WT, revision, [result(A, "pass", { key: `k${revision + 1}` })], NONE);
}

/** Another check fails anew at its unchanged key: news that delivers anyway. */
function otherNews(message: string): void {
  sink.applyResults(WT, revision, [result(B, "fail", { key: "b1", message })], NONE);
}

async function text(stop = false): Promise<string | null> {
  const delta = await delivery.onToolBoundary(C1, { stop });
  return delta === null ? null : formatDelta(delta);
}

describe("the first delivery after the consumer's first edit (task 001-224)", () => {
  it("says once that Squeal saw it and how many test files it queued", async () => {
    await delivery.register(C1);
    editA();
    const said = await text();
    expect(said).toMatch(/^SQUEAL · revision 1\nRevision 1 \(changed src\/a\.ts\)/);
    expect(said).toContain(
      "Squeal saw your edit and queued 1 test file; results arrive with later tool calls, and passing ones stay silent.",
    );
    expect(await text()).toBeNull();
    editA();
    otherNews("b2");
    expect(await text()).not.toMatch(SAW);
  });

  it("says nothing to a consumer that never edits", async () => {
    await delivery.register(C1);
    expect(await text()).toBeNull();
    otherNews("b2");
    expect(await text()).not.toMatch(SAW);
  });

  it("counts only the files whose key the edits moved, not a backlog file queued before", async () => {
    await delivery.register(C1);
    edit(["src/a.ts", "src/b.ts"]);
    key(FILE, "k9", "queued");
    key(OTHER_FILE, "b9", "running");
    key(BACKLOG, "c1", "running");
    expect((await text())?.match(SAW)?.[1]).toBe("2");
  });

  it("counts a test file the consumer added, not one first listed", async () => {
    await delivery.register(C1);
    edit(["src/new.test.ts"]);
    key({ project: "", path: "src/new.test.ts" }, "n1", "queued");
    key({ project: "", path: "src/listed.test.ts" }, "l1", "queued");
    expect((await text())?.match(SAW)?.[1]).toBe("1");
  });

  it("waits for an edit that queues a test file", async () => {
    await delivery.register(C1);
    edit(["README.md"]);
    expect(await text()).toBeNull();
    editA();
    expect((await text())?.match(SAW)?.[1]).toBe("1");
  });

  it("waits for the runner part of the edit's revision", async () => {
    await delivery.register(C1);
    edit(["src/a.ts"], 0);
    expect(await text()).toBeNull();
    store.meta.set(refinedMetaKey(WT), String(revision));
    key(FILE, "k9", "queued");
    expect(await text()).toMatch(SAW);
  });

  it("never delivers on its own at a Stop, and rides on a Stop's other news", async () => {
    await delivery.register(C1);
    editA();
    expect(await text(true)).toBeNull();
    otherNews("b2");
    expect(await text(true)).toMatch(SAW);
    expect(await text()).toBeNull();
  });

  it("is said when the turn starts, as at a tool boundary", async () => {
    await delivery.register(C1);
    editA();
    const delta = await delivery.startTurn(C1);
    expect(delta?.sawEdit).toEqual({ queued: 1 });
  });
});

describe("once the consumer's edits are settled (task 001-223)", () => {
  async function sawEdit(): Promise<void> {
    await delivery.register(C1);
    editA();
    expect(await text()).toMatch(SAW);
  }

  it("says nothing while a file the edits re-keyed is pending", async () => {
    await sawEdit();
    otherNews("b2");
    expect(await text()).not.toMatch(SETTLED);
  });

  it("says so on the next delivery once every one is current, then never again", async () => {
    await sawEdit();
    finishA();
    expect(await text()).toBeNull();
    otherNews("b2");
    expect(await text()).toContain(
      "The test file your edits since revision 0 re-keyed is current.",
    );
    otherNews("b3");
    expect(await text()).not.toMatch(SETTLED);
  });

  it("is not held by a backlog file whose key the edits did not move", async () => {
    await sawEdit();
    key(BACKLOG, "c1", "running");
    finishA();
    otherNews("b2");
    expect(await text()).toMatch(SETTLED);
  });

  it("says it again for later edits, counted from the last time", async () => {
    await sawEdit();
    finishA();
    otherNews("b2");
    expect(await text()).toMatch(SETTLED);
    const settledAt = revision;
    editA();
    otherNews("b3");
    expect(await text()).not.toMatch(SETTLED);
    finishA();
    otherNews("b4");
    expect(await text()).toContain(`your edits since revision ${settledAt} re-keyed is current.`);
  });

  it("names the files that ended with no result", async () => {
    await sawEdit();
    key(FILE, `k${revision + 1}`);
    sink.markUnknown(WT, revision, [FILE], "runner crashed");
    otherNews("b2");
    expect(await text()).toContain(
      "The test file your edits since revision 0 re-keyed finished: 0 current, 1 with no result (unknown).",
    );
  });

  it("can be said in the same delivery as the first edit's line", async () => {
    await delivery.register(C1);
    edit(["src/a.ts"]);
    finishA();
    const said = await text();
    expect(said).toMatch(SAW);
    expect(said).toMatch(SETTLED);
  });
});

describe("the consumer's key snapshot", () => {
  it("is written once per registration and once per settled line, never per delivery", async () => {
    const set = vi.spyOn(store.meta, "set");
    const writes = () => set.mock.calls.filter(([k]) => k === editKeysMetaKey(C1)).length;
    await delivery.register(C1);
    expect(writes()).toBe(1);
    editA();
    await text();
    otherNews("b2");
    await text();
    expect(writes()).toBe(1);
    finishA();
    otherNews("b3");
    await text();
    expect(writes()).toBe(2);
    await delivery.register(C1);
    expect(writes()).toBe(2);
  });

  it("is a map from test file to a short key", async () => {
    await delivery.register(C1);
    const snapshot = JSON.parse(store.meta.get(editKeysMetaKey(C1)) ?? "null");
    expect(Object.values(snapshot)).toEqual(["k1", "b1", "c1"]);
  });

  it("is deleted when the consumer unregisters", async () => {
    await delivery.register(C1);
    await delivery.unregister(C1);
    expect(store.meta.get(editKeysMetaKey(C1))).toBeNull();
  });
});
