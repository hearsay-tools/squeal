import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { countsOwedMetaKey } from "../../src/core/delivery/counts-owed.js";
import { createDelivery } from "../../src/core/delivery/delivery.js";
import { formatDelta, formatRegistration } from "../../src/core/delivery/format.js";
import { createStateSink } from "../../src/core/state/sink.js";
import type { Consumer, Delta, HarnessDelivery } from "../../src/core/types/delivery.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { StateSink } from "../../src/core/types/state.js";
import type { Store } from "../../src/core/types/store.js";
import type { ResultRecord } from "../../src/core/types/store-records.js";
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
// Row 005-90: the sentence an unlisted header says in place of its counts.
const NOT_LISTED = "Squeal is still starting in this worktree and has no results yet.";
// Row 005-94: how far the first results reach, in test files; `squeal status` counts the rest.
const COUNTS =
  "Revision 0: 2 of 3 test files are current (run on the files as they are now), and `squeal status` counts the rest.";

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
    // Row 005-93 (c): later news counts only the consumer's own edits, none here.
    expect(headerLine(later)).toBe("Revision 0.");
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

  it("are spent by Stop when Stop comes first, whose known failures line says how far results reach", async () => {
    await delivery.register(C1, { atStart: true });
    list();
    flip();
    const stop = await boundary(C1, true);
    // Row 005-94 (C2): Stop's form has no counts; its `Known failures` line follows the delta.
    expect(formatDelta(stop, "squeal", 10_000, "full")).not.toMatch(/\d+ current|without checks/);
    flip();
    expect((await boundary()).countsOwed).toBeUndefined();
  });

  it("say the same words when the baseline is not lookup-only (row 005-94)", async () => {
    policy("lookup-then-run-missing");
    await delivery.register(C1, { atStart: true });
    list();
    flip();
    const first = await boundary();
    expect(first.countsOwed).toEqual({ lookupOnly: false });
    expect(headerLine(first)).toBe(COUNTS);
  });

  it("are not owed to a registration after the listing", async () => {
    list();
    const registration = await delivery.register(C2, { atStart: true });
    expect(formatRegistration(registration)).not.toContain(NOT_LISTED);
    flip();
    const d = await boundary(C2);
    expect(d.countsOwed).toBeUndefined();
    expect(headerLine(d)).toBe("Revision 0.");
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
