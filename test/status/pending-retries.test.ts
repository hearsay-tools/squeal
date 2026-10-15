import { describe, expect, it } from "vitest";
import { askRetry, claimRetries } from "../../src/core/retry/index.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import type { StatusSnapshot } from "../../src/core/types/index.js";
import { FAST, NOW, SLOW_A, seed } from "./slow-tier-seed.js";

/*
 * Spec 001 D6 as amended (001-368): `squeal status` names each pending retry
 * at the worktree's current keys and what it waits for, with the load now.
 */

function seeded() {
  const s = seed(null);
  const keyOf = (path: string) =>
    s.store.testFileKeys.list(s.repo.mainId).find((k) => k.testFile.path === path)?.key as string;
  const ask = (path: string, reason: "load" | "environment", session = "s1", key = keyOf(path)) =>
    askRetry(s.store, {
      testFile: { project: "", path },
      key,
      session,
      reason,
      at: NOW,
      worktreeId: s.repo.mainId,
    });
  return { ...s, keyOf, ask };
}

const lines = (s: ReturnType<typeof seeded>) => {
  const snapshot = readStatus(s.repo.main, { now: () => NOW }) as StatusSnapshot;
  return { snapshot, lines: formatStatus(snapshot, NOW).split("\n") };
};

describe("status lists pending retries (001-368)", () => {
  it("each file once, with what it waits for", () => {
    const s = seeded();
    s.ask(FAST, "load");
    s.ask(FAST, "load", "s2");
    s.ask(SLOW_A, "environment");
    const { snapshot, lines: text } = lines(s);
    expect(snapshot.pendingRetries?.retries).toMatchObject([
      { testFile: { path: FAST }, reason: "load", requests: 2, claimedBy: null },
      { testFile: { path: SLOW_A }, reason: "environment", requests: 1 },
    ]);
    const at = text.indexOf("Pending retries: 2");
    expect(at).toBeGreaterThan(0);
    expect(text[at + 1]).toMatch(
      /^ {2}src\/a\.test\.ts \(load\): waits for the one-minute load average to fall below the CPU count \(load average \d+\.\d\d on \d+ CPUs? now\)$/,
    );
    expect(text[at + 2]).toBe("  test/e2e/a.test.ts (environment): runs at once");
  });

  it("says when another worktree's daemon queued it", () => {
    const s = seeded();
    s.ask(FAST, "environment");
    claimRetries(s.store, { project: "", path: FAST }, s.keyOf(FAST), "wt-other", NOW, () => true);
    expect(lines(s).lines).toContain(
      "  src/a.test.ts (environment): runs at once, queued by another worktree's daemon",
    );
  });

  it("nothing for a request at another key, or one that ended", () => {
    const s = seeded();
    s.ask(FAST, "load", "s1", "older-key");
    const { snapshot, lines: text } = lines(s);
    expect(snapshot.pendingRetries).toBeUndefined();
    expect(text.some((l) => l.startsWith("Pending retries"))).toBe(false);
  });
});
