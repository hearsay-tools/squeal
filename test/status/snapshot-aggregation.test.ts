import { describe, expect, it, vi } from "vitest";
import { readVerdict } from "../../src/cli/verdict.js";
import { type WorktreeStates, worktreeStatesOf } from "../../src/core/state/file-class.js";
import { formatStatus } from "../../src/core/status/format-status.js";

import { buildSnapshotWithReads } from "../../src/core/status/snapshot.js";
import { readNamedFiles } from "../../src/core/status/standing.js";
import {
  importCountsByFile,
  importCountsOf,
  readWorktreeStates,
} from "../../src/core/store/status-reads.js";
import type { LoadNow } from "../../src/core/types/standing.js";
import type { Store } from "../../src/core/types/store.js";
import { NAMES, NOW, type Scenario, scenario } from "./snapshot-aggregation-fixture.js";

/*
 * Row 025-11 (spec 025 D11): status counts a worktree's known states by SQL
 * (`readWorktreeStates`, `importCountsByFile`), never a `KnownState` per
 * check. Its snapshot, text, verdict and named files are the ones the same
 * counts made from every state (`knownStates.list`) give, byte for byte, in
 * every scenario; and no read lists every state of the worktree.
 */

/** Whether status's reads count from `knownStates.list`, the reference, instead of by SQL. */
const mode = vi.hoisted(() => ({ reference: false }));

vi.mock("../../src/core/store/status-reads.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/core/store/status-reads.js")>();
  const { worktreeStatesOf: fromList } = await import("../../src/core/state/file-class.js");
  return {
    ...actual,
    readWorktreeStates: ((store, id) =>
      mode.reference
        ? fromList(store.knownStates.list(id))
        : actual.readWorktreeStates(store, id)) as typeof actual.readWorktreeStates,
    importCountsByFile: ((store, id) =>
      mode.reference
        ? actual.importCountsOf(store.knownStates.list(id))
        : actual.importCountsByFile(store, id)) as typeof actual.importCountsByFile,
  };
});

const LOAD = (): LoadNow => ({ oneMinute: 1.5, cpus: 8 });

/** `states` with its groups merged and sorted and its files in id order, to compare. */
function normal(states: WorktreeStates) {
  const groups = new Map<string, number>();
  for (const g of states.groups) {
    const origin = g.origin === null ? null : Object.entries(g.origin).sort();
    const id = JSON.stringify([g.kind, g.validity, g.outcome, origin]);
    groups.set(id, (groups.get(id) ?? 0) + g.count);
  }
  return {
    groups: [...groups].sort(([a], [b]) => a.localeCompare(b)),
    files: [...states.files].sort(([a], [b]) => a.localeCompare(b)),
    notable: states.notable,
  };
}

/** Everything status, a named wait and a verdict read of the scenario's worktree. */
function everything({ repo, store }: Scenario) {
  const { snapshot, reads } = buildSnapshotWithReads(store, repo.main, NOW, LOAD);
  const files = reads.keys.map((row) => row.testFile);
  const named = readNamedFiles(
    store,
    repo.mainId,
    repo.main,
    files,
    snapshot.daemon,
    NOW,
    LOAD,
    reads,
  );
  return {
    json: JSON.stringify(snapshot, null, 1),
    text: formatStatus(snapshot, NOW),
    verdict: JSON.stringify(readVerdict(store, repo.mainId, null, false, reads)),
    verdictRead: JSON.stringify(readVerdict(store, repo.mainId, null)),
    named: JSON.stringify(named),
    namedRead: JSON.stringify(
      readNamedFiles(store, repo.mainId, repo.main, files, snapshot.daemon, NOW, LOAD),
    ),
  };
}

/** `store` whose whole-worktree `knownStates.list` calls are counted. */
function counted(store: Store): { readonly whole: number } {
  const count = { whole: 0 };
  const list = store.knownStates.list;
  store.knownStates.list = (worktreeId, files) => {
    if (files === undefined) count.whole++;
    return list(worktreeId, files);
  };
  return count;
}

describe.each(NAMES)("status's known states by SQL, %s (row 025-11)", (name) => {
  it("are those counted from every state", () => {
    const s = scenario(name);
    const id = s.repo.mainId;
    const list = s.store.knownStates.list(id);

    expect(normal(readWorktreeStates(s.store, id))).toEqual(normal(worktreeStatesOf(list)));
    const sql = importCountsByFile(s.store, id);
    const reference = importCountsOf(list);
    for (const file of worktreeStatesOf(list).files.keys()) {
      expect(sql.current(file), file).toBe(reference.current(file));
      expect([...sql.fromImport(file)].sort(), file).toEqual(
        [...reference.fromImport(file)].sort(),
      );
    }
  });

  it("give the snapshot, its text, the verdict and the named files byte for byte", () => {
    const s = scenario(name);
    const sql = everything(s);
    mode.reference = true;
    try {
      expect(sql).toEqual(everything(s));
    } finally {
      mode.reference = false;
    }
  });

  it("list no worktree's every state, for status, a verdict or the named files", () => {
    const s = scenario(name);
    const count = counted(s.store);

    everything(s);

    expect(count.whole).toBe(0);
  });
});

describe("the scenarios (row 025-11)", () => {
  it("hold every kind of state the counts read", () => {
    const s = scenario("check groups");
    const { snapshot } = buildSnapshotWithReads(s.store, s.repo.main, NOW, LOAD);

    expect(snapshot.counts).toMatchObject({
      current: expect.any(Number),
      pending: expect.any(Number),
      stale: expect.any(Number),
      unknown: expect.any(Number),
    });
    for (const n of Object.values(snapshot.counts)) expect(n).toBeGreaterThan(0);
    expect(snapshot.knownFailures.map((f) => f.check.kind).sort()).toEqual([
      "file",
      "setup",
      "setup",
      "test",
    ]);
    expect(snapshot.inherited.sources.length).toBeGreaterThan(2);
    expect(snapshot.breakdown.pendingByPhase.running).toBeGreaterThan(0);
    expect(snapshot.breakdown.testFilesWithoutChecks).toBeGreaterThan(0);
    expect(snapshot.unknownTestFiles?.total).toBeGreaterThan(0);
    expect(snapshot.groupTiers?.length).toBe(2);
    expect(snapshot.holds?.length).toBe(1);
    expect(snapshot.pendingRetries?.retries.length).toBe(2);

    const imported = scenario("imported");
    const read = buildSnapshotWithReads(imported.store, imported.repo.main, NOW, LOAD).snapshot;
    expect(read.imports?.map((i) => i.currentResults).sort()).toEqual([1, 4]);
    expect(read.importedCount).toBe(5);
  });

  it("decode no state of a worktree whose checks pass, though every one is pending", () => {
    const s = scenario("all current");
    const id = s.repo.mainId;
    const pending = s.store.knownStates.list(id).map((state) => ({
      ...state,
      validity: "pending" as const,
      pendingPhase: "queued" as const,
    }));
    s.store.knownStates.upsertMany(pending);

    const states = readWorktreeStates(s.store, id);

    expect(states.notable).toEqual([]);
    expect([...states.files.values()].map((f) => f.pending.test.queued)).toEqual([2, 2, 2]);
  });
});
