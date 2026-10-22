import { describe, expect, it } from "vitest";
import { pendingRetriesOf } from "../../src/core/retry/pending.js";
import type { RunRecord, TestFileRef } from "../../src/core/types/index.js";
import { SLOW } from "./helpers.js";
import { type Entry, type ReloadRepo, reloadRepo, touch } from "./reload-projects-kit.js";

/*
 * Row 011-78 (011 C10, *Projects at a reload*; `tasks/011-62/design.md` R1,
 * tests 5 and 7), through a real daemon with node:test projects: a removed
 * project's run in flight is stopped as `squeal stop` stops one and stores
 * nothing, a changed project's finishes, and a removed project's pending
 * retry is released.
 */

const KEEP: Entry = { name: "keep", cwd: "keep", env: { MODE: "a" } };
const KEEP_FILE = "keep/keep.test.mjs";
/** Long past any reload: a held file that ends before it was stopped. */
const HELD_MS = 60_000;

/** The daemon's run in flight that holds `file` and started after `since`. */
function runOf(repo: ReloadRepo, file: TestFileRef, since: number): RunRecord | undefined {
  return repo.store((store) =>
    store.runs
      .inFlight(repo.worktreeId, since)
      .find((run) => run.testFiles.some((f) => f.project === file.project && f.path === file.path)),
  );
}

describe("a reload and the runs in flight (row 011-78)", SLOW, () => {
  it("stops a removed project's file in flight, stores nothing of it and stores the kept file of its tier", async () => {
    const SLOW_FILE = { project: "slow", path: "slow/slow.test.mjs" };
    const repo = await reloadRepo([KEEP, { name: "slow", cwd: "slow" }], {
      [KEEP_FILE]: { name: "keep", body: { mode: "a" } },
      [SLOW_FILE.path]: { name: "slow", body: { heldMs: HELD_MS } },
    });
    await repo.ran("the baseline", 2);
    const since = Date.now();

    // One edit of both: one tier of the node:test lane, keep's part first, slow's held.
    repo.hold(true);
    touch(repo, KEEP_FILE);
    touch(repo, SLOW_FILE.path);
    await repo.until("slow's run started", () => repo.logged("slow started"));
    const running = runOf(repo, SLOW_FILE, since);
    const key = repo.row(SLOW_FILE.path)?.key ?? null;
    expect(running?.testFiles).toContainEqual({ project: "keep", path: KEEP_FILE });

    const removedAt = Date.now();
    repo.config([KEEP]);
    await repo.until("the tier ended", () => {
      const run = running === undefined ? null : repo.store((s) => s.runs.get(running.id));
      return run?.endedAt != null;
    });
    // Stopped: the held test never logged its end, long before its sleep could end.
    expect(Date.now() - removedAt).toBeLessThan(HELD_MS / 2);
    expect(repo.logged("slow done")).toBe(false);
    await repo.until("slow forgotten", () => repo.row(SLOW_FILE.path) === undefined);
    expect(repo.states("slow")).toEqual([]);
    expect(key === null ? [] : repo.store((s) => s.results.byKey(key))).toEqual([]);
    // keep's part of the same tier was stored, current.
    await repo.settle();
    expect(repo.states("keep").map((s) => [s.outcome, s.validity])).toEqual([
      ["pass", "current"],
      ["pass", "current"],
    ]);
    const kept = repo.row(KEEP_FILE)?.key ?? null;
    const runs = repo.store((s) => s.results.byKey(kept).map((r) => r.provenance.runId));
    expect(new Set(runs)).toEqual(new Set([running?.id]));
  });

  it("lets a changed project's file in flight finish, then runs it at its new key", async () => {
    const repo = await reloadRepo([KEEP], {
      [KEEP_FILE]: { name: "keep", body: { mode: "a", heldMs: 3_000 } },
    });
    await repo.ran("the baseline", 1);
    const before = repo.row(KEEP_FILE)?.key;

    repo.hold(true);
    touch(repo, KEEP_FILE);
    await repo.until("keep's run started", () => repo.logged("keep started"));
    repo.config([{ ...KEEP, env: { MODE: "b" } }]);
    await repo.until("keep's run finished", () => repo.logged("keep done"));
    repo.hold(false);
    // Its new key, under which the test asserts MODE a and fails: it ran again.
    await repo.until("keep fails at its new key", () =>
      repo.states("keep").some((s) => s.outcome === "fail" && s.validity === "current"),
    );
    expect(repo.row(KEEP_FILE)?.key).not.toBe(before);
    expect(repo.runs("keep")).toBeGreaterThanOrEqual(3);
  });

  it("releases a removed project's pending retry, and status lists none", async () => {
    const GONE_FILE = "gone/gone.test.mjs";
    const repo = await reloadRepo([KEEP, { name: "gone", cwd: "gone" }], {
      [KEEP_FILE]: { name: "keep", body: { mode: "a" } },
      [GONE_FILE]: { name: "gone", body: { fail: true, heldMs: HELD_MS } },
    });
    await repo.until("gone's new failure re-ran", () => repo.runs("gone") === 2);
    await repo.ran("the baseline", 2);

    repo.hold(true);
    expect((await repo.retry(GONE_FILE)).code).toBe(0);
    await repo.until("the retry runs", () => repo.logged("gone started"));
    const pending = () =>
      repo.store((store) => pendingRetriesOf(store, store.testFileKeys.list(repo.worktreeId)));
    expect(pending().pendingRetries?.retries).toMatchObject([
      { testFile: { project: "gone", path: GONE_FILE } },
    ]);

    repo.config([KEEP]);
    await repo.until("gone forgotten", () => repo.row(GONE_FILE) === undefined);
    expect(pending()).toEqual({});
    expect(repo.logged("gone done")).toBe(false);
  });
});
