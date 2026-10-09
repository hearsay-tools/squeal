import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSlowArtifacts } from "../../src/core/slow/state.js";
import { DEFAULT_POLICY } from "../../src/core/types/index.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Spec 004 D5, D8, review wave 2 B2: a slow run records the artifact its
 * file was declared to test under the key its results are stored at, in the
 * transaction that stores them; a fast run's results carry no record. In
 * the `basic` fixture `test/strings.test.ts` is marked slow.
 */

const STRINGS = "test/strings.test.ts";
const MATH = "test/math.test.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("a slow run's recorded artifact (review wave 2, B2)", SLOW, () => {
  it("is the declaration the run had, under its key, and no fast run's", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const slotDir = mkdtempSync(join(tmpdir(), "squeal-004-23-slot-"));
    dirs.push(slotDir);
    const h = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 4,
      policy: {
        slow: { ...DEFAULT_POLICY.slow, include: [STRINGS] },
        inputs: { "test/strings.test.ts": ["src/gen/**"] },
      },
      slow: { slotDir, recheckMs: 50, load: () => [0], cpus: () => 1 },
    });
    await h.scheduler.start();
    await expect.poll(() => h.runsOf(STRINGS).length, { timeout: 60_000 }).toBe(1);
    await h.scheduler.idle();
    const key = h.keyOf(STRINGS);
    expect(key).not.toBeNull();
    const records = readSlowArtifacts(store, h.worktreeId);
    expect(records.get(key ?? "")).toEqual(["src/gen/**"]);
    expect(records.has(h.keyOf(MATH) ?? "")).toBe(false);
    expect([...records.keys()]).toEqual([key]);
  });
});
