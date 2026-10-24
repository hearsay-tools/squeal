import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codeStorePath, pruneCodeStoreAfter } from "../../../src/core/code/store/index.js";
import { DEFAULT_POLICY } from "../../../src/core/types/index.js";
import {
  DAY_MS,
  fakeCommonDir,
  open as openMain,
  result,
  tempDir,
  testCheck,
  worktree,
} from "../../store/helpers.js";
import { count, ON, open } from "../helpers.js";

/*
 * Spec 015 D4 and D8, 011 C7 (row 015-11): the daemon prunes the code store
 * after the main store, with what the main store still names. Wave 0 left
 * the code store unpruned: its prune had no caller.
 */

const NOW = 100 * DAY_MS;
const RECORD = new Uint8Array([1]);
const at = (resultKey: string) => ({ resultKey, providerVersion: 1 });

describe("the code store's prune after the main store's", () => {
  it("drops a coverage record with its result, and a count nothing uses past the retention", () => {
    const commonDir = fakeCommonDir();
    const main = openMain(commonDir);
    // A linked worktree: the main checkout's newest result per check is kept whatever its age.
    const root = tempDir();
    writeFileSync(join(root, ".git"), `gitdir: ${commonDir}/worktrees/w1\n`);
    main.worktrees.upsert(worktree("w1", root, { commonDir }));
    main.results.putMany([
      result(testCheck("kept"), "k-kept", { worktreeId: "w1", recordedAt: NOW - DAY_MS }),
      result(testCheck("old"), "k-old", { worktreeId: "w1", recordedAt: NOW - 30 * DAY_MS }),
    ]);
    const code = open(commonDir);
    code.coverage.put(at("k-kept"), RECORD, NOW - 30 * DAY_MS);
    code.coverage.put(at("k-old"), RECORD, NOW - DAY_MS);
    code.counts.put(count("unused"), NOW - 30 * DAY_MS);

    // The main store's prune takes the old result; the code store's follows it.
    main.prune({ now: NOW, retentionDays: 7, maxSizeMb: null });
    const report = pruneCodeStoreAfter(main, commonDir, ON, NOW);

    expect(main.results.byKey("k-old", 0)).toEqual([]);
    expect(report).toMatchObject({ coverageRemoved: 1, countsRemoved: 1 });
    expect(code.coverage.get(at("k-kept"))).toEqual(RECORD);
    expect(code.coverage.get(at("k-old"))).toBeNull();
    expect(code.counts.get("unused", "typescript", 1)).toBeNull();
  });

  it("opens and creates nothing while complexity is off or no code store exists", () => {
    const commonDir = fakeCommonDir();
    const main = openMain(commonDir);

    expect(pruneCodeStoreAfter(main, commonDir, ON, NOW)).toBeNull();
    expect(pruneCodeStoreAfter(main, commonDir, DEFAULT_POLICY, NOW)).toBeNull();
    expect(existsSync(codeStorePath(commonDir))).toBe(false);
  });
});
