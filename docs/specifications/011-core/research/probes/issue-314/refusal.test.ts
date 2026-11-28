// Throwaway research probe, not part of the repository's test suite.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { heldPermits } from "../../../../../../src/core/slow/slot.js";
import { readGroupActivity } from "../../../../../../src/core/slow/state.js";
import { setup } from "../../../../../../test/runner-host/remote/lane-fixture.js";
import { catchUpRepo, catchUpSide } from "../../../../../../test/scheduler/catch-up-fixture.js";
import { groupPolicy, runnerLane } from "../../../../../../test/scheduler/group-lanes-fixture.js";

it("a real ignored-input refusal releases browser's one slot before the next named request", async () => {
  const first = "test/a.test.ts";
  const second = "test/b.test.ts";
  const remote = await setup({
    whenLost: "not-run",
    lanes: ["group"],
    files: { ".gitignore": "ignored.js\n", "ignored.js": "export const input = 1;\n" },
    closure: (file) => [file.path, "src/a.ts", "ignored.js"],
  });
  const files = [first, second].map((path) => ({ path, ms: 1, imports: ["src/core.ts"] }));
  const repo = catchUpRepo(files);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-issue-314-slot-"));
  onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
  const attempts: string[] = [];
  const failures: (string | null)[] = [];
  const side = catchUpSide(repo, repo.main, {
    files,
    hostSlots: 2,
    tierSize: 1,
    lane: runnerLane,
    policy: groupPolicy({ checks: [{
      name: "browser", runner: "vitest", tests: ["test/**"], at: "manual",
      limits: { maxParallel: 1, maxWorkers: 1, priority: "low" },
    }] }),
    scheduler: { slow: { slotDir, recheckMs: 25, load: () => [0], cpus: () => 1 } },
    wrapRunner: (runner) => {
      const original = runner.run.bind(runner);
      runner.run = async (refs, options) => {
        attempts.push(refs.map((ref) => ref.path).join(","));
        expect(heldPermits({ dir: slotDir, group: "browser", permits: 1 })).toHaveLength(1);
        if (refs[0]?.path !== first) return original(refs, options);
        const report = await remote.lane.run(refs, options);
        failures.push(report.failure);
        return report;
      };
      return runner;
    },
  });
  await side.scheduler.start();
  await side.rest();
  await side.scheduler.requestGroupPaths?.("browser", [first]);
  await expect.poll(() => failures.length).toBe(1);
  await side.rest();
  expect(failures[0]).toContain("git-ignored input ignored.js exists locally and is not synced to remote");
  expect(remote.remoteRuns).toEqual([]);
  expect(remote.localRuns).toEqual([]);
  expect(heldPermits({ dir: slotDir, group: "browser", permits: 1 })).toEqual([]);
  console.log(JSON.stringify({ afterRefusal: {
    attempts, failure: failures[0], heldPermits: 0,
    activity: readGroupActivity(side.store, side.worktreeId, "browser"),
    remoteRuns: remote.remoteRuns.length, localFallbackRuns: remote.localRuns.length,
  } }));
  await side.scheduler.requestGroupPaths?.("browser", [second]);
  await expect.poll(() => side.current(second)).toBe(true);
  await side.rest();
  expect(attempts).toEqual([first, second]);
  expect(heldPermits({ dir: slotDir, group: "browser", permits: 1 })).toEqual([]);
  console.log(JSON.stringify({ afterNextRequest: { attempts, secondCurrent: true, heldPermits: 0 } }));
});
