import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { codeStorePath } from "../../../src/core/code/store/index.js";
import { createDelivery, formatDelta } from "../../../src/core/delivery/index.js";
import type { CodeViewEntry } from "../../../src/core/types/code.js";
import { fixedStatus } from "../../delivery/fakes.js";
import { freshStore, setKey, WT } from "../../state/helpers.js";
import { check, commonDir, open } from "../helpers.js";
import { codeRepo, codeState, codeTransition, fn, fnCheck, putFile, TIERS } from "./helpers.js";

const ALICE = { worktreeId: "w1", sessionId: "s1", agentId: "main" };
const BOB = { worktreeId: "w1", sessionId: "s2", agentId: "main" };

function told(qualifiedName: string, measure: CodeViewEntry["measure"] = "complexity") {
  return {
    check: check(qualifiedName),
    measure,
    outcome: "fail",
    threshold: 20,
    told: "count",
    toldAt: 7,
  } satisfies CodeViewEntry;
}

/** Every row of the code store's `views` table, as `<session> <name> <outcome>`, read past the repo. */
function rows(dir: string): string[] {
  const db = new DatabaseSync(codeStorePath(dir), { readOnly: true });
  try {
    return db
      .prepare(
        `SELECT v.session_id, c.qualified_name, v.outcome FROM views v
         JOIN checks c ON c.id = v.check_id ORDER BY v.session_id, c.qualified_name`,
      )
      .all()
      .map((r) => `${String(r.session_id)} ${String(r.qualified_name)} ${String(r.outcome)}`);
  } finally {
    db.close();
  }
}

describe("code views a removed function leaves (coordinator agreement, 015-06/015-07)", () => {
  it("keeps the view entries of a removed state, for the delivery to tell once", () => {
    const store = open(commonDir());
    store.states.upsertMany([
      {
        worktreeId: "w1",
        check: check("Ledger.settle"),
        measure: "complexity",
        outcome: "fail",
        value: 23,
        threshold: 20,
        countedAt: 4,
        blob: "b1",
        changedAt: 3,
      },
    ]);
    store.views.writeMany(ALICE, [told("Ledger.settle")]);
    store.states.removeMany("w1", [check("Ledger.settle")]);
    expect(store.states.list("w1")).toEqual([]);
    expect(store.views.list(ALICE)).toEqual([told("Ledger.settle")]);
  });

  it("removes only the named entries of one consumer", () => {
    const store = open(commonDir());
    const entries = [told("Ledger.settle"), told("Ledger.settle", "crap"), told("Ledger.open")];
    store.views.writeMany(ALICE, entries);
    store.views.writeMany(BOB, entries);
    store.views.removeMany(ALICE, [
      { check: check("Ledger.settle"), measure: "complexity" },
      { check: check("Never.seen"), measure: "complexity" },
    ]);
    expect(store.views.list(ALICE)).toEqual([told("Ledger.open"), told("Ledger.settle", "crap")]);
    expect(store.views.list(BOB)).toHaveLength(3);
  });
});

describe("views hold failing functions only (lessons round 1, P5)", () => {
  it("reads a pass entry an older hook wrote as none", () => {
    const store = open(commonDir());
    store.views.writeMany(ALICE, [
      { ...told("Ledger.open"), outcome: "pass" },
      told("Ledger.settle"),
    ]);
    expect(store.views.list(ALICE)).toEqual([told("Ledger.settle")]);
  });

  it("keeps the entries of the consumers named, and removes every other's in the worktrees named", () => {
    const store = open(commonDir());
    const carol = { worktreeId: "w2", sessionId: "s1", agentId: "main" };
    for (const c of [ALICE, BOB, carol]) store.views.writeMany(c, [told("Ledger.settle")]);
    expect(store.views.retain(["w1"], [BOB])).toBe(1);
    // Another worktree's views are prune's to drop with the worktree.
    expect([ALICE, BOB, carol].map((c) => store.views.list(c).length)).toEqual([0, 1, 1]);
  });

  it("writes one row per failing function at registration, and a recovery removes it", async () => {
    const repo = codeRepo();
    const main = freshStore();
    setKey(main, "k1");
    let clock = 10_000;
    const delivery = () =>
      createDelivery(main, { status: fixedStatus(), now: () => clock, code: repo.source });
    const consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
    const select = fnCheck("selectTier");
    const functions = [fn("planTier", 5, 40), fn("rankTier", 31, 80), fn("selectTier", 23, 120)];
    putFile(repo.store, WT, TIERS, functions);
    repo.store.states.upsertMany(
      functions.map((f) => codeState(WT, fnCheck(f.qualifiedName), f.complexity)),
    );
    await delivery().register(consumer);
    expect(rows(repo.dir)).toEqual(["s1 rankTier fail", "s1 selectTier fail"]);

    clock += 1_000;
    putFile(repo.store, WT, TIERS, [
      fn("planTier", 5, 40),
      fn("rankTier", 31, 80),
      fn("selectTier", 18, 120),
    ]);
    repo.store.states.upsertMany([codeState(WT, select, 18, { revision: 2 })]);
    repo.store.transitions.append([
      codeTransition(WT, select, "fail-to-pass", { from: 23, to: 18, at: clock }),
    ]);
    const recovered = await delivery().onToolBoundary(consumer);
    expect(formatDelta(recovered ?? expect.fail("no delta"))).toContain(
      "PASS complexity: selectTier (src/core/scheduler/tiers.ts:120) is 18, at or under 20",
    );
    expect(rows(repo.dir)).toEqual(["s1 rankTier fail"]);

    // With no entry, the function reads `pass`: going over again is told.
    clock += 1_000;
    repo.store.states.upsertMany([codeState(WT, select, 24, { revision: 3 })]);
    repo.store.transitions.append([
      codeTransition(WT, select, "pass-to-fail", { from: 18, to: 24, at: clock, revision: 3 }),
    ]);
    const again = await delivery().onToolBoundary(consumer);
    expect(again?.code?.entries.map((e) => [e.check.qualifiedName, e.kind])).toEqual([
      ["selectTier", "pass-to-fail"],
    ]);
    expect(rows(repo.dir)).toEqual(["s1 rankTier fail", "s1 selectTier fail"]);
  });
});
