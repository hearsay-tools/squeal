import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { CodeKnownState } from "../../src/core/types/code.js";
import { check, commonDir, count, file, open } from "./helpers.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY_MS;
const OLD = NOW - 8 * DAY_MS;
const RECENT = NOW - DAY_MS;

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
    store.transitions.append([
      {
        worktreeId: "gone",
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
      },
    ]);

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

  it("drops coverage records past the retention", () => {
    const store = open(commonDir());
    const db = new DatabaseSync(store.path);
    const insert = db.prepare(
      "INSERT INTO coverage (result_key, provider_version, record, recorded_at) VALUES (?, 1, ?, ?)",
    );
    insert.run("old", new Uint8Array([1]), OLD);
    insert.run("recent", new Uint8Array([1]), RECENT);
    db.close();

    expect(
      store.prune({ now: NOW, retentionDays: 7, worktrees: [], consumers: [] }).coverageRemoved,
    ).toBe(1);
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
