import { describe, expect, it } from "vitest";
import { skippedLaneVerdict } from "../../src/cli/run-skipped.js";
import type { CheckpointLane, CheckpointRecord } from "../../src/core/types/index.js";
import { FAST, keys, NOW, SLOW_A, SLOW_B, seed, skip, states } from "../status/slow-tier-seed.js";

/*
 * Spec 004 D8 as amended 2026-10-17 (task 004-65): a `run --all` checkpoint
 * with a skipped slow lane is not a full suite. Its verdict names the fast
 * lane's result and the skip, exiting 1 on known failures and otherwise 3.
 * The fast lane is every listed fast file, one already current that the
 * checkpoint did not request included (review wave-8.1 B3).
 */

const REASON = "dist/index.js matches no file (slow.precondition.exists)";

function skipped(fast: "pass" | "fail", requested: readonly string[], lane?: CheckpointLane) {
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
    testFiles: requested.map((path) => ({ project: "", path })),
    startedAt: NOW,
    completedAt: NOW,
    end: "abandoned",
    ...(lane === undefined ? {} : { lane }),
  };
  return { ...s, checkpoint };
}

describe("run --all with a skipped slow lane (004 D8 as amended 2026-10-17)", () => {
  it("names the skip and the fast lane's clean result, exit 3", () => {
    const { store, repo, checkpoint } = skipped("pass", [SLOW_A, SLOW_B, FAST]);
    skip(store, repo.mainId, REASON, [SLOW_A, SLOW_B]);
    expect(skippedLaneVerdict(store, checkpoint)).toEqual([
      `has no verdict: its slow lane was skipped, ${REASON}, so it is not a full suite; its fast lane at revision 2: no known failures`,
      3,
    ]);
  });

  it("exits 1 on the fast lane's known failures", () => {
    const { store, repo, checkpoint } = skipped("fail", [SLOW_A, SLOW_B, FAST]);
    skip(store, repo.mainId, REASON, [SLOW_A, SLOW_B]);
    const [line, code] = skippedLaneVerdict(store, checkpoint) ?? [];
    expect(line).toContain("its fast lane at revision 2: 1 known failure: 1 test");
    expect(code).toBe(1);
  });

  it("counts a current fast failure the checkpoint did not request (review wave-8.1 B3)", () => {
    const failing = skipped("fail", [SLOW_A, SLOW_B]);
    skip(failing.store, failing.repo.mainId, REASON, [SLOW_A, SLOW_B]);
    const [line, code] = skippedLaneVerdict(failing.store, failing.checkpoint) ?? [];
    expect(line).toContain("its fast lane at revision 2: 1 known failure: 1 test");
    expect(code).toBe(1);
    // The clean control: the same request over a current passing fast file.
    const clean = skipped("pass", [SLOW_A, SLOW_B]);
    skip(clean.store, clean.repo.mainId, REASON, [SLOW_A, SLOW_B]);
    expect(skippedLaneVerdict(clean.store, clean.checkpoint)?.[1]).toBe(3);
    expect(skippedLaneVerdict(clean.store, clean.checkpoint)?.[0]).toContain(
      "its fast lane at revision 2: no known failures",
    );
  });

  it("keeps the checkpoint's lane: a fast lane names no skip, a slow lane no fast result", () => {
    const fast = skipped("fail", [FAST], "fast");
    skip(fast.store, fast.repo.mainId, REASON, [SLOW_A, SLOW_B]);
    expect(skippedLaneVerdict(fast.store, fast.checkpoint)).toBeNull();
    const slow = skipped("fail", [SLOW_A, SLOW_B], "slow");
    skip(slow.store, slow.repo.mainId, REASON, [SLOW_A, SLOW_B]);
    expect(skippedLaneVerdict(slow.store, slow.checkpoint)).toEqual([
      `has no verdict: its slow lane was skipped, ${REASON}, so it is not a full suite`,
      3,
    ]);
  });

  it("is no verdict of its own when the slow lane was not skipped", () => {
    const { store, checkpoint } = skipped("fail", [SLOW_A, SLOW_B, FAST]);
    expect(skippedLaneVerdict(store, checkpoint)).toBeNull();
  });
});
