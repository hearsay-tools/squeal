import { beforeEach, describe, expect, it, vi } from "vitest";
import { editsMetaKey } from "../../src/core/delivery/edits.js";
import { drop } from "../../src/core/delivery/expiry.js";
import { createDelivery, formatDelta } from "../../src/core/delivery/index.js";
import { testFileId } from "../../src/core/keys/index.js";
import { readRekeyed, recordRekeyed } from "../../src/core/scheduler/rekeyed-record.js";
import { createStateSink } from "../../src/core/state/index.js";
import {
  CONSUMER_EXPIRY_MS,
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
const OTHER: Consumer = { worktreeId: WT, sessionId: "s3", agentId: "main" };
const OTHER_FILE: TestFileRef = { project: "", path: "src/b.test.ts" };
const BACKLOG: TestFileRef = { project: "", path: "src/c.test.ts" };
const NEVER_RUN: TestFileRef = { project: "", path: "src/d.test.ts" };
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

/**
 * The scheduler's record that the current revision's change re-keyed `file`
 * (`recordRekeyed`): `open` stays the earliest revision with no result.
 */
function moved(file: TestFileRef, open = revision): void {
  recordRekeyed(store, WT, [{ id: testFileId(file), open, moved: revision }], []);
}

/** The scheduler's record that `file` has its result, or `unknown`, at its key. */
function resolved(file: TestFileRef): void {
  recordRekeyed(store, WT, [{ id: testFileId(file), open: null, moved: null }], []);
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
  moved(FILE);
}

/** `FILE`'s result at its current key lands. */
function finishA(): void {
  key(FILE, `k${revision + 1}`);
  sink.applyResults(WT, revision, [result(A, "pass", { key: `k${revision + 1}` })], NONE);
  resolved(FILE);
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
    moved(FILE);
    moved(OTHER_FILE);
    expect((await text())?.match(SAW)?.[1]).toBe("2");
  });

  it("counts a test file the consumer added, not one first listed", async () => {
    await delivery.register(C1);
    edit(["src/new.test.ts"]);
    key({ project: "", path: "src/new.test.ts" }, "n1", "queued");
    key({ project: "", path: "src/listed.test.ts" }, "l1", "queued");
    moved({ project: "", path: "src/new.test.ts" });
    expect((await text())?.match(SAW)?.[1]).toBe("1");
  });

  it("counts a file first listed after registration once a source edit re-keys it (review wave 13u, B1)", async () => {
    const listed: TestFileRef = { project: "", path: "src/listed.test.ts" };
    await delivery.register(C1);
    key(listed, "l0", "queued");
    edit(["src/listed.ts"]);
    key(listed, "l1", "queued");
    moved(listed);
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
    moved(FILE);
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

  it("is held by a file the edits re-keyed and moved back before its result (review wave 13u, B1)", async () => {
    key(NEVER_RUN, "d0", "queued");
    await delivery.register(C1);
    edit(["src/a.ts", "src/d.ts"]);
    key(FILE, `k${revision + 1}`, "queued");
    key(NEVER_RUN, "d1", "queued");
    moved(FILE);
    moved(NEVER_RUN);
    expect((await text())?.match(SAW)?.[1]).toBe("2");
    const first = revision;
    edit(["src/d.ts"]);
    key(NEVER_RUN, "d0", "queued");
    moved(NEVER_RUN, first);
    finishA();
    otherNews("b2");
    expect(await text()).not.toMatch(SETTLED);
    key(NEVER_RUN, "d0");
    resolved(NEVER_RUN);
    otherNews("b3");
    expect(await text()).toContain(
      "All 2 test files your edits since revision 0 re-keyed are current.",
    );
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
    resolved(FILE);
    otherNews("b2");
    expect(await text()).toContain(
      "The test file your edits since revision 0 re-keyed finished: 0 current, 1 with no result (unknown).",
    );
  });

  it("merges with the first edit's line when both land in one delivery", async () => {
    await delivery.register(C1);
    edit(["src/a.ts"]);
    moved(FILE);
    finishA();
    const said = await text();
    expect(said).toContain(
      "Squeal saw your edit; the 1 test file it re-keyed is current, and passing results stay silent.",
    );
    expect(said).not.toMatch(SAW);
    expect(said).not.toMatch(SETTLED);
    otherNews("b2");
    expect(await text()).not.toMatch(/Squeal saw your edit|re-keyed/);
  });

  it("names the merged line's files with no result", async () => {
    await delivery.register(C1);
    edit(["src/a.ts"]);
    moved(FILE);
    key(FILE, `k${revision + 1}`);
    sink.markUnknown(WT, revision, [FILE], "runner crashed");
    resolved(FILE);
    expect(await text()).toContain(
      "Squeal saw your edit; of the 1 test file it re-keyed, 0 current and 1 with no result (unknown); passing results stay silent.",
    );
  });
});

