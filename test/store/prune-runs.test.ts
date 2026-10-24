import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { storePaths } from "../../src/core/store/index.js";
import { REPLACED_META_KEY } from "../../src/core/store/repos/replaced.js";
import { DAY_MS, fakeCommonDir, open, result, tempDir, testCheck, worktree } from "./helpers.js";

/*
 * Spec 001 D8 as amended 2026-10-23 (row 011-160) and quality 2026-10-24
 * slice 7: prune drops a run that no result, kept replaced failure or
 * standing UNKNOWN names, when its worktree is gone or it ended before the
 * cutoff, with its log. Each case below is one part of that rule, in a live
 * and in a removed worktree.
 */

const NOW = 100 * DAY_MS;
const ago = (days: number) => NOW - days * DAY_MS;

interface RunCase {
  readonly id: string;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly named: "result" | "replaced" | null;
}

const CASES: readonly RunCase[] = [
  { id: "old", startedAt: ago(10), endedAt: ago(10), named: null },
  { id: "boundary", startedAt: ago(8), endedAt: ago(7), named: null },
  { id: "recent", startedAt: ago(1), endedAt: ago(1), named: null },
  { id: "running", startedAt: ago(20), endedAt: null, named: null },
  { id: "result", startedAt: ago(10), endedAt: ago(10), named: "result" },
  { id: "replaced", startedAt: ago(10), endedAt: ago(10), named: "replaced" },
];

/** The rule as D8 states it, for a run of a live worktree or of a removed one. */
function goes(c: RunCase, live: boolean): boolean {
  if (c.named !== null) return false;
  return !live || (c.endedAt !== null && c.endedAt < ago(7));
}

describe("prune's runs (spec 001 D8, quality 2026-10-24 slice 7)", () => {
  it("drops each unnamed run of a removed worktree and each unnamed run a live one ended before the cutoff, with its log", () => {
    const commonDir = fakeCommonDir();
    const store = open(commonDir);
    const runsDir = storePaths(commonDir).runsDir;
    const linkedRoot = tempDir();
    writeFileSync(join(linkedRoot, ".git"), `gitdir: ${commonDir}/worktrees/linked\n`);
    const removedRoot = tempDir();
    writeFileSync(join(removedRoot, ".git"), `gitdir: ${commonDir}/worktrees/removed\n`);
    store.worktrees.upsert(worktree("main", dirname(commonDir), { isMain: true, commonDir }));
    store.worktrees.upsert(worktree("linked", linkedRoot, { commonDir }));
    store.worktrees.upsert(worktree("removed", removedRoot, { commonDir }));
    rmSync(removedRoot, { recursive: true });

    const replaced: unknown[] = [];
    for (const worktreeId of ["linked", "removed"]) {
      for (const c of CASES) {
        const id = `${worktreeId}-${c.id}`;
        mkdirSync(join(runsDir, id), { recursive: true });
        store.runs.start({
          id,
          worktreeId,
          revision: 1,
          testFiles: [],
          checkpointId: null,
          logDir: join(runsDir, id),
          startedAt: c.startedAt,
        });
        if (c.endedAt !== null) store.runs.finish(id, "completed", c.endedAt);
        // A recent result outlives the cutoff, so the run it names stays.
        if (c.named === "result") {
          store.results.putMany([
            result(testCheck(id), `k-${id}`, { worktreeId, recordedAt: ago(1), runId: id }),
          ]);
        }
        if (c.named === "replaced") {
          replaced.push({
            check: testCheck(id),
            key: `k-${id}`,
            provenance: { runId: id, worktreeId, revision: 1, recordedAt: ago(1) },
            durationMs: 1,
            failureId: null,
            loadPerCpu: null,
            replacedBy: { runId: "later", worktreeId, recordedAt: ago(1) },
          });
        }
      }
    }
    store.meta.set(REPLACED_META_KEY, JSON.stringify(replaced));

    const report = store.prune({ now: NOW, retentionDays: 7, maxSizeMb: null });

    const all = ["linked", "removed"].flatMap((worktreeId) =>
      CASES.map((c) => ({ id: `${worktreeId}-${c.id}`, goes: goes(c, worktreeId === "linked") })),
    );
    const gone = all.filter((r) => r.goes).map((r) => r.id);
    expect(gone).toEqual([
      "linked-old",
      "removed-old",
      "removed-boundary",
      "removed-recent",
      "removed-running",
    ]);
    expect(report.runsRemoved).toBe(gone.length);
    expect(all.filter((r) => store.runs.get(r.id) === null).map((r) => r.id)).toEqual(gone);
    expect(all.filter((r) => !existsSync(join(runsDir, r.id))).map((r) => r.id)).toEqual(gone);
  });
});
