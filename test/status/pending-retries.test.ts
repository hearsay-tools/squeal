import { describe, expect, it } from "vitest";
import {
  askNoResultRun,
  askRetry,
  claimRetries,
  LOAD_RETRY_WAIT_MS,
  markGateClosed,
  pendingRetriesOf,
} from "../../src/core/retry/index.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import { timeText } from "../../src/core/text.js";
import type { EpochMs, StatusSnapshot } from "../../src/core/types/index.js";
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

/** Status at `NOW` with the host's load as given, so a `load` request's text does not follow the host's. */
const lines = (s: ReturnType<typeof seeded>, oneMinute = 12.4, cpus = 8) => {
  const read = readStatus(s.repo.main, { now: () => NOW }) as StatusSnapshot;
  const pending = read.pendingRetries;
  const snapshot =
    pending === undefined
      ? read
      : { ...read, pendingRetries: { ...pending, loadAverage: oneMinute, cpus } };
  return { snapshot, lines: formatStatus(snapshot, NOW).split("\n") };
};

describe("status lists pending retries (001-368)", () => {
  it("each file once, with what it waits for, as an outstanding group (011-29)", () => {
    const s = seeded();
    s.ask(FAST, "load");
    s.ask(FAST, "load", "s2");
    s.ask(SLOW_A, "environment");
    const { snapshot, lines: text } = lines(s);
    expect(snapshot.pendingRetries?.retries).toMatchObject([
      { testFile: { path: FAST }, reason: "load", requests: 2, claimedBy: null },
      { testFile: { path: SLOW_A }, reason: "environment", requests: 1 },
    ]);
    expect(text).toContain(
      "  1 test file with a pending retry (load): src/a.test.ts; waits for the one-minute load average to fall below the CPU count, at most 10 min, then runs once anyway (load average 12.40 on 8 CPUs now)",
    );
    expect(text).toContain(
      "  1 test file with a pending retry (environment): test/e2e/a.test.ts; runs at once",
    );
  });

  it("says how long the load gate has been closed on a load retry, and that it runs at the bound (011-213)", () => {
    const s = seeded();
    s.ask(FAST, "load");
    s.ask(FAST, "load", "s2");
    const ref = { project: "", path: FAST };
    markGateClosed(s.store, [], ref, s.keyOf(FAST), NOW - 252_000);
    const { snapshot, lines: text } = lines(s);
    expect(snapshot.pendingRetries?.retries).toMatchObject([{ gateClosedAt: NOW - 252_000 }]);
    expect(text).toContain(
      "  1 test file with a pending retry (load): src/a.test.ts; waits for the one-minute load average to fall below the CPU count: at or above it for 4 min 12 s of at most 10 min, then runs once anyway (load average 12.40 on 8 CPUs now)",
    );

    const past = seeded();
    past.ask(FAST, "load");
    markGateClosed(past.store, [], ref, past.keyOf(FAST), NOW - LOAD_RETRY_WAIT_MS);
    expect(lines(past).lines).toContain(
      "  1 test file with a pending retry (load): src/a.test.ts; runs at the daemon's next look: the one-minute load average stayed at or above the CPU count for 10 min, the most a load retry waits (load average 12.40 on 8 CPUs now)",
    );
  });

  it("says when another worktree's daemon queued it", () => {
    const s = seeded();
    s.ask(FAST, "environment");
    claimRetries(s.store, { project: "", path: FAST }, s.keyOf(FAST), "wt-other", NOW, () => true);
    expect(lines(s).lines).toContain(
      "  1 test file with a pending retry (environment): src/a.test.ts; runs at once, queued by another worktree's daemon",
    );
  });

  it("nothing for a request at another key, or one that ended", () => {
    const s = seeded();
    s.ask(FAST, "load", "s1", "older-key");
    const { snapshot, lines: text } = lines(s);
    expect(snapshot.pendingRetries).toBeUndefined();
    expect(text.some((l) => l.includes("pending retry"))).toBe(false);
  });
});

describe("a pending retry says when it runs (011-27, gh-41's comment)", () => {
  it("a load request the load lets run runs at the daemon's next look", () => {
    const s = seeded();
    s.ask(FAST, "load");
    expect(lines(s, 7.45, 24).lines).toContain(
      "  1 test file with a pending retry (load): src/a.test.ts; runs at the daemon's next look: the one-minute load average is below the CPU count (load average 7.45 on 24 CPUs now)",
    );
  });

  it("one whose run is open says since when", () => {
    const s = seeded();
    s.ask(FAST, "load");
    const keys = s.store.testFileKeys
      .list(s.repo.mainId)
      .map((k) => (k.testFile.path === FAST ? { ...k, pending: "running" as const } : k));
    s.store.testFileKeys.upsertMany(keys.filter((k) => k.testFile.path === FAST));
    const run = s.store.runs.start({
      id: "run-a",
      worktreeId: s.repo.mainId,
      revision: 1 as never,
      testFiles: [{ project: "", path: FAST as never }],
      checkpointId: null,
      logDir: "/tmp/run-a" as never,
      startedAt: (NOW - 30_000) as EpochMs,
    });
    const { pendingRetries } = pendingRetriesOf(s.store, keys, () => ({ oneMinute: 30, cpus: 8 }), [
      run,
    ]);
    expect(pendingRetries?.retries[0]?.runningSince).toBe(NOW - 30_000);
    expect(lines(s).lines).toContain(
      `  1 test file with a pending retry (load): src/a.test.ts; running since ${timeText(NOW - 30_000)}`,
    );
  });

  it("a run asked for a file with no result names no reason: it runs at once whatever the reason", () => {
    const s = seeded();
    askNoResultRun(s.store, {
      testFile: { project: "", path: FAST },
      key: s.keyOf(FAST),
      session: "s1",
      reason: "load",
      at: NOW,
      worktreeId: s.repo.mainId,
    });
    expect(lines(s).lines).toContain(
      "  1 test file with a pending retry (no result at its inputs): src/a.test.ts; runs at once",
    );
  });
});
