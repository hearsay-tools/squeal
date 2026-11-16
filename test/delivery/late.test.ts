import { beforeEach, describe, expect, it } from "vitest";
import { createDelivery } from "../../src/core/delivery/delivery.js";
import { formatDelta } from "../../src/core/delivery/format.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { feedDeliveredMetaKey } from "../../src/core/presence/stored.js";
import { editTimingsMetaKey } from "../../src/core/scheduler/edit-timings.js";
import { recordRefinedApplied } from "../../src/core/scheduler/refined.js";
import { recordRekeyed } from "../../src/core/scheduler/rekeyed-record.js";
import { createStateSink } from "../../src/core/state/sink.js";
import { FEED_LATE_MS } from "../../src/core/status/feed-late.js";
import type { Consumer, HarnessDelivery } from "../../src/core/types/delivery.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { StateSink } from "../../src/core/types/state.js";
import type { Store } from "../../src/core/types/store.js";
import type { TestFileKeyRecord } from "../../src/core/types/store-records.js";
import { check, FILE, freshStore, result, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * Row 005-93, parts 2 and 3 (design sections 2 and 4): passing results stay silent; the agent
 * hears once when the results for its own edits are late, and once when Squeal has caught up
 * after that, naming the revision. The bound here is the files' durations alone (no stored
 * run): `src/a.test.ts` last took 1 s, so its results are late after 2 × 1 s.
 */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const OTHER_FILE: TestFileRef = { project: "", path: "src/b.test.ts" };
const A = check("a");
const B = check("b", OTHER_FILE);
const NONE = { checkpointId: null };
const LATE = /^SQUEAL · results for your edits are late at revision (\d+)$/m;
const CAUGHT = /^SQUEAL · caught up at revision (\d+)$/m;

let store: Store;
let sink: StateSink;
let delivery: HarnessDelivery;
let revision: number;
let clock: number;

beforeEach(() => {
  store = freshStore();
  sink = createStateSink(store);
  clock = Date.now();
  delivery = createDelivery(store, { status: fixedStatus(), now: () => clock });
  revision = 0;
  liveDaemon(store, WT);
  key(FILE, "k1");
  key(OTHER_FILE, "b1");
  sink.applyResults(WT, 0, [result(A, "pass"), result(B, "pass", { key: "b1" })], NONE);
  store.results.putMany([{ ...result(A, "pass"), durationMs: 1_000 }]);
});

function key(file: TestFileRef, k: string, pending: TestFileKeyRecord["pending"] = null): void {
  store.testFileKeys.upsertMany([{ worktreeId: WT, testFile: file, key: k, revision, pending }]);
}

/** A watched revision at the clock's time; its runner part applied unless `refined` is false. */
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

/** The consumer's edit of `src/a.ts` re-keys `FILE` and queues it. */
function editA(): void {
  edit(["src/a.ts"]);
  key(FILE, `k${revision + 1}`, "queued");
  recordRekeyed(store, WT, [{ id: testFileId(FILE), open: revision, moved: revision }], []);
}

/** `FILE`'s result at its current key lands: `outcome`, a pass by default. */
function finishA(outcome: "pass" | "fail" = "pass"): void {
  key(FILE, `k${revision + 1}`);
  sink.applyResults(WT, revision, [result(A, outcome, { key: `k${revision + 1}` })], NONE);
  recordRekeyed(store, WT, [{ id: testFileId(FILE), open: null, moved: null }], []);
}

async function text(stop = false): Promise<string | null> {
  const delta = await delivery.onToolBoundary(C1, { stop });
  return delta === null ? null : formatDelta(delta);
}

/** Registers, edits `src/a.ts` and spends the 001-224 line at once. */
async function edited(): Promise<void> {
  await delivery.register(C1);
  editA();
  expect(await text()).toContain("Squeal saw your edit");
}

