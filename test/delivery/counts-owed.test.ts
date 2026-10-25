import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countsOwedMetaKey } from "../../src/core/delivery/counts-owed.js";
import { createDelivery, formatDelta, formatRegistration } from "../../src/core/delivery/index.js";
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
import { check, freshStore, OTHER, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * Row 011-205, Cezar session d0412a5f: a session registered before the
 * daemon listed the test files, so its header said the counts were not
 * complete; every later delivery was the news form, which leaves out the
 * current and inherited counts. Its first delivery after the listing carries
 * them once, with the test files without checks and why none is queued.
 */

const INHERITED: TestFileRef = { project: "", path: "src/inherited.test.ts" };
const OWN: TestFileRef = { project: "", path: "src/own.test.ts" };
const NEVER_RUN: TestFileRef = { project: "", path: "src/never-run.test.ts" };
const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const C2: Consumer = { worktreeId: WT, sessionId: "s2", agentId: "main" };
const SHARED = check("shared", INHERITED);
const MINE = check("mine", OWN);
const NOT_LISTED =
  "The daemon has not listed this worktree's test files yet; these counts are not complete.";
const COUNTS =
  "Revision 0: 2 current (2 tests), 0 pending, 0 stale, 0 unknown. Inherited: 1 of 2 current (1 test). " +
  "Test files without checks: 0 pending, 1 unknown; the baseline is lookup-only, so it queued none of them.";

let root: string;
let store: Store;
let sink: StateSink;
let delivery: HarnessDelivery;

function policy(onStart: string): void {
  writeFileSync(join(root, "squeal.config.json"), JSON.stringify({ baseline: { onStart } }));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-011-205-"));
  policy("lookup-only");
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
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function apply(...results: ResultRecord[]): void {
  store.results.putMany(results);
  sink.applyResults(WT, 0, results, { checkpointId: null });
}

/** The listing at revision 0: one file inherits a pass, one passes here, one never ran. */
function list(): void {
  setKey(store, "ki", { file: INHERITED });
  setKey(store, "ko", { file: OWN });
  setKey(store, "kn", { file: NEVER_RUN });
  apply(
    result(SHARED, "pass", { key: "ki", worktreeId: OTHER, revision: 0 }),
    result(MINE, "pass", { key: "ko", revision: 0 }),
  );
}

/** Its own test flips, so the next tool boundary has news. */
let outcome: "pass" | "fail" = "pass";
function flip(): void {
  outcome = outcome === "pass" ? "fail" : "pass";
  apply(result(MINE, outcome, { key: "ko", revision: 0 }));
}

async function boundary(consumer = C1, stop = false): Promise<Delta> {
  const d = await delivery.onToolBoundary(consumer, { stop });
  if (d === null) throw new Error("no delta");
  return d;
}

const headerLine = (d: Delta) => formatDelta(d).split("\n")[1];

beforeEach(() => {
  outcome = "pass";
});

describe("the counts after the listing (row 011-205)", () => {
  it("go once to a consumer registered before the listing, in its first news delivery", async () => {
    const registration = await delivery.register(C1, { atStart: true });
    expect(formatRegistration(registration)).toContain(NOT_LISTED);
    list();
    flip();
    const first = await boundary();
    expect(first.countsOwed).toEqual({ lookupOnly: true });
    expect(headerLine(first)).toBe(COUNTS);
    flip();
    const later = await boundary();
    expect(later.countsOwed).toBeUndefined();
    expect(headerLine(later)).toBe("Revision 0: test files without checks: 1 unknown.");
  });

  it("stay owed while no delivery carried them", async () => {
    await delivery.register(C1, { atStart: true });
    list();
    // The listing alone is no news to deliver.
    expect(await delivery.onToolBoundary(C1)).toBeNull();
    flip();
    expect(headerLine(await boundary())).toBe(COUNTS);
  });

  it("stay owed while the test files are not listed", async () => {
    await delivery.register(C1, { atStart: true });
    flip();
    const unlisted = await boundary();
    expect(unlisted.countsOwed).toBeUndefined();
    expect(headerLine(unlisted)).toContain(NOT_LISTED);
    list();
    flip();
    expect(headerLine(await boundary())).toBe(COUNTS);
  });

  it("are carried by Stop's full header when Stop comes first, and spent by it", async () => {
    await delivery.register(C1, { atStart: true });
    list();
    flip();
    const stop = await boundary(C1, true);
    expect(formatDelta(stop, "squeal", 10_000, "full").split("\n")[1]).toMatch(
      /^Revision 0: 2 current \(2 tests\), .* Test files without checks: 0 pending, 1 unknown; the baseline is lookup-only, so it queued none of them\. Full-suite checkpoint: /,
    );
    flip();
    expect((await boundary()).countsOwed).toBeUndefined();
  });

  it("say nothing of the baseline when it is not lookup-only", async () => {
    policy("lookup-then-run-missing");
    await delivery.register(C1, { atStart: true });
    list();
    flip();
    const first = await boundary();
    expect(first.countsOwed).toEqual({ lookupOnly: false });
    expect(headerLine(first)).toBe(
      "Revision 0: 2 current (2 tests), 0 pending, 0 stale, 0 unknown. Inherited: 1 of 2 current (1 test). " +
        "Test files without checks: 0 pending, 1 unknown.",
    );
  });

  it("are not owed to a registration after the listing", async () => {
    list();
    const registration = await delivery.register(C2, { atStart: true });
    expect(formatRegistration(registration)).not.toContain(NOT_LISTED);
    flip();
    const d = await boundary(C2);
    expect(d.countsOwed).toBeUndefined();
    expect(headerLine(d)).toBe("Revision 0: test files without checks: 1 unknown.");
    expect(store.meta.get(countsOwedMetaKey(WT))).toBeNull();
  });

  it("are spent by a registration again after the listing, whose header carries them", async () => {
    await delivery.register(C1, { atStart: true });
    list();
    await delivery.register(C1);
    flip();
    expect((await boundary()).countsOwed).toBeUndefined();
  });

  it("are forgotten when the consumer unregisters or the worktree is removed", async () => {
    await delivery.register(C1, { atStart: true });
    await delivery.register(C2, { atStart: true });
    await delivery.unregister(C1);
    expect(Object.keys(JSON.parse(store.meta.get(countsOwedMetaKey(WT)) ?? "{}"))).toEqual([
      "s2\nmain",
    ]);
    store.worktrees.remove(WT);
    expect(store.meta.get(countsOwedMetaKey(WT))).toBeNull();
  });
});
