import { beforeEach, describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { feedDeliveredMetaKey } from "../../src/core/presence/stored.js";
import { editTimingsMetaKey } from "../../src/core/scheduler/edit-timings.js";
import { recordRefinedApplied } from "../../src/core/scheduler/refined.js";
import { recordRekeyed } from "../../src/core/scheduler/rekeyed-record.js";
import { FEED_LATE_MS } from "../../src/core/status/feed-late.js";
import { FILE, WT } from "../state/helpers.js";
import {
  boundary,
  C1,
  CAUGHT,
  clock,
  delivery,
  edit,
  editA,
  finishA,
  key,
  LATE,
  revision,
  setUp,
  sink,
  store,
  tick,
} from "./late-fixture.js";

/*
 * Row 005-97 (`tasks/005-93/design.md` sections 2 and 4): passes stay silent; the agent
 * hears once when the results for its own edits are late, and once when Squeal has caught up
 * after that, naming the revision. The bound here is the files' durations alone (no stored
 * run): `src/a.test.ts` last took 1 s, so its results are late after 2 × 1 s.
 */

beforeEach(() => setUp());

/** Registers, edits `src/a.ts` and spends the 001-224 line at once. */
async function edited(): Promise<void> {
  await delivery.register(C1);
  editA();
  expect(await boundary()).toContain("Squeal saw your edit");
}

describe("late, once (row 005-97 a)", () => {
  it("sends nothing while results come in normal time, then one late message past the bound", async () => {
    await edited();
    tick(5);
    expect(await boundary()).toBeNull();
    tick(2_125);
    const said = await boundary();
    expect(said).toMatch(LATE);
    expect(said?.match(LATE)?.[1]).toBe(String(revision));
    expect(said).toContain(
      "The 1 test file your edits affect has not run, 2 s after your edit at revision 1. " +
        "Passes stay silent unless they follow a failure; Squeal says once when it has caught up. To have it now, " +
        "`squeal status --wait 60000 src/a.test.ts` runs it first.",
    );
    tick(60_000);
    expect(await boundary()).toBeNull();
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
    expect(await boundary()).toContain("Squeal saw your edit");
    tick(130_000);
    const said = await boundary();
    expect(said).toContain(
      "4 of the 5 test files your edits affect have not run, 2 min 10 s after your edit at revision 1.",
    );
    expect(said).toContain(
      "To have them now, `squeal status --wait 60000 <path>...` runs the files your paths select first.",
    );
  });

  it("sends no late message without owed files", async () => {
    await edited();
    finishA();
    tick(60_000);
    expect(await boundary()).toBeNull();
  });

  it("is never said at Stop, and waits for the next tool boundary", async () => {
    await edited();
    tick(60_000);
    expect(await boundary(true)).toBeNull();
    expect(await boundary()).toMatch(LATE);
  });

  it("is not said while the daemon is down: its own liveness message stands", async () => {
    await edited();
    store.worktrees.setDaemon(WT, null);
    tick(60_000);
    expect((await boundary()) ?? "").not.toMatch(LATE);
    expect(await boundary()).toBeNull();
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
    tick(15_000);
    expect(await boundary()).toBeNull();
    tick(10_000);
    expect(await boundary()).toMatch(LATE);
  });

  it("says that the runner has not listed the edit's revision, once, after the feed's late time", async () => {
    await delivery.register(C1);
    recordRefinedApplied(store, WT, 0);
    edit(["src/a.ts"], false);
    tick(30_000);
    expect(await boundary()).toBeNull();
    tick(31_000);
    const said = await boundary();
    expect(said).toMatch(LATE);
    expect(said).toContain(
      "not yet listed the test files of revision 1, so Squeal has not queued them. " +
        "`squeal status --wait 60000 <path>...` waits until they are listed, then for the files your paths select.",
    );
    // Row 005-114: the late line says the delay; the header does not say it again.
    expect(said).not.toContain("so new test files are not counted");
    expect(said).not.toContain("yourself");
    expect(await boundary()).toBeNull();
  });
  it("says once that Squeal has not read edits after the feed's late time, after an edit", async () => {
    await edited();
    const since = clock - FEED_LATE_MS - 1_000;
    store.meta.set(feedDeliveredMetaKey(WT), String(since));
    const said = await boundary();
    expect(said).toMatch(LATE);
    expect(said).toContain(
      `Squeal has not read edits made after ${new Date(since).toISOString().slice(11, 19)} UTC, so it has not queued their test files. \`squeal status --wait 60000 <path>...\` asks it to read them and waits for the files your paths select.`,
    );
    expect(said).not.toContain("yourself");
    // The late message says the late-feed sentence: the header does not, while files are owed.
    expect(said).not.toContain("Squeal has not yet read edits");
    expect(await boundary()).toBeNull();
  });

  it("says the unread delay once with no owed file: the header leaves it to the late line (row 005-114)", async () => {
    await edited();
    finishA();
    const since = clock - FEED_LATE_MS - 1_000;
    store.meta.set(feedDeliveredMetaKey(WT), String(since));
    const said = await boundary();
    expect(said).toMatch(LATE);
    expect(said).toContain("so it has not queued their test files.");
    expect(said).not.toContain("Squeal has not yet read edits");
    expect(said?.match(/status --wait 60000 <path>\.\.\./g)).toHaveLength(1);
    expect(said).not.toContain("yourself");
  });
});

describe("caught up, once (row 005-97 b)", () => {
  it("follows a late message once every owed file ran, naming the revision", async () => {
    await edited();
    tick(60_000);
    expect(await boundary()).toMatch(LATE);
    finishA();
    const said = await boundary();
    expect(said?.match(CAUGHT)?.[1]).toBe(String(revision));
    expect(said).toContain(
      "The 1 test file your edits affect has run at revision 1, with no new failure.",
    );
    expect(await boundary()).toBeNull();
  });

  it("is never said without a late message before it", async () => {
    await edited();
    finishA();
    expect(await boundary()).toBeNull();
    tick(60_000);
    expect(await boundary()).toBeNull();
  });

  it("counts the files that gave no result", async () => {
    await edited();
    tick(60_000);
    expect(await boundary()).toMatch(LATE);
    key(FILE, `k${revision + 1}`);
    sink.markUnknown(WT, revision, [FILE], "worker crashed");
    recordRekeyed(store, WT, [{ id: testFileId(FILE), open: null, moved: null }], []);
    const said = await boundary();
    expect(said).toContain(
      "The 1 test file your edits affect has run at revision 1: 0 with results, 1 with no result (unknown); no new failure.",
    );
  });

  it("is not said when a failure arrived during the delay: the failure report ends the late state", async () => {
    await edited();
    tick(60_000);
    expect(await boundary()).toMatch(LATE);
    finishA("fail");
    const said = await boundary();
    expect(said).toContain("FAIL");
    expect(said).not.toMatch(CAUGHT);
    expect(await boundary()).toBeNull();
  });

  it("does not claim an edit whose revision is not refined yet (design section 2)", async () => {
    await edited();
    tick(60_000);
    expect(await boundary()).toMatch(LATE);
    finishA();
    edit(["src/same-call.ts"], false);
    expect(await boundary()).toBeNull();
    recordRefinedApplied(store, WT, revision);
    const said = await boundary();
    expect(said?.match(CAUGHT)?.[1]).toBe(String(revision));
  });

  it("allows one late message per late state: a later late state is said again", async () => {
    await edited();
    tick(60_000);
    expect(await boundary()).toMatch(LATE);
    finishA();
    expect(await boundary()).toMatch(CAUGHT);
    editA();
    tick(60_000);
    expect(await boundary()).toMatch(LATE);
  });
});
