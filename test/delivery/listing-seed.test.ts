import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDelivery } from "../../src/core/delivery/delivery.js";
import { formatDelta } from "../../src/core/delivery/format.js";
import { viewMarkOf } from "../../src/core/delivery/view-mark.js";
import { createStateSink } from "../../src/core/state/sink.js";
import { currentBirthMark } from "../../src/core/store/state-born.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { CheckId } from "../../src/core/types/check.js";
import type { Consumer, Delta, HarnessDelivery } from "../../src/core/types/delivery.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { Store } from "../../src/core/types/store.js";
import type { ResultRecord } from "../../src/core/types/store-records.js";
import { check, freshStore, OTHER, releasedStore, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * Row 005-113 (011 `research/unlisted-after-start.md` R1): a session registered before the
 * daemon listed the test files is owed the counts (row 011-205). Its first delivery after the
 * listing wrote one view row per state it was never told, every pass among them, which on a
 * large store took longer than a hook's 2 s, was killed and rolled back at every boundary. It
 * now writes the rows that are not `pass` and keeps the store's high birth mark, as a
 * registration at that moment does (row 005-106); what it tells is unchanged.
 */

const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const C2: Consumer = { worktreeId: WT, sessionId: "s2", agentId: "main" };
const OWN: TestFileRef = { project: "", path: "src/own.test.ts" };
const SHARED: TestFileRef = { project: "", path: "src/shared.test.ts" };
const N = 40;
const PASSES = Array.from({ length: N }, (_, i) => check(`p${i}`, OWN));
const MINE = check("mine", OWN);
const INHERITED = check("inherited", SHARED);

let root: string;
let store: Store;
let delivery: HarnessDelivery;

function use(next: Store): void {
  store = next;
  store.worktrees.upsert({
    id: WT,
    root,
    commonDir: join(root, ".git"),
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  liveDaemon(store, WT);
  delivery = createDelivery(store, { status: fixedStatus(), now: () => 10_000 });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-005-113-"));
  use(freshStore());
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function apply(...results: ResultRecord[]): void {
  store.results.putMany(results);
  createStateSink(store).applyResults(WT, 0, results, { checkpointId: null });
}

/** The listing at revision 0: `N` own passes, `MINE` as given, an inherited failure. */
function list(mine: "pass" | "fail" = "pass"): void {
  setKey(store, "ko", { file: OWN });
  setKey(store, "ks", { file: SHARED });
  apply(
    ...PASSES.map((c) => result(c, "pass", { key: "ko", revision: 0 })),
    result(MINE, mine, { key: "ko", revision: 0, message: "born at the listing" }),
    result(INHERITED, "fail", { key: "ks", worktreeId: OTHER, revision: 0, message: "inherited" }),
  );
}

function land(c: CheckId, outcome: "pass" | "fail", message = "later"): void {
  apply(result(c, outcome, { key: "ko", revision: 0, message }));
}

const rowsOf = (consumer: Consumer) =>
  connectionOf(store)
    .all(
      `SELECT c.full_name AS name, v.outcome AS outcome FROM consumer_views v
         JOIN checks c ON c.id = v.check_id WHERE v.session_id = ? ORDER BY c.full_name`,
      consumer.sessionId,
    )
    .map((r) => `${String(r.name)}=${String(r.outcome)}`);

const said = (d: Delta | null) =>
  d?.entries.map((e) => `${(e.check as { fullName: string }).fullName}:${e.kind}:${e.from}`) ??
  null;

describe("the first delivery after the listing (row 005-113)", () => {
  it("writes the rows that are not pass and the store's high mark, not one row per state", async () => {
    await delivery.register(C1, { atStart: true });
    list();
    const first = await delivery.onToolBoundary(C1);
    expect(said(first)).toEqual(["inherited:first-seen-fail:null"]);
    expect(rowsOf(C1)).toEqual(["inherited=fail"]);
    expect(viewMarkOf(store, C1)?.mark).toBe(currentBirthMark(store));
  });

  it("tells a failure born at the listing once, as before, and keeps it", async () => {
    await delivery.register(C1, { atStart: true });
    list("fail");
    const first = await delivery.onToolBoundary(C1);
    expect(said(first)).toEqual(["mine:first-seen-fail:null", "inherited:first-seen-fail:null"]);
    expect(first?.countsOwed).toBeDefined();
    expect(rowsOf(C1)).toEqual(["inherited=fail", "mine=fail"]);
    land(PASSES[0] as CheckId, "fail");
    expect(said(await delivery.onToolBoundary(C1))).toEqual(["p0:pass-to-fail:pass"]);
  });

  it("tells an inherited failure as inherited, never as this session's regression", async () => {
    await delivery.register(C1, { atStart: true });
    list();
    const entry = (await delivery.onToolBoundary(C1))?.entries[0];
    expect(entry?.kind).toBe("first-seen-fail");
    expect(entry !== undefined && "origin" in entry ? entry.origin.kind : null).toBe("inherited");
    land(MINE, "pass", "again");
    expect(await delivery.onToolBoundary(C1)).toBeNull();
  });

  it("tells a pass born at the listing as no news, and its later failure as a regression", async () => {
    await delivery.register(C1, { atStart: true });
    list();
    await delivery.onToolBoundary(C1);
    expect(rowsOf(C1)).not.toContain("mine=pass");
    land(MINE, "fail");
    expect(said(await delivery.onToolBoundary(C1))).toEqual(["mine:pass-to-fail:pass"]);
  });

  it("keeps the full write on a store with no birth marks", async () => {
    use(releasedStore());
    await delivery.register(C1, { atStart: true });
    list();
    expect(said(await delivery.onToolBoundary(C1))).toEqual(["inherited:first-seen-fail:null"]);
    expect(rowsOf(C1)).toHaveLength(N + 2);
    expect(viewMarkOf(store, C1)).toBeNull();
  });

  it("seeds only the consumer owed the counts; one registered after the listing keeps its seed", async () => {
    await delivery.register(C1, { atStart: true });
    list();
    await delivery.register(C2, { atStart: true });
    const registered = viewMarkOf(store, C2);
    land(MINE, "fail");
    expect(said(await delivery.onToolBoundary(C2))).toEqual(["mine:pass-to-fail:pass"]);
    // The audit log holds the pass the consumer was never told, as with the full write.
    expect(said(await delivery.onToolBoundary(C1))).toEqual([
      "mine:pass-to-fail:pass",
      "inherited:first-seen-fail:null",
    ]);
    expect(rowsOf(C1)).toEqual(["inherited=fail", "mine=fail"]);
    expect(viewMarkOf(store, C2)).toEqual(registered);
    // Paid, the counts are not owed again: a pass born later is written as before.
    land(check("later", OWN), "pass");
    expect(await delivery.onToolBoundary(C1)).toBeNull();
    expect(rowsOf(C1)).toEqual(["inherited=fail", "later=pass", "mine=fail"]);
  });

  it("commits the writes and the mark with the delivery, or neither", async () => {
    await delivery.register(C1, { atStart: true });
    const registered = viewMarkOf(store, C1);
    list();
    const views = store.views as { writeMany: Store["views"]["writeMany"] };
    const writeMany = views.writeMany;
    views.writeMany = () => {
      throw new Error("killed");
    };
    await expect(delivery.onToolBoundary(C1)).rejects.toThrow("killed");
    views.writeMany = writeMany;
    expect(viewMarkOf(store, C1)).toEqual(registered);
    expect(rowsOf(C1)).toEqual([]);
    const first = await delivery.onToolBoundary(C1);
    expect(first?.countsOwed).toBeDefined();
    expect(formatDelta(first as Delta)).toContain("inherited");
    expect(rowsOf(C1)).toEqual(["inherited=fail"]);
  });
});
