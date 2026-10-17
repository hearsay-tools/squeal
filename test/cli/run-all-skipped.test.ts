import { describe, expect, it } from "vitest";
import { skippedLaneVerdict } from "../../src/cli/run-skipped.js";
import { publishSlowActivity } from "../../src/core/slow/state.js";
import type { CheckpointRecord } from "../../src/core/types/index.js";
import { FAST, keys, NOW, SLOW_A, SLOW_B, seed, states } from "../status/slow-tier-seed.js";

/*
 * Spec 004 D8 as amended 2026-10-17 (task 004-65): a `run --all` checkpoint
 * with a skipped slow lane is not a full suite. Its verdict names the fast
 * lane's result and the skip, exiting 1 on known failures and otherwise 3.
 */

const REASON = "dist/index.js matches no file (slow.precondition.exists)";

function skipped(fast: "pass" | "fail") {
  const s = seed();
  keys(s.store, s.repo, { [SLOW_A]: null, [SLOW_B]: null, [FAST]: null });
  states(
    s.store,
    s.repo,
    [{ validity: "stale" }, { validity: "stale" }, { outcome: fast, observedAt: 2 }],
    [SLOW_A, SLOW_B, FAST],
  );
  const checkpoint: CheckpointRecord = {
    id: "cp-1",
    worktreeId: s.repo.mainId,
    revision: 2,
    kind: "run-all",
    testFiles: [SLOW_A, SLOW_B, FAST].map((path) => ({ project: "", path })),
    startedAt: NOW,
    completedAt: NOW,
    end: "abandoned",
  };
  return { ...s, checkpoint };
}

describe("run --all with a skipped slow lane (004 D8 as amended 2026-10-17)", () => {
  it("names the skip and the fast lane's clean result, exit 3", () => {
    const { store, repo, checkpoint } = skipped("pass");
    publishSlowActivity(store, repo.mainId, { kind: "skipped", reason: REASON, since: NOW });
    expect(skippedLaneVerdict(store, checkpoint)).toEqual([
      `has no verdict: its slow lane was skipped, ${REASON}, so it is not a full suite; its fast lane at revision 2: no known failures`,
      3,
    ]);
  });

  it("exits 1 on the fast lane's known failures", () => {
    const { store, repo, checkpoint } = skipped("fail");
    publishSlowActivity(store, repo.mainId, { kind: "skipped", reason: REASON, since: NOW });
    const [line, code] = skippedLaneVerdict(store, checkpoint) ?? [];
    expect(line).toContain("its fast lane at revision 2: 1 known failure: 1 test");
    expect(code).toBe(1);
  });

  it("is no verdict of its own when the slow lane was not skipped", () => {
    const { store, checkpoint } = skipped("fail");
    expect(skippedLaneVerdict(store, checkpoint)).toBeNull();
  });
});
