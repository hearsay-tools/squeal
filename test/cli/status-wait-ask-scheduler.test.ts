import { describe, expect, it } from "vitest";
import type { SyncState } from "../../src/cli/status-sync.js";
import { askNamedRuns } from "../../src/cli/status-wait-ask-store.js";
import { namedWaitCommand } from "../../src/cli/status-wait-paths.js";
import { readRetries } from "../../src/core/retry/index.js";
import type { EpochMs, RevisionNumber } from "../../src/core/types/index.js";
import { type CatchUpSide, catchUpRepo, catchUpSide } from "../scheduler/catch-up-fixture.js";
import { capture } from "./status-wait-focus-fixture.js";

/*
 * Row 011-207 (gh-82): the issue's sequence on a real scheduler. Another
 * worktree's run passes F; this worktree's lookup-only start inherits it;
 * F's import changes while no daemon runs, so the next lookup-only start
 * leaves F stale with nothing queued. One named wait asks F's run, the
 * scheduler runs it, and the wait gives its verdict, exit 0.
 */

const F = "test/f.test.ts";
const SOURCE = "src/f.ts";
const files = [{ path: F, ms: 1, imports: [SOURCE] }];
const LOOKUP_ONLY = { baseline: { onStart: "lookup-only" as const } };

/** A named wait on `paths` against `side`'s scheduler, as the CLI and the daemon's socket would do it. */
async function wait(side: CatchUpSide, paths: readonly string[]) {
  const revision = side.store.revisions.latest(side.worktreeId as never)?.number ?? 0;
  const synced = (): SyncState => ({
    state: "synced",
    revision: revision as RevisionNumber,
    incarnation: null,
  });
  const io = capture(side.root);
  const code = await namedWaitCommand(paths, { json: true }, io, {
    timeoutMs: 30_000,
    pollMs: 20,
    settleMs: 100,
    now: () => Date.now() as EpochMs,
    sync: () => ({ current: synced, stop: () => {} }),
    promote: (_root, refs, withinMs) => void side.scheduler.promote(refs, withinMs),
    ask: async (root, asks, asker, withinMs, now) => {
      const runs = await askNamedRuns(root, asks, asker, withinMs, now);
      // The `retry` request the daemon's socket takes.
      await side.scheduler.requestRetries();
      return runs;
    },
    asker: "s1",
  });
  return { code, selection: JSON.parse(io.out.join("")).selection, err: io.err.join("") };
}

describe("gh-82 on a real scheduler (row 011-207)", { timeout: 60_000 }, () => {
  it("an inherited pass made stale with nothing queued: one wait runs it and exits 0", async () => {
    const repo = catchUpRepo(files);
    const other = catchUpSide(repo, repo.other, {
      files,
      hostSlots: 2,
      policy: { baseline: { onStart: "lookup-then-run-missing" } },
    });
    await other.scheduler.start();
    await other.scheduler.idle();
    expect(other.current(F)).toBe(true);

    const first = catchUpSide(repo, repo.main, { files, hostSlots: 2, policy: LOOKUP_ONLY });
    await first.scheduler.start();
    await first.scheduler.idle();
    expect(first.current(F)).toBe(true);
    expect(first.runner.runs).toEqual([]);
    await first.scheduler.close();

    // F's import changes while no daemon runs; the next start is lookup-only too.
    first.touch(SOURCE);
    const side = catchUpSide(repo, repo.main, { files, hostSlots: 2, policy: LOOKUP_ONLY });
    await side.scheduler.start();
    await side.scheduler.idle();
    const [row] = side.store.testFileKeys.list(side.worktreeId as never);
    expect(row).toMatchObject({ pending: null });
    const states = side.store.knownStates.list(side.worktreeId as never);
    expect(states.length).toBeGreaterThan(0);
    expect(states.every((s) => s.validity === "stale")).toBe(true);

    const { code, selection, err } = await wait(side, [F]);

    expect(code).toBe(0);
    expect(selection).toMatchObject({ outcome: "settled", result: "pass" });
    expect(selection.asked).toMatchObject([{ path: F, pending: false, outcome: "passed" }]);
    expect(err).toContain(`Run asked: ${F} was stale with nothing queued`);
    expect(side.runner.runs).toHaveLength(1);
    expect(readRetries(side.store)).toMatchObject([{ key: row?.key, end: { outcome: "passed" } }]);

    // A second wait at the same key finds F current and asks nothing.
    const again = await wait(side, [F]);
    expect(again.code).toBe(0);
    expect(again.selection.asked).toBeUndefined();
    expect(side.runner.runs).toHaveLength(1);
    expect(readRetries(side.store)).toHaveLength(1);
  });
});