describe("the consumer's edit state", () => {
  const ALSO: Consumer = { ...C1, sessionId: "s2" };
  const FIRST_LINE = /Squeal saw your edit and queued/;

  async function saidOnce(): Promise<void> {
    await delivery.register(C1);
    editA();
    expect(await text()).toMatch(FIRST_LINE);
  }

  /** The next edit's delivery, with other news so it delivers either way. */
  async function nextEdit(consumer: Consumer = C1): Promise<string | null> {
    editA();
    otherNews(`b${revision}`);
    const delta = await delivery.onToolBoundary(consumer);
    return delta === null ? null : formatDelta(delta);
  }

  it("is written once per registration and per said line, never per quiet delivery", async () => {
    const set = vi.spyOn(store.meta, "set");
    const writes = () => set.mock.calls.filter(([k]) => k === editsMetaKey(WT)).length;
    await delivery.register(C1);
    expect(writes()).toBe(1);
    editA();
    await text();
    expect(writes()).toBe(2);
    otherNews("b2");
    await text();
    expect(writes()).toBe(2);
    await delivery.register(C1);
    expect(writes()).toBe(2);
  });

  it("keeps no key snapshot", async () => {
    await saidOnce();
    expect(Object.keys(JSON.parse(store.meta.get(editsMetaKey(WT)) ?? "{}"))).toHaveLength(1);
    expect(store.meta.get(`edit-keys:${JSON.stringify([WT, "s1", "main"])}`)).toBeNull();
  });

  it("keeps the first edit's line said across unregister and resume (review wave 13u, B2)", async () => {
    await saidOnce();
    await delivery.unregister(C1);
    expect(store.meta.get(editsMetaKey(WT))).toBe("{}");
    await delivery.register(C1);
    expect(await nextEdit()).not.toMatch(FIRST_LINE);
  });

  it("keeps it across a waiterless expiry and resume within the parked lifetime (B2)", async () => {
    await saidOnce();
    store.transaction(() => drop(store, C1, Date.now()));
    expect(store.consumers.get(C1)).toBeNull();
    await delivery.register(C1);
    expect(await nextEdit()).not.toMatch(FIRST_LINE);
  });

  it("says it again once the parked registration is past its lifetime (B2)", async () => {
    let now = 1_000;
    delivery = createDelivery(store, { status: fixedStatus(), now: () => now });
    await saidOnce();
    await delivery.unregister(C1);
    now += CONSUMER_EXPIRY_MS + 1;
    await delivery.register(C1);
    expect(await nextEdit()).toMatch(FIRST_LINE);
  });

  it("gives a new session its own line (B2)", async () => {
    await saidOnce();
    await delivery.unregister(C1);
    await delivery.register(ALSO);
    expect(await nextEdit(ALSO)).toMatch(FIRST_LINE);
  });

  it("drops the legacy key snapshot when the consumer unregisters", async () => {
    const legacy = `edit-keys:${JSON.stringify([WT, "s1", "main"])}`;
    await delivery.register(C1);
    store.meta.set(legacy, "{}");
    await delivery.unregister(C1);
    expect(store.meta.get(legacy)).toBeNull();
  });
});

describe("the scheduler's re-key record, as delivery prunes it", () => {
  it("drops resolved entries every consumer's edits are past, and keeps open ones", async () => {
    await delivery.register(C1);
    editA();
    key(NEVER_RUN, "d1", "queued");
    moved(NEVER_RUN);
    await text();
    finishA();
    key(NEVER_RUN, "d1");
    resolved(NEVER_RUN);
    otherNews("b2");
    expect(await text()).toMatch(SETTLED);
    expect(readRekeyed(store, WT).size).toBe(0);
    editA();
    await delivery.unregister(C1);
    expect([...readRekeyed(store, WT).keys()]).toEqual([testFileId(FILE)]);
  });

  it("keeps a resolved entry another consumer's edits have not settled", async () => {
    await delivery.register(C1);
    await delivery.register(OTHER);
    editA();
    finishA();
    expect(await text()).toMatch(/Squeal saw your edit;/);
    expect([...readRekeyed(store, WT).keys()]).toEqual([testFileId(FILE)]);
    await delivery.unregister(OTHER);
    expect(readRekeyed(store, WT).size).toBe(0);
  });
});
