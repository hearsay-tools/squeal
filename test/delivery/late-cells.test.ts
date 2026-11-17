import { beforeEach, describe, expect, it } from "vitest";
import { drop } from "../../src/core/delivery/expiry.js";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { feedDeliveredMetaKey } from "../../src/core/presence/stored.js";
import { editTimingsMetaKey } from "../../src/core/scheduler/edit-timings.js";
import { addCommandHold } from "../../src/core/scheduler/hold-rows.js";
import { recordRekeyed } from "../../src/core/scheduler/rekeyed-record.js";
import { FEED_LATE_MS } from "../../src/core/status/feed-late.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { check, result, WT } from "../state/helpers.js";
import {
  boundary,
  C1,
  CAUGHT,
  clock,
  delivery,
  edit,
  editA,
  failB,
  finishA,
  key,
  LATE,
  late,
  lateOpen,
  NONE,
  passB,
  quietPolicy,
  revision,
  setUp,
  sink,
  store,
  tick,
} from "./late-fixture.js";

/*
 * Row 005-97: the cells of the path table in `tasks/005-97/notes.md` that
 * `late.test.ts` and `late-paths.test.ts` leave open: a Stop that waits at the
 * latest revision, a hold, an expiry and a new registration, where the own
 * count starts again (`since`), no test group at `edit` with owed files, a file
 * only a group lane runs (`../011-core/reviews/0.1.535.md` N1), and no second
 * late message for the files a failure's report already covered.
 */

beforeEach(() => setUp());

/** No line of the news header counts the consumer's own files: the count started again. */
const NO_OWN = /your edits affect/;

describe("a Stop, a hold and the registration (path table)", () => {
  it("a Stop that waits at the latest revision says no late either; the next boundary does", async () => {
    await delivery.register(C1);
    editA();
    expect(await boundary()).toContain("Squeal saw your edit");
    tick(61_000);
    expect(await delivery.onToolBoundary(C1, { stop: true, atRevision: revision })).toBeNull();
    expect(lateOpen()).toBe(false);
    expect(await boundary()).toMatch(LATE);
  });

  it("says no late while a hold is on, and says caught up during one", async () => {
    const hold = (token: string) =>
      addCommandHold(store, WT, {
        token,
        since: clock,
        until: clock + 3_600_000,
        command: "pnpm install",
        wrapper: null,
        child: null,
      });
    await delivery.register(C1);
    editA();
    expect(await boundary()).toContain("Squeal saw your edit");
    hold("t1");
    expect(await boundary()).toMatch(/validation on hold/);
    tick(61_000);
    expect((await boundary()) ?? "").not.toMatch(LATE);
    expect(lateOpen()).toBe(false);

    setUp();
    await late();
    hold("t2");
    finishA();
    const said = await boundary();
    expect(said).toContain(
      "The 1 test file your edits affect has run at revision 1, with no new failure.",
    );
    expect(lateOpen()).toBe(false);
  });

  it("an expired consumer forgets its late state; registered again, it owes no caught up", async () => {
    await late();
    store.transaction(() => drop(store, C1, clock));
    expect(lateOpen()).toBe(false);
    await delivery.register(C1);
    finishA();
    expect((await boundary()) ?? "").not.toMatch(CAUGHT);
  });

  it("a registration counts from its revision: an edit before it is never late", async () => {
    editA();
    await delivery.register(C1);
    tick(61_000);
    expect(await boundary()).toBeNull();
    expect(lateOpen()).toBe(false);
  });
});

describe("where the own count starts again (since)", () => {
  it("at caught up: the next news counts no file of the edits before it", async () => {
    await late();
    finishA();
    expect(await boundary()).toMatch(CAUGHT);
    failB();
    const said = await boundary();
    expect(said).toContain("FAIL");
    expect(said).not.toMatch(NO_OWN);
  });

  it("at a failure that ends the late state with every file run", async () => {
    await late();
    finishA();
    failB();
    const failed = await boundary();
    expect(failed).toContain("FAIL");
    expect(failed).not.toMatch(CAUGHT);
    expect(failed).toContain("the 1 test file your edits affect has run.");
    passB();
    const recovered = await boundary();
    expect(recovered).toContain("FAIL -> PASS");
    expect(recovered).not.toMatch(NO_OWN);
  });

  it("not at a failure while files are owed, and their late is not said again", async () => {
    await late();
    failB();
    const failed = await boundary();
    expect(failed).toContain("the 1 test file your edits affect has not run.");
    expect(lateOpen()).toBe(false);
    tick(61_000);
    expect(await boundary()).toBeNull();
    // A later edit's own file can be late again.
    const other: TestFileRef = { project: "", path: "src/c.test.ts" };
    edit(["src/c.ts"]);
    key(other, "c2", "queued");
    recordRekeyed(store, WT, [{ id: testFileId(other), open: revision, moved: revision }], []);
    tick(61_000);
    const again = await boundary();
    expect(again).toMatch(LATE);
    expect(again).toContain("2 test files your edits affect have not run");
    expect(again).toContain("after your edit at revision 2.");
  });
});

describe("no test group at edit (review 0.1.530 B5)", () => {
  it("says no late for owed files, and the header keeps the late-feed sentence", async () => {
    quietPolicy();
    await delivery.register(C1);
    editA();
    expect(await boundary()).toContain("Squeal saw your edit, which affects 1 test file");
    tick(61_000);
    expect(await boundary()).toBeNull();
    store.meta.set(feedDeliveredMetaKey(WT), String(clock - FEED_LATE_MS - 1_000));
    failB();
    const said = await boundary();
    expect(said).toContain("the 1 test file your edits affect has not run.");
    expect(said).toContain("Squeal has not yet read edits made after");
    expect(said).not.toMatch(LATE);
  });
});

describe("a file only a group lane runs (`011-core/reviews/0.1.535.md` N1)", () => {
  it("reads width 1 and no first start: the bound is never shorter than the files' durations", async () => {
    // Group lanes record no timings: only the default lane's project has a width.
    store.meta.set(
      editTimingsMetaKey(WT),
      JSON.stringify({
        tierSize: 4,
        widths: { "": { width: 4, part: "vitest" } },
        firsts: [],
        tiers: [],
      }),
    );
    const files = ["one", "two"].map((n) => ({ project: "e2e", path: `e2e/${n}.test.ts` }));
    for (const f of files) {
      key(f, `${f.path}-1`);
      sink.applyResults(WT, 0, [result(check(f.path, f), "pass", { key: `${f.path}-1` })], NONE);
      store.results.putMany([{ ...result(check(f.path, f), "pass"), durationMs: 1_000 }]);
    }
    await delivery.register(C1);
    edit(["src/a.ts"]);
    for (const f of files) key(f, `${f.path}-2`, "queued");
    recordRekeyed(
      store,
      WT,
      files.map((f) => ({ id: testFileId(f), open: revision, moved: revision })),
      [],
    );
    expect(await boundary()).toContain("Squeal saw your edit");
    // One at a time they take 2 s, so 2 × 2 s; two wide would give 2 × 1.5 s.
    tick(3_500);
    expect(await boundary()).toBeNull();
    tick(600);
    expect(await boundary()).toMatch(LATE);
  });
});
