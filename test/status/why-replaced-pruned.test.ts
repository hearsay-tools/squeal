import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatCheck } from "../../src/core/state/index.js";
import { formatWhy, readFailures, readWhy } from "../../src/core/status/index.js";
import { storePaths } from "../../src/core/store/index.js";
import type { CheckId, Store, WhyResult } from "../../src/core/types/index.js";
import { result } from "../store/helpers.js";
import { check, fakeRepo, seedStore } from "./helpers.js";
import { at, reportOf } from "./why-seed.js";

/*
 * Review 0.1.265 B2 (row 011-77, 011 C6 and C7): a failure a pass replaced
 * in another worktree stays kept after that worktree is removed and pruned,
 * so `why` finds it, by its printed name or a part of it, with its run's log
 * and its stack, though this worktree has no state, transition or result of
 * the check.
 */

const APPEARS = check("src/fresh.test.ts", "fresh > appears only in b");
const STACK = ["AssertionError: expected 1 to be 2", "    at src/fresh.test.ts:4:7"].join("\n");

/** `check` fails in `worktreeId` at `key` in run `runId`, with a log, then passes there a minute later. */
function flip(store: Store, logsDir: string, worktreeId: string, flipped: CheckId, key: string) {
  const runId = `fail-${key}`;
  const logDir = join(logsDir, runId);
  mkdirSync(logDir, { recursive: true });
  store.runs.start({
    id: runId,
    worktreeId,
    revision: 1,
    testFiles: [],
    checkpointId: null,
    logDir,
    startedAt: at(9, 1),
  });
  store.runs.finish(runId, "completed", at(9, 2));
  const failed = result(flipped, key, {
    outcome: "fail",
    worktreeId,
    recordedAt: at(9, 2),
    runId,
    errors: [{ name: "AssertionError", message: "boom", stack: STACK, location: null, diff: null }],
  });
  store.results.putMany([{ ...failed, summary: "expected 1 to be 2" }]);
  store.transaction(() => {
    const failing = store.failures.failingAt(key);
    const pass = result(flipped, key, { worktreeId, recordedAt: at(9, 3), runId: `pass-${key}` });
    store.results.putMany([pass]);
    store.failures.keepReplaced(failing, [pass], () => 1.25);
  });
  return logDir;
}

/**
 * Main and linked worktree `b`; `APPEARS` flipped in `b` only at key `kb`,
 * then the `more` flips; `b` then removed and pruned a second later.
 */
function seedPruned(more: readonly [CheckId, string][] = []) {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const b = repo.addWorktree("b");
  for (const [id, root] of [
    [repo.mainId, repo.main],
    [b.id, b.root],
  ] as const) {
    store.worktrees.upsert({
      id,
      root,
      commonDir: repo.commonDir,
      isMain: id === repo.mainId,
      registeredAt: 1,
      daemon: null,
    });
  }
  const runsDir = storePaths(repo.commonDir).runsDir;
  const logDir = flip(store, runsDir, b.id, APPEARS, "kb");
  for (const [flipped, key] of more) flip(store, runsDir, b.id, flipped, key);
  rmSync(join(b.root, ".git"));
  store.prune({ now: at(9, 3) + 1_000, retentionDays: 7, maxSizeMb: null });
  return { repo, store, b, logDir };
}

describe("why reaches a kept replaced failure of a removed worktree (review 0.1.265 B2)", () => {
  it("by its exact printed name, with its run's log and its stack, with no state or result here", () => {
    const { repo, store, b, logDir } = seedPruned();
    expect(store.worktrees.list().map((w) => w.id)).toEqual([repo.mainId]);
    expect(store.results.listForCheck(APPEARS, 20)).toHaveLength(0);
    expect(store.knownStates.get(repo.mainId, APPEARS)).toBeNull();
    const listed = readFailures(repo.main, { allWorktrees: true });
    if (!listed.available) throw new Error("no failures report");
    expect(listed.total).toBe(1);
    const [entry] = listed.failures;
    expect(entry?.check).toEqual(APPEARS);

    const why = reportOf(readWhy(repo.main, formatCheck(APPEARS)));
    expect(why.check).toEqual(APPEARS);
    expect(why.knownState).toBeNull();
    expect(why.results).toEqual([]);
    expect(why.replacedFailures).toMatchObject([
      { failure: { provenance: { runId: "fail-kb", worktreeId: b.id } }, logDir },
    ]);
    expect(existsSync(logDir)).toBe(true);
    const text = formatWhy(why);
    expect(text).toContain("Replaced failures (1, newest first):");
    expect(text).toContain(`removed worktree ${b.id}`);
    expect(text).toContain(`log: ${logDir}`);
    expect(text).toContain("    at src/fresh.test.ts:4:7");
  });

  it("by a part of its name, each kept check once among the candidates", () => {
    const other = check("src/fresh.test.ts", "fresh > appears elsewhere");
    // A second kept failure of `APPEARS`, which stays one candidate, and one of another check.
    const { repo } = seedPruned([
      [APPEARS, "kb2"],
      [other, "ko"],
    ]);
    const found = reportOf(readWhy(repo.main, "appears only"));
    expect(found.check).toEqual(APPEARS);
    expect(found.replacedFailures?.map((e) => e.failure.key)).toEqual(["kb2", "kb"]);
    expect(formatWhy(found)).toContain("    at src/fresh.test.ts:4:7");

    const both: WhyResult = readWhy(repo.main, "fresh > appears");
    expect(both).toMatchObject({ found: false, candidates: [other, APPEARS] });
    expect(reportOf(readWhy(repo.main, "appears elsewhere")).check).toEqual(other);
  });
});
