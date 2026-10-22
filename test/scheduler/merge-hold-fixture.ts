import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createFsHasher } from "../../src/core/hash/index.js";
import { statCandidates } from "../../src/core/revision/index.js";
import { readMergeHold } from "../../src/core/scheduler/hold-rows.js";
import type { CheckKey } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import {
  type CatchUpFile,
  type CatchUpRepo,
  type CatchUpSide,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";

/*
 * Row 011-72 (011 C9 as amended 2026-10-21, `tasks/011-61/design.md` R1): the
 * issue-68 probe's repository with a fake runner. `src/helper.ts` returns 1;
 * `test/a.test.ts` and `test/b.test.ts` import it, `test/other.test.ts`
 * imports nothing. Branch `side` sets the helper to return 2, `main` to
 * return 3, so `git merge side` stops on a content conflict in it. A run
 * fails a file while a path of its closure holds a conflict marker.
 */

export const HELPER = "src/helper.ts";
export const A = "test/a.test.ts";
export const B = "test/b.test.ts";
export const OTHER = "test/other.test.ts";

export const FILES: readonly CatchUpFile[] = [
  { path: A, ms: 10, imports: [HELPER] },
  { path: B, ms: 10, imports: [HELPER] },
  { path: OTHER, ms: 10, imports: [] },
];

export const helperReturning = (n: number) => `export const helper = () => ${n};\n`;

/** The repository, `side` and `main` apart on the helper, `main` checked out. */
export function mergeRepo(): CatchUpRepo {
  const repo = catchUpRepo(FILES);
  const { main } = repo;
  writeFileSync(join(main, HELPER), helperReturning(1));
  git(main, ["commit", "-qam", "helper"]);
  git(main, ["checkout", "-q", "-b", "side"]);
  writeFileSync(join(main, HELPER), helperReturning(2));
  git(main, ["commit", "-qam", "side"]);
  git(main, ["checkout", "-q", "main"]);
  writeFileSync(join(main, HELPER), helperReturning(3));
  git(main, ["commit", "-qam", "main"]);
  return repo;
}

/** A git command that may stop on a conflict (exit 1): its exit code. */
export function gitMay(cwd: string, args: readonly string[]): number {
  try {
    git(cwd, args);
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? -1;
  }
}

/** A side of `root` whose runs fail a file while a path of its closure holds a marker. */
export function holdSide(repo: CatchUpRepo, root = repo.main): CatchUpSide {
  const side = catchUpSide(repo, root, { files: FILES, hostSlots: 4, tierSize: 4 });
  const marked = (path: string) => {
    try {
      return readFileSync(join(root, path), "utf8").includes("<<<<<<<");
    } catch {
      return false;
    }
  };
  side.runner.beforeRun = (files) => {
    for (const file of files) {
      const paths = [file.path, ...(FILES.find((f) => f.path === file.path)?.imports ?? [])];
      if (paths.some(marked)) side.runner.failing.add(file.path);
      else side.runner.failing.delete(file.path);
    }
  };
  return side;
}

/** Hands `side`'s scheduler one watch batch of `paths`, as the change feed would. */
export async function batch(side: CatchUpSide, ...paths: string[]): Promise<void> {
  const hasher = createFsHasher(side.root, "sha1");
  await side.scheduler.handleBatch({
    trigger: "watch",
    paths: await statCandidates(paths, hasher),
  });
}

/** Each test file's key and pending phase, by path. */
export function rows(
  side: CatchUpSide,
): Map<string, { key: CheckKey | null; pending: string | null }> {
  return new Map(
    side.store.testFileKeys
      .list(side.worktreeId)
      .map((r) => [r.testFile.path, { key: r.key, pending: r.pending }]),
  );
}

/** The outcome of each current test of `path`. */
export function outcomes(side: CatchUpSide, path: string): string[] {
  return side.store.knownStates
    .list(side.worktreeId)
    .filter((s) => s.check.testPath === path && s.check.kind === "test" && s.validity === "current")
    .map((s) => s.outcome);
}

/** The paths the published merge hold names; `null` with none. */
export function heldPaths(side: CatchUpSide): readonly string[] | null {
  return readMergeHold(side.store, side.worktreeId, 0)?.paths ?? null;
}

/** How many runs held `path`. */
export const runsOf = (side: CatchUpSide, path: string) => side.runner.runsOf(path).length;

/**
 * Makes `path` unmerged in the index (stages 1 to 3 at its bytes on disk)
 * without writing it: what a merge leaves once its files are written.
 */
export function unmergeIndex(root: string, path: string): void {
  const blob = git(root, ["hash-object", "-w", path]).trim();
  const zero = "0".repeat(blob.length);
  const stages = [1, 2, 3].map((stage) => `100644 ${blob} ${stage}\t${path}`);
  git(root, ["update-index", "--index-info"], `${[`0 ${zero}\t${path}`, ...stages].join("\n")}\n`);
}
