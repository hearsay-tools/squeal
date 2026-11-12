import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { COVERAGE_RECORD_VERSION as V } from "../../src/core/code/coverage/record.js";
import { codeStorePath } from "../../src/core/code/store/open.js";
import { worktreeIdsOf } from "../../src/core/code/store/prune.js";
import type { CodeKnownState, CodeTransition } from "../../src/core/types/code.js";
import { check, commonDir, count, file, open } from "./helpers.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY_MS;
const OLD = NOW - 8 * DAY_MS;
const RECENT = NOW - DAY_MS;
const at = (resultKey: string, providerVersion = V) => ({ resultKey, providerVersion });

function failing(worktreeId: string, qualifiedName: string): CodeKnownState {
  return {
    worktreeId,
    check: check(qualifiedName),
    measure: "complexity",
    outcome: "fail",
    value: 23,
    threshold: 20,
    countedAt: 1,
    blob: "b1",
    changedAt: 1,
  };
}

function firstFail(worktreeId: string): CodeTransition {
  return {
    worktreeId,
    check: check("Ledger.settle"),
    measure: "complexity",
    kind: "first-seen-fail",
    from: null,
    to: "fail",
    fromValue: null,
    toValue: 23,
    threshold: 20,
    revision: 1,
    at: 1,
  };
}

