import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { joinSpan, SHARE_FLOOR_MS, SHARE_RATIO } from "../../src/core/scheduler/sharing.js";
import type { Store, WorktreeId } from "../../src/core/types/index.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Lessons, defect 31 (001-172): a tier stores its results when it ends, so on
 * cezar a 20 ms edited file waited 187 s, and a 0.5 s file 113 s, for slow
 * files in the same tier. D5 step 5 as amended (task 001-184): an edit's tier
 * takes a file only beside files of a comparable last-known time.
 *
 * Fixture `basic`, plus `test/held.test.ts`: it imports `src/math.ts` like
 * `test/math.test.ts`, so one edit reaches both. Without the hold marker it
 * sleeps, which gives it a last-known time far above math's; with it, its
 * worker waits until the marker goes.
 */

const HELD = "test/held.test.ts";
const MATH = "test/math.test.ts";
const BASELINE_SLEEP_MS = 3_000;

function heldTest(hold: string, started: string): string {
  return [
    'import { existsSync, writeFileSync } from "node:fs";',
    'import { setTimeout as delay } from "node:timers/promises";',
    'import { expect, it } from "vitest";',
    'import { add } from "../src/math.ts";',
    'it("waits while held", async () => {',
    '  expect(typeof add).toBe("function");',
    `  if (!existsSync(${JSON.stringify(hold)})) return delay(${BASELINE_SLEEP_MS});`,
    `  writeFileSync(${JSON.stringify(started)}, "");`,
    `  while (existsSync(${JSON.stringify(hold)})) await delay(20);`,
    "}, 120_000);",
    "",
  ].join("\n");
}

function outcomeOf(store: Store, worktreeId: WorktreeId, path: string): string | undefined {
  return store.knownStates
    .list(worktreeId)
    .find((s) => s.check.testPath === path && s.check.kind === "test")?.outcome;
}

const markerDirs: string[] = [];
// Before the harness's cleanup closes the adapter: removing the hold releases the worker.
afterEach(() => {
  for (const dir of markerDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("joinSpan (task 001-184)", () => {
  it("always takes the first file", () => {
    expect(joinSpan(null, 600_000)).toEqual({ fastest: 600_000, slowest: 600_000 });
    expect(joinSpan(null, null)).toEqual({ fastest: 0, slowest: 0 });
  });

  it("keeps files under the floor together, whatever their ratio", () => {
    expect(joinSpan(joinSpan(null, 1), SHARE_FLOOR_MS)).not.toBeNull();
    expect(joinSpan(joinSpan(null, 1), SHARE_FLOOR_MS + 1)).toBeNull();
  });

  it("above the floor, takes a file within the ratio of the fastest, either way round", () => {
    const fast = joinSpan(null, 2_000);
    expect(joinSpan(fast, 2_000 * SHARE_RATIO)).not.toBeNull();
    expect(joinSpan(fast, 2_000 * SHARE_RATIO + 1)).toBeNull();
    expect(joinSpan(joinSpan(null, 187_000), 20)).toBeNull();
  });

  it("counts a file of no known time as 0", () => {
    expect(joinSpan(joinSpan(null, 112_000), null)).toBeNull();
    expect(joinSpan(joinSpan(null, null), 500)).not.toBeNull();
  });
});

describe(
  "scheduler: an edited file's result beside a slow file (D5 step 5, task 001-184)",
  SLOW,
  () => {
    it("stores the fast file's result before the slow file reached by the same edit ends", async () => {
      const markers = mkdtempSync(join(tmpdir(), "squeal-001-184-"));
      markerDirs.push(markers);
      const hold = join(markers, "hold");
      const started = join(markers, "started");
      const repo = createRepo("basic");
      writeFileSync(join(repo.main, HELD), heldTest(hold, started));
      const store = openRepoStore(repo.commonDir);
      const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 4 });
      await h.scheduler.start();
      await h.scheduler.idle();
      expect(outcomeOf(store, h.worktreeId, MATH)).toBe("pass");
      expect(h.runsOf(HELD)).toHaveLength(1);

      writeFileSync(hold, "");
      h.write("src/math.ts", "export const add = (a: number, b: number) => a + b + 1;\n");
      await h.batch("src/math.ts");

      // Math's result is current while the held file's worker still waits.
      await expect.poll(() => existsSync(started), { timeout: 60_000 }).toBe(true);
      await expect
        .poll(() => outcomeOf(store, h.worktreeId, MATH), { timeout: 60_000 })
        .toBe("fail");
      expect(existsSync(hold)).toBe(true);
      const edited = h.runsOf(MATH).at(-1);
      expect(edited?.files.map((f) => f.path)).not.toContain(HELD);

      // The held file's own input moves during its run: the stability check still withholds it.
      const heldKey = h.keyOf(HELD);
      h.write("src/math.ts", "export const add = (a: number, b: number) => b + a;\n");
      await h.batch("src/math.ts");
      rmSync(hold);
      await h.scheduler.idle();

      expect(heldKey).not.toBeNull();
      if (heldKey !== null) expect(store.results.checksForKey(heldKey)).toEqual([]);
      expect(h.runsOf(HELD)).toHaveLength(3);
      expect(outcomeOf(store, h.worktreeId, MATH)).toBe("pass");
      expect(outcomeOf(store, h.worktreeId, HELD)).toBe("pass");
      expect(h.header().counts).toMatchObject({ pending: 0, stale: 0, unknown: 0 });
    });
  },
);
