import { describe, expect, it } from "vitest";
import { namedWaitCommand } from "../../src/cli/named-print.js";
import type { SyncState } from "../../src/cli/status-sync.js";
import type { EpochMs, RevisionNumber } from "../../src/core/types/index.js";
import { catchUpRepo, catchUpSide } from "../scheduler/catch-up-fixture.js";
import { focus, focusedRows, focusing } from "../scheduler/focused-fixture.js";
import { capture } from "./status-wait-focus-fixture.js";

/*
 * Row 011-283 (011-273 option B, finding F4; gh-123 in part): a `--check`
 * wait over 24 files that nothing queues, as a lookup-only start leaves
 * them, settles before its deadline with every focused outcome: the
 * focused row keeps each file the open wait selected. On 0.1.374 such a
 * wait lost four outcomes to the 20-file cap and exited at its deadline
 * (`research/issue-123.md` F3).
 */

const PATHS = Array.from(
  { length: 24 },
  (_, i) => `test/rows-${String(i).padStart(2, "0")}.test.ts`,
);
const FILES = PATHS.map((path) => ({ path, ms: 1, imports: [] }));

describe("a focused wait over 24 files (row 011-283, test 5)", { timeout: 60_000 }, () => {
  it("settles before its deadline with all 24 outcomes", async () => {
    const repo = catchUpRepo(FILES);
    const side = catchUpSide(repo, repo.main, {
      files: FILES,
      hostSlots: 2,
      policy: { baseline: { onStart: "lookup-only" } },
    });
    focusing(side);
    await side.scheduler.start();
    await side.scheduler.idle();
    expect(side.runner.runs).toEqual([]);
    const revision = side.store.revisions.latest(side.worktreeId as never)?.number ?? 0;
    const synced = (): SyncState => ({
      state: "synced",
      revision: revision as RevisionNumber,
      incarnation: null,
    });
    const io = capture(side.root);
    const started = Date.now();

    const code = await namedWaitCommand(PATHS, { json: true, checks: ["runs"] }, io, {
      timeoutMs: 20_000,
      pollMs: 20,
      settleMs: 100,
      now: () => Date.now() as EpochMs,
      sync: () => ({ current: synced, stop: () => {} }),
      promote: (_root, refs, withinMs) => void side.scheduler.promote(refs, withinMs),
      focus: async (_root, refs, texts, withinMs) => {
        await focus(side, refs, texts, withinMs);
        return "accepted";
      },
    });

    expect(JSON.parse(io.out.join("")).selection.outcome).toBe("focused");
    expect(code).toBe(3);
    expect(Date.now() - started).toBeLessThan(20_000);
    expect(
      focusedRows(side)
        .map((r) => r.testFile.path)
        .sort(),
    ).toEqual(PATHS);
  });
});