describe("code store prune (015 D4, 011 C7)", () => {
  it("drops a count no current file uses once it is past the retention, and keeps the rest", () => {
    const store = open(commonDir());
    store.counts.put(count("used-old"), OLD);
    store.counts.put(count("unused-old"), OLD);
    store.counts.put(count("unused-recent"), RECENT);
    // Used at another counter version only: this one is not used.
    store.counts.put(count("other-version", 3, 1), OLD);
    store.files.upsertMany("w1", [
      file("src/a.ts", "used-old"),
      file("src/b.ts", "other-version", 2),
    ]);

    const report = store.prune({ now: NOW, retentionDays: 7, worktrees: ["w1"], consumers: [] });

    expect(report.countsRemoved).toBe(2);
    expect(store.counts.get("used-old", "typescript", 1)).not.toBeNull();
    expect(store.counts.get("unused-recent", "typescript", 1)).not.toBeNull();
    expect(store.counts.get("unused-old", "typescript", 1)).toBeNull();
    expect(store.counts.get("other-version", "typescript", 1)).toBeNull();
  });

  it("keeps a count past the retention while a kept state was judged on it (review 0.1.283 B5)", () => {
    const store = open(commonDir());
    store.counts.put(count("judged"), OLD);
    store.counts.put(count("unjudged"), OLD);
    // The edit's count is pending: the files row names a blob no state was judged on yet.
    store.files.upsertMany("w1", [file("src/a.ts", "pending")]);
    store.states.upsertMany([{ ...failing("w1", "Ledger.settle"), blob: "judged" }]);

    const report = store.prune({ now: NOW, retentionDays: 7, worktrees: ["w1"], consumers: [] });

    expect(report.countsRemoved).toBe(1);
    expect(store.counts.get("judged", "typescript", 1)).not.toBeNull();
    expect(store.counts.get("unjudged", "typescript", 1)).toBeNull();
  });

  it("drops a removed worktree's rows, and its counts once they are past the retention", () => {
    const store = open(commonDir());
    store.counts.put(count("gone-old"), OLD);
    store.counts.put(count("gone-recent"), RECENT);
    store.files.upsertMany("gone", [file("src/a.ts", "gone-old"), file("src/b.ts", "gone-recent")]);
    store.states.upsertMany([failing("gone", "Ledger.settle"), failing("w1", "Ledger.open")]);
    const consumer = { worktreeId: "gone", sessionId: "s", agentId: "main" };
    store.views.writeMany(consumer, [
      {
        check: check("Ledger.settle"),
        measure: "complexity",
        outcome: "fail",
        threshold: 20,
        told: "count",
        toldAt: 1,
      },
    ]);
    store.transitions.append([firstFail("gone")]);

    const report = store.prune({ now: NOW, retentionDays: 7, worktrees: ["w1"], consumers: [] });

    expect(report).toMatchObject({ worktreesRemoved: 1, countsRemoved: 1, checksRemoved: 1 });
    expect(store.files.list("gone")).toEqual([]);
    expect(store.states.list("gone")).toEqual([]);
    expect(store.views.list(consumer)).toEqual([]);
    expect(store.transitions.history("gone", check("Ledger.settle"))).toEqual([]);
    expect(store.states.list("w1")).toEqual([failing("w1", "Ledger.open")]);
    // A later worktree at the same bytes still finds the recent count.
    expect(store.counts.get("gone-recent", "typescript", 1)).not.toBeNull();
    expect(store.counts.get("gone-old", "typescript", 1)).toBeNull();
  });

  it("keeps a live worktree's rows and drops a dead one's, wherever its id sorts (row 011-315)", () => {
    const store = open(commonDir());
    // Dead ids before, between and after the live ones, each in another table.
    store.files.upsertMany("a-dead", [file("src/a.ts", "b1")]);
    store.files.upsertMany("m-live", [file("src/a.ts", "b1")]);
    store.states.upsertMany([
      failing("m-live", "Ledger.open"),
      failing("p-dead", "Ledger.open"),
      failing("z-live", "Ledger.open"),
    ]);
    store.transitions.append([firstFail("q-dead"), firstFail("z-live")]);

    const report = store.prune({
      now: NOW,
      retentionDays: 7,
      worktrees: ["m-live", "z-live"],
      consumers: [],
    });

    expect(report.worktreesRemoved).toBe(3);
    expect(store.files.list("a-dead")).toEqual([]);
    expect(store.files.list("m-live")).toEqual([file("src/a.ts", "b1")]);
    expect(store.states.list("p-dead")).toEqual([]);
    expect(store.states.list("m-live")).toEqual([failing("m-live", "Ledger.open")]);
    expect(store.states.list("z-live")).toEqual([failing("z-live", "Ledger.open")]);
    expect(store.transitions.history("q-dead", check("Ledger.settle"))).toEqual([]);
    expect(store.transitions.history("z-live", check("Ledger.settle"))).toHaveLength(1);
  });

  it("finds each table's worktree ids by a search per id, never a read of every row (row 011-315)", () => {
    const dir = commonDir();
    open(dir);
    const db = new DatabaseSync(codeStorePath(dir), { readOnly: true });
    try {
      for (const table of ["files", "states", "views", "transitions"]) {
        const plan = db
          .prepare(`EXPLAIN QUERY PLAN ${worktreeIdsOf(table)}`)
          .all()
          .map((row) => String(row.detail));
        expect(plan).toContainEqual(expect.stringMatching(new RegExp(`^SEARCH ${table} `)));
        expect(plan.join("\n")).not.toMatch(new RegExp(`SCAN ${table}\\b`));
      }
    } finally {
      db.close();
    }
  });

  it("drops the view entries of a consumer no longer registered", () => {
    const store = open(commonDir());
    const kept = { worktreeId: "w1", sessionId: "s1", agentId: "main" };
    const left = { worktreeId: "w1", sessionId: "s2", agentId: "main" };
    const entry = {
      check: check("Ledger.settle"),
      measure: "complexity",
      outcome: "fail",
      threshold: 20,
      told: "count",
      toldAt: 1,
    } as const;
    store.views.writeMany(kept, [entry]);
    store.views.writeMany(left, [entry]);

    const report = store.prune({
      now: NOW,
      retentionDays: 7,
      worktrees: ["w1"],
      consumers: [kept],
    });

    expect(report.viewsRemoved).toBe(1);
    expect(store.views.list(kept)).toEqual([entry]);
    expect(store.views.list(left)).toEqual([]);
  });

  it("drops a coverage record with the last result at its key, whatever its age (row 015-11)", () => {
    const store = open(commonDir());
    const record = new Uint8Array([1]);
    store.coverage.put(at("kept-old"), record, OLD);
    store.coverage.put(at("gone-recent"), record, RECENT);
    // A newer Squeal's record stays for it, as an older daemon's prune would keep it.
    store.coverage.put(at("kept-old", V + 1), record, RECENT);

    const report = store.prune({
      now: NOW,
      retentionDays: 7,
      worktrees: [],
      consumers: [],
      resultKeys: ["kept-old"],
    });

    expect(report.coverageRemoved).toBe(1);
    expect(store.coverage.get(at("kept-old"))).toEqual(record);
    expect(store.coverage.get(at("kept-old", V + 1))).toEqual(record);
    expect(store.coverage.get(at("gone-recent"))).toBeNull();
  });

  it("without the result keys, drops coverage records past the retention", () => {
    const store = open(commonDir());
    store.coverage.put(at("old"), new Uint8Array([1]), OLD);
    store.coverage.put(at("recent"), new Uint8Array([1]), RECENT);

    expect(
      store.prune({ now: NOW, retentionDays: 7, worktrees: [], consumers: [] }).coverageRemoved,
    ).toBe(1);
  });

  it("drops a record of an older record version, which no reader takes (row 018-10 R1)", () => {
    const record = new Uint8Array([1]);
    for (const resultKeys of [["kept"], undefined]) {
      const store = open(commonDir());
      store.coverage.put(at("kept", V - 1), record, RECENT);
      store.coverage.put(at("kept"), record, RECENT);

      const report = store.prune({
        now: NOW,
        retentionDays: 7,
        worktrees: [],
        consumers: [],
        ...(resultKeys === undefined ? {} : { resultKeys }),
      });

      expect(report.coverageRemoved).toBe(1);
      expect(store.coverage.get(at("kept", V - 1))).toBeNull();
      expect(store.coverage.get(at("kept"))).toEqual(record);
    }
  });

  it("deletes in batches, so a large removed worktree is many short transactions", () => {
    const store = open(commonDir());
    const files = Array.from({ length: 600 }, (_, i) => file(`src/f${i}.ts`, `blob-${i}`));
    store.files.upsertMany("gone", files);
    for (const f of files) store.counts.put(count(f.blob), OLD);

    const report = store.prune({ now: NOW, retentionDays: 7, worktrees: [], consumers: [] });

    expect(report.countsRemoved).toBe(600);
    expect(store.files.list("gone")).toEqual([]);
  });
});