describe("late, once (row 005-93, part 2)", () => {
  it("sends nothing while results come in normal time, then one late message past the bound", async () => {
    await edited();
    clock += 5;
    expect(await text()).toBeNull();
    clock += 2_125;
    const said = await text();
    expect(said).toMatch(LATE);
    expect(said?.match(LATE)?.[1]).toBe(String(revision));
    expect(said).toContain(
      "The 1 test file your edits affect has not run, 2 s after your edit at revision 1. " +
        "Passing results stay silent; Squeal says once when it has caught up. To have it now, " +
        "`squeal status --wait 60000 src/a.test.ts` runs it first; or run it yourself.",
    );
    clock += 60_000;
    expect(await text()).toBeNull();
  });

  it("counts the owed files of several, and names none past three", async () => {
    await delivery.register(C1);
    const files = ["c", "d", "e", "f"].map((n) => ({ project: "", path: `src/${n}.test.ts` }));
    edit(["src/a.ts"]);
    for (const f of [FILE, ...files]) key(f, `k-${f.path}`, "queued");
    recordRekeyed(
      store,
      WT,
      [FILE, ...files].map((f) => ({ id: testFileId(f), open: revision, moved: revision })),
      [],
    );
    key(FILE, `k-${FILE.path}`);
    recordRekeyed(store, WT, [{ id: testFileId(FILE), open: null, moved: null }], []);
    expect(await text()).toContain("Squeal saw your edit");
    clock += 130_000;
    const said = await text();
    expect(said).toContain(
      "4 of the 5 test files your edits affect have not run, 2 min 10 s after your edit at revision 1.",
    );
    expect(said).toContain(
      "To have them now, `squeal status --wait 60000 <path>...` runs the files your paths select first; or run those files yourself.",
    );
  });

  it("sends no late message without owed files", async () => {
    await edited();
    finishA();
    clock += 60_000;
    expect(await text()).toBeNull();
  });

  it("is never said at Stop, and waits for the next tool boundary", async () => {
    await edited();
    clock += 60_000;
    expect(await text(true)).toBeNull();
    expect(await text()).toMatch(LATE);
  });

  it("is not said while the daemon is down: its own liveness message stands", async () => {
    await edited();
    store.worktrees.setDaemon(WT, null);
    clock += 60_000;
    expect((await text()) ?? "").not.toMatch(LATE);
    expect(await text()).toBeNull();
  });

  it("reads the start delay the scheduler recorded for this worktree's edit revisions", async () => {
    // An edit tier started 10 s after its revision: the bound is 2 × (10 s + the files).
    store.meta.set(
      editTimingsMetaKey(WT),
      JSON.stringify({
        tierSize: 4,
        widths: {},
        firsts: [{ revision: 0, delayMs: 10_000 }],
        tiers: [],
      }),
    );
    await edited();
    clock += 15_000;
    expect(await text()).toBeNull();
    clock += 10_000;
    expect(await text()).toMatch(LATE);
  });

  it("says that the runner has not listed the edit's revision, once, after the feed's late time", async () => {
    await delivery.register(C1);
    recordRefinedApplied(store, WT, 0);
    edit(["src/a.ts"], false);
    clock += 30_000;
    expect(await text()).toBeNull();
    clock += 31_000;
    const said = await text();
    expect(said).toMatch(LATE);
    expect(said).toContain(
      "not yet listed the test files of revision 1, so Squeal has not queued them. To have results now, run the tests yourself; `squeal status` says when they are listed.",
    );
    expect(await text()).toBeNull();
  });
  it("says once that Squeal has not read edits after the feed's late time, after an edit", async () => {
    await edited();
    const since = clock - FEED_LATE_MS - 1_000;
    store.meta.set(feedDeliveredMetaKey(WT), String(since));
    const said = await text();
    expect(said).toMatch(LATE);
    expect(said).toContain(
      `Squeal has not read edits made after ${new Date(since).toISOString().slice(11, 19)} UTC, so it has not queued their test files. To have results now, run the tests yourself; \`squeal status\` says when Squeal reads them again.`,
    );
    // The late message says the late-feed sentence: the header does not, while files are owed.
    expect(said).not.toContain("Squeal has not yet read edits");
    expect(await text()).toBeNull();
  });
});

describe("caught up, once (row 005-93, part 3)", () => {
  it("follows a late message once every owed file ran, naming the revision", async () => {
    await edited();
    clock += 60_000;
    expect(await text()).toMatch(LATE);
    finishA();
    const said = await text();
    expect(said?.match(CAUGHT)?.[1]).toBe(String(revision));
    expect(said).toContain(
      "The 1 test file your edits affect has run at revision 1, with no new failure.",
    );
    expect(await text()).toBeNull();
  });

  it("is never said without a late message before it", async () => {
    await edited();
    finishA();
    expect(await text()).toBeNull();
    clock += 60_000;
    expect(await text()).toBeNull();
  });

  it("counts the files that gave no result", async () => {
    await edited();
    clock += 60_000;
    expect(await text()).toMatch(LATE);
    key(FILE, `k${revision + 1}`);
    sink.markUnknown(WT, revision, [FILE], "worker crashed");
    recordRekeyed(store, WT, [{ id: testFileId(FILE), open: null, moved: null }], []);
    const said = await text();
    expect(said).toContain(
      "The 1 test file your edits affect has run at revision 1: 0 with results, 1 with no result (unknown); no new failure.",
    );
  });

  it("is not said when a failure arrived during the delay: the failure report ends the late state", async () => {
    await edited();
    clock += 60_000;
    expect(await text()).toMatch(LATE);
    finishA("fail");
    const said = await text();
    expect(said).toContain("FAIL");
    expect(said).not.toMatch(CAUGHT);
    expect(await text()).toBeNull();
  });

  it("does not claim an edit whose revision is not refined yet (design section 2)", async () => {
    await edited();
    clock += 60_000;
    expect(await text()).toMatch(LATE);
    finishA();
    edit(["src/same-call.ts"], false);
    expect(await text()).toBeNull();
    recordRefinedApplied(store, WT, revision);
    const said = await text();
    expect(said?.match(CAUGHT)?.[1]).toBe(String(revision));
  });

  it("allows one late message per late state: a later late state is said again", async () => {
    await edited();
    clock += 60_000;
    expect(await text()).toMatch(LATE);
    finishA();
    expect(await text()).toMatch(CAUGHT);
    editA();
    clock += 60_000;
    expect(await text()).toMatch(LATE);
  });
});
