import { describe, expect, it } from "vitest";
import type { CodeViewEntry } from "../../../src/core/types/code.js";
import { check, commonDir, open } from "../helpers.js";

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
