import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished } from "vitest";
import type { CheckGroup } from "../../src/core/types/check-groups.js";
import {
  type CatchUpFile,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { groupPolicy, inTurn, runnerLane } from "./group-lanes-fixture.js";

/*
 * Rows 023-78, 023-83: two worktrees of one repository, the commit side and
 * the working tree, with the same three browser files and one shared slot
 * (`maxParallel: 1`), each side's runs logged in start order.
 */

export const PATHS = ["a", "b", "c"].map((n) => `test/browser/${n}.test.ts`);
export const [A, B, C] = PATHS as [string, string, string];
const FILES: readonly CatchUpFile[] = PATHS.map((path) => ({
  path,
  ms: 10,
  imports: ["src/core.ts"],
}));

export const BROWSER: CheckGroup = {
  name: "browser",
  runner: "vitest",
  tests: ["test/browser/**"],
  at: "manual",
  limits: { maxParallel: 1, maxWorkers: 1, priority: "low" },
};

export interface Pair {
  readonly tree: CatchUpSide;
  readonly commit: CatchUpSide;
  /** Every browser run's start, both sides, in order: `tree:<path>` or `commit:<path>`. */
  readonly log: string[];
}

/** Both sides started, the slot's folder private to the test, each lane rechecking every `recheckMs`. */
export async function pair(recheckMs: number): Promise<Pair & { readonly slotDir: string }> {
  const repo = catchUpRepo(FILES);
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-023-78-slot-"));
  onTestFinished(() => rmSync(slotDir, { recursive: true, force: true }));
  const options = {
    files: FILES,
    hostSlots: 8,
    tierSize: 1,
    lane: runnerLane,
    policy: groupPolicy({ checks: [BROWSER] }),
    scheduler: { slow: { slotDir, recheckMs, cpus: () => 1, load: () => [0] } },
  };
  const tree = catchUpSide(repo, repo.main, options);
  const commit = catchUpSide(repo, repo.other, options);
  // The commit's sources differ from the working tree's, so no file shares a key.
  commit.touch("src/core.ts");
  const log: string[] = [];
  for (const [name, side] of [
    ["tree", tree],
    ["commit", commit],
  ] as const) {
    side.runner.beforeRun = (files) => {
      for (const file of files)
        if (file.path.startsWith("test/browser/")) log.push(`${name}:${file.path}`);
    };
  }
  const turns = [await inTurn(tree), await inTurn(commit)];
  onTestFinished(async () => {
    for (const turn of turns) await turn.end();
  });
  await tree.scheduler.start();
  await commit.scheduler.start();
  await tree.rest();
  await commit.rest();
  return { tree, commit, log, slotDir };
}

/** Holds `side`'s run of `path` until the returned release is called. */
export function holdFirst(side: CatchUpSide, path: string): () => void {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  onTestFinished(() => release());
  side.runner.holdOf = (run) => (run.files.some((f) => f.path === path) ? held : undefined);
  return () => release();
}
