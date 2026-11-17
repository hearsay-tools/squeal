import { beforeEach, describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { feedDeliveredMetaKey } from "../../src/core/presence/stored.js";
import { recordRefinedApplied } from "../../src/core/scheduler/refined.js";
import { recordRekeyed } from "../../src/core/scheduler/rekeyed-record.js";
import { FEED_LATE_MS } from "../../src/core/status/feed-late.js";
import { FILE, result, WT } from "../state/helpers.js";
import {
  A,
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
  text,
  tick,
} from "./late-fixture.js";

/*
 * Row 005-97, review 0.1.530 B1 and B5: the late state on every delivery path. Only a tool
 * boundary that is not a Stop says late or caught up; every path that delivers a new failure
 * ends an open late state, and no path that delivers other news loses the caught-up notice
 * it owes. With no test group at `edit`, no late form is said.
 */

beforeEach(() => setUp());

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

  it("a recovery by peek keeps it", async () => {
    failB();
    await late();
    finishA();
    passB();
    expect((await delivery.peek(C1, { kinds: ["fail-to-pass"] }))?.entries).toHaveLength(1);
    expect(lateOpen()).toBe(true);
    expect(await boundary()).toMatch(CAUGHT);
  });

  it("a recovery from the idle waiter keeps it", async () => {
    sink.applyResults(WT, 0, [result(A, "fail")], NONE);
    await late();
    await delivery.endTurn(C1);
    finishA();
    const woke = text(await delivery.waitForDelta(C1, { timeoutMs: 0 }));
    expect(woke).toContain("FAIL -> PASS");
    expect(woke).not.toMatch(CAUGHT);
    expect(lateOpen()).toBe(true);
    expect(await boundary()).toMatch(CAUGHT);
  });

  it("a Stop that waited for another revision delivers nothing and changes nothing", async () => {
    await late();
    failB();
    expect(await delivery.onToolBoundary(C1, { stop: true, atRevision: revision + 1 })).toBeNull();
    expect(lateOpen()).toBe(true);
  });

  it("the end of a turn leaves the late state as it was", async () => {
    await late();
    await delivery.endTurn(C1);
    expect(lateOpen()).toBe(true);
    finishA();
    expect(await boundary()).toMatch(CAUGHT);
  });

  it("caught up is said with the daemon down: the results it names are stored", async () => {
    await late();
    store.worktrees.setDaemon(WT, null);
    finishA();
    // The liveness change titles the delivery; the caught-up line rides in it, once.
    const said = await boundary();
    expect(said).toMatch(/^SQUEAL · no daemon is validating/);
    expect(said).toContain(
      "The 1 test file your edits affect has run at revision 1, with no new failure.",
    );
    expect(lateOpen()).toBe(false);
  });

  it("a session that leaves forgets its late state; registered again, it owes no caught up", async () => {
    await late();
    await delivery.unregister(C1);
    expect(lateOpen()).toBe(false);
    await delivery.register(C1);
    finishA();
    expect((await boundary()) ?? "").not.toMatch(CAUGHT);
  });

  it("closes a late state with nothing to count once its revision affects no file", async () => {
    await delivery.register(C1);
    recordRefinedApplied(store, WT, 0);
    edit(["README.md"], false);
    tick(61_000);
    expect(await boundary()).toMatch(LATE);
    recordRefinedApplied(store, WT, revision);
    expect(await boundary()).toBeNull();
    expect(lateOpen()).toBe(false);
    editA();
    expect(await boundary()).toContain("Squeal saw your edit");
    tick(61_000);
    expect(await boundary()).toMatch(LATE);
  });
});

describe("no late form with no test group at edit (review 0.1.530 B5)", () => {
  it("says no unlisted late notice", async () => {
    quietPolicy();
    await delivery.register(C1);
    recordRefinedApplied(store, WT, 0);
    edit(["src/a.ts"], false);
    tick(61_000);
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

describe("a registration of a still-registered consumer, as a resumed session's (review 0.1.538 B1)", () => {
  it("ends the late state when it reports a new failure: no caught-up follows", async () => {
    await late();
    failB();
    const registration = await delivery.register(C1, { atStart: true });
    expect(registration.knownFailures.map((f) => f.check.testPath)).toEqual(["src/b.test.ts"]);
    expect(lateOpen()).toBe(false);
    finishA();
    expect((await boundary()) ?? "").not.toMatch(CAUGHT);
  });

  it("keeps the late state with no new failure: caught up is said", async () => {
    await late();
    await delivery.register(C1, { atStart: true });
    expect(lateOpen()).toBe(true);
    finishA();
    passB();
    expect(await boundary()).toMatch(CAUGHT);
  });

  it("keeps the late state for a failure the consumer was told before the late notice", async () => {
    await delivery.register(C1);
    failB();
    expect(await boundary()).toContain("FAIL");
    editA();
    expect(await boundary()).toContain("Squeal saw your edit");
    tick(61_000);
    expect(await boundary()).toMatch(LATE);
    await delivery.register(C1, { atStart: true });
    expect(lateOpen()).toBe(true);
    // B still fails, as the consumer knows: an unchanged known failure ends no late state.
    finishA();
    expect(await boundary()).toMatch(CAUGHT);
  });
});
