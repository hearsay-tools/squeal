import { describe, expect, it } from "vitest";
import { MAX_WRITE_LINE_BYTES } from "../../src/core/daemon/protocol.js";
import { encodeBatch } from "../../src/core/daemon/write-batch.js";
import { toView } from "../../src/core/delivery/delta.js";
import { connectionOf } from "../../src/core/store/store.js";
import { seedView, statesToSeed, type ViewSeedRow } from "../../src/core/store/view-seed.js";
import type { CheckId } from "../../src/core/types/check.js";
import type { Consumer } from "../../src/core/types/delivery.js";
import type { KnownState } from "../../src/core/types/state.js";
import type { Store } from "../../src/core/types/store.js";
import { fakeCommonDir, knownState, open, testCheck } from "./helpers.js";

/*
 * Row 005-103: a registration seeds its consumer's view with every known state of the worktree.
 * `writeMany` of `toView` took three statements per state (an insert and a select to find the
 * check's id again, and the view's row); `seedView` writes the same rows in one statement from
 * the states the registration read, with the check ids of that same read (`statesToSeed`).
 */

const WT = "wt-a";
const nameOf = (check: CheckId) => ("fullName" in check ? check.fullName : check.kind);
const consumer = (sessionId: string): Consumer => ({ worktreeId: WT, sessionId, agentId: "main" });

/** The view rows of `c` as stored, in check id order. */
function rows(store: Store, c: Consumer) {
  return connectionOf(store).all(
    `SELECT check_id, outcome, fingerprint, told_at FROM consumer_views
     WHERE worktree_id = ? AND session_id = ? AND agent_id = ? ORDER BY check_id`,
    c.worktreeId,
    c.sessionId,
    c.agentId,
  );
}

const state = (name: string, over: Partial<KnownState>): KnownState => ({
  ...knownState(WT, testCheck(name)),
  origin: { kind: "own" },
  ...over,
});

/** A worktree with pass, fail, unknown, inherited and imported states, a retired check, and another worktree's state. */
function seededStore(): Store {
  const store = open(fakeCommonDir());
  store.knownStates.upsertMany([
    state("passes", { outcome: "pass", fingerprint: null, summary: null }),
    state("fails", { outcome: "fail", fingerprint: "Error: boom @ src/a.test.ts:3" }),
    state("unknown", { outcome: "unknown", validity: "unknown", fingerprint: null }),
    state("inherited", {
      outcome: "fail",
      fingerprint: "Error: inherited",
      origin: { kind: "inherited", worktreeId: "wt-other", commit: "abc" },
    }),
    state("imported", {
      outcome: "pass",
      fingerprint: null,
      origin: { kind: "imported", importId: "imp-1", commit: "def" },
    }),
    state("retired", { outcome: "fail", fingerprint: "Error: gone" }),
    { ...state("elsewhere", { outcome: "fail" }), worktreeId: "wt-b" },
  ]);
  // Spec 001 D8: a check that left its test file is retired; its check row stays.
  store.knownStates.removeMany(WT, [testCheck("retired")]);
  return store;
}

const seedRows = (store: Store) => statesToSeed(store, WT).seed;

describe("a registration's view seed in one statement (row 005-103)", () => {
  it("writes the rows writeMany of toView writes", () => {
    const store = seededStore();
    const before = consumer("before");
    const after = consumer("after");
    store.views.writeMany(
      before,
      store.knownStates.list(WT).map((s) => toView(s, 42)),
    );
    seedView(store, after, seedRows(store), 42);
    expect(rows(store, after)).toEqual(rows(store, before));
    expect(rows(store, after)).toHaveLength(5);
    expect(store.views.list(after)).toEqual(store.views.list(before));
    expect(store.views.list(after).map((v) => [nameOf(v.check), v.outcome])).toEqual([
      ["fails", "fail"],
      ["imported", "pass"],
      ["inherited", "fail"],
      ["passes", "pass"],
      ["unknown", "unknown"],
    ]);
  });

  it("reads the states list() reads, each with its own check's id", () => {
    const store = seededStore();
    const { states, seed } = statesToSeed(store, WT);
    expect(states).toEqual(store.knownStates.list(WT));
    const idOf = (name: string) =>
      connectionOf(store).get("SELECT id FROM checks WHERE full_name = ?", name)?.id;
    expect(seed).toEqual(
      states.map((s) => ({
        checkId: idOf(nameOf(s.check)),
        outcome: s.outcome,
        fingerprint: s.fingerprint,
      })),
    );
  });

  it("writes nothing for a worktree with no states", () => {
    const store = seededStore();
    seedView(store, consumer("empty"), [], 42);
    expect(rows(store, consumer("empty"))).toEqual([]);
  });

  it.each([32_000, 200_000])(
    "fits one statement and one write line at %i states",
    (n) => {
      // 1 in 100 failing, each with a 200-character fingerprint: more than the 005-101 stores hold.
      const seed: ViewSeedRow[] = Array.from({ length: n }, (_, i) => ({
        checkId: i + 1,
        outcome: i % 100 === 0 ? "fail" : "pass",
        fingerprint: i % 100 === 0 ? `Error: ${"x".repeat(193)}` : null,
      }));
      const store = open(fakeCommonDir());
      const statements: { sql: string; params: readonly unknown[] }[] = [];
      const conn = connectionOf(store);
      const run = conn.run.bind(conn);
      conn.run = (sql, ...params) => {
        statements.push({ sql, params });
        return run(sql, ...params);
      };
      seedView(store, consumer("big"), seed, 42);
      conn.run = run;
      expect(statements).toHaveLength(1);
      // Spec 021 D15: under a serving daemon the statement travels as one `write` line.
      const line = JSON.stringify({ type: "write", batch: encodeBatch(statements as never) });
      expect(line.length).toBeLessThan(MAX_WRITE_LINE_BYTES / 4);
      expect(rows(store, consumer("big"))).toHaveLength(n);
    },
    60_000,
  );
});
