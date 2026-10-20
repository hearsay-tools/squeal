import { describe, expect, it } from "vitest";
import { type EndedWait, waitLine } from "../../src/cli/status-wait-lines.js";
import { createDelivery, formatRegistration } from "../../src/core/delivery/index.js";
import { createStateSink } from "../../src/core/state/index.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import type { Consumer, StatusSnapshot, Store, TestFileRef } from "../../src/core/types/index.js";
import { knownFailuresLine, statusText } from "../../src/harness/shared/text.js";
import { fixedStatus } from "../delivery/fakes.js";
import { check, result } from "../state/helpers.js";
import { appendRevisions, type FakeRepo, fakeRepo, seedStore } from "./helpers.js";

/*
 * Task 011-15, spec 011 C6 as amended 2026-10-18 (gh-34): `Known failures`
 * counts only current failures; pending and stale ones are named on the line
 * after it, the same on status, the registration header and Stop, with
 * `knownFailureCounts` in `status --json`. A same-key forced re-run of a
 * current failure leaves it current (C5).
 */

const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);
const NONE = { checkpointId: null };
const EARLIER = "Earlier failures: 2 pending rerun, 1 stale (not counted until a rerun fails)";
/** Row 011-26 (gh-45): what is not current; `current`'s same-key re-run queues its file. */
const NOT_CURRENT =
  "; not current: 4 of 4 test files (3 queued, 1 stale), 3 tests (2 queued, 1 stale)";

const file = (name: string): TestFileRef => ({ project: "", path: `src/${name}.test.ts` });

/**
 * The research's `mixed` store, through the state sink: `current` failed at
 * its file's key and is queued for a same-key forced re-run; `pendingA` and
 * `pendingB` failed under a key their file left, with the new key queued;
 * `stale` failed under a key its file left, with nothing queued.
 */
function seedMixed(store: Store, repo: FakeRepo): string {
  const wt = repo.mainId;
  store.worktrees.upsert({
    id: wt,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  appendRevisions(store, wt, 2, { head: null, dirty: true });
  const sink = createStateSink(store);
  const names = ["current", "pendingA", "pendingB", "stale"];
  const setKeys = (key: (name: string) => string, pending: (name: string) => boolean) =>
    store.testFileKeys.upsertMany(
      names.map((name) => ({
        worktreeId: wt,
        testFile: file(name),
        key: key(name),
        revision: 1,
        pending: pending(name) ? ("queued" as const) : null,
      })),
    );
  setKeys(
    (name) => `k1-${name}`,
    () => false,
  );
  const results = names.map((name) =>
    result(check(name, file(name)), "fail", { key: `k1-${name}`, worktreeId: wt, revision: 1 }),
  );
  store.results.putMany(results);
  sink.applyResults(wt, 1, results, NONE);
  setKeys(
    (name) => (name === "current" ? `k1-${name}` : `k2-${name}`),
    (name) => name !== "stale",
  );
  sink.refresh(wt, 2, NONE);
  return wt;
}

function snapshotOf(repo: FakeRepo): StatusSnapshot {
  const status = readStatus(repo.main, { now: () => NOW });
  if (!status.available) throw new Error(status.message);
  return status;
}

describe("known failures by validity (task 011-15)", () => {
  it("keeps a current failure current while its same-key forced re-run is queued", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const wt = seedMixed(store, repo);
    const validity = Object.fromEntries(
      store.knownStates.list(wt).map((s) => [s.check.testPath, s.validity]),
    );
    expect(validity).toEqual({
      "src/current.test.ts": "current",
      "src/pendingA.test.ts": "pending",
      "src/pendingB.test.ts": "pending",
      "src/stale.test.ts": "stale",
    });
  });

  it("counts current failures only in status, plain and JSON", () => {
    const repo = fakeRepo();
    seedMixed(seedStore(repo), repo);
    const snapshot = snapshotOf(repo);
    expect(snapshot.knownFailureCounts).toEqual({ current: 1, pending: 2, stale: 1 });
    expect(snapshot.knownFailures).toHaveLength(4);
    const lines = formatStatus(snapshot, NOW).split("\n");
    expect(lines.slice(1, 4)).toEqual([
      `Known failures: 1 (1 test)${NOT_CURRENT}`,
      EARLIER,
      "  FAIL  src/current.test.ts > current",
    ]);
    // Each earlier failure stays listed, naming its validity.
    expect(lines.filter((line) => line.endsWith("observed at revision 1, pending"))).toHaveLength(
      2,
    );
    expect(lines.filter((line) => line.endsWith("observed at revision 1, stale"))).toHaveLength(1);
  });

  it("ends a wait's verdict line with the same current-only count (review 011 wave 2, S2)", () => {
    const repo = fakeRepo();
    seedMixed(seedStore(repo), repo);
    const wait = { outcome: "no-daemon", result: snapshotOf(repo) } as unknown as EndedWait;
    expect(waitLine(wait)).toContain(". Worktree: known failures 1 (1 test);");
  });

  it("gives the registration header the same count and words", async () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const wt = seedMixed(store, repo);
    const delivery = createDelivery(store, { status: fixedStatus() });
    const consumer: Consumer = { worktreeId: wt, sessionId: "s1", agentId: "main" };
    const text = formatRegistration(await delivery.register(consumer), undefined, "squeal", NOW);
    expect(text).toContain(`\nKnown failures: 1 (1 test)${NOT_CURRENT}\n${EARLIER}\n`);
    expect(text).toContain("FAIL  src/stale.test.ts > stale");
  });

  it("gives Stop's known-failures line the same count and words", () => {
    const repo = fakeRepo();
    const store = seedStore(repo);
    const wt = seedMixed(store, repo);
    const failing = store.knownStates.list(wt).filter((s) => s.outcome === "fail");
    expect(knownFailuresLine(failing)).toBe(
      `Known failures: 1 (src/current.test.ts > current)\n${EARLIER}`,
    );
    const snapshot = snapshotOf(repo);
    expect(statusText(snapshot, snapshot.knownFailures).split("\n").slice(-2)).toEqual([
      `Known failures: 1 (src/current.test.ts > current)${NOT_CURRENT}`,
      EARLIER,
    ]);
  });
});
