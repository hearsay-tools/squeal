import { lstatSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CandidateBatch,
  type CheckKey,
  checkpointMetaKey,
  parseCheckpointProgress,
  type RelativePath,
} from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { createRepo, type Harness, openHarness, openRepoStore } from "./helpers.js";

/*
 * Row 011-120's repository (row 011-118's E8, `tasks/011-118/notes.md` 2):
 * one test that reads `tree/a.txt` and lists `tree/`, so an edit of
 * `tree/a.txt` moves its key and cancels a tier that runs it (C4 step 5).
 */
export const LISTS = "test/lists.test.ts";
export const LISTED = {
  kind: "test",
  project: "",
  testPath: LISTS,
  fullName: "lists tree",
} as const;
export const A = "tree/a.txt";
export const BROKEN = "tree/broken";
/** Observed inputs on, whatever the policy default (task 001-134). */
const OBSERVING = { observe: true, policy: { observe: { runtimeInputs: true } } } as const;

const LISTS_TEST = `import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const tree = join(import.meta.dirname, "..", "tree");

test("lists tree", () => {
  expect(readFileSync(join(tree, "a.txt"), "utf8")).not.toBe("");
  expect(readdirSync(tree)).not.toContain("broken");
});
`;

/** The repository with `extra` test files, its baseline done: `stored`, the key of the pass at `a`. */
export async function listing(
  extra: Readonly<Record<string, string>> = {},
): Promise<{ h: Harness; stored: CheckKey | null }> {
  const repo = createRepo();
  writeFileSync(join(repo.main, LISTS), LISTS_TEST);
  for (const [path, text] of Object.entries(extra)) writeFileSync(join(repo.main, path), text);
  const store = openRepoStore(repo.commonDir);
  // One file a tier, so a revision that moves its key alone cancels its tier (C4 step 5).
  const h = await openHarness(repo.main, store, repo.commonDir, {
    ...OBSERVING,
    policy: { ...RUN_MISSING, ...OBSERVING.policy },
    tierSize: 1,
  });
  h.write(A, "a\n");
  await h.scheduler.start();
  await h.scheduler.idle();
  return { h, stored: h.keyOf(LISTS) };
}

/** `tree/a.txt` as `text`, once the scheduler is idle again; the file's key then. */
export async function edit(h: Harness, text: string): Promise<CheckKey | null> {
  h.write(A, text);
  await h.batch(A);
  await h.scheduler.idle();
  return h.keyOf(LISTS);
}

/** The phase of `path`'s row: `queued`, `running`, or none. */
export const phaseOf = (h: Harness, path: string) =>
  h.store.testFileKeys.list(h.worktreeId).find((r) => r.testFile.path === path)?.pending;

/** How many requested files the open checkpoint counts done, as status reads it; none open, `null`. */
export const doneOf = (h: Harness) =>
  parseCheckpointProgress(h.store.meta.get(checkpointMetaKey(h.worktreeId)))?.done ?? null;

/**
 * A watch batch of `paths` as they are on disk, stat'ed as the fs hasher
 * does but at once: handed to the scheduler, it reaches its lock before any
 * other task asks for it.
 */
export function statNow(h: Harness, ...paths: string[]): CandidateBatch {
  const stat = (path: string) => {
    const stats = lstatSync(join(h.root, path), { throwIfNoEntry: false });
    if (stats === undefined) return null;
    return { mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs, size: stats.size, inode: stats.ino };
  };
  return {
    trigger: "watch",
    paths: [...paths].sort().map((path) => ({ path: path as RelativePath, stat: stat(path) })),
  };
}

/**
 * Holds at the gate the first run of `path` that `pick` accepts, until
 * `release`: `key` is the file's key when it started, `cancelled` once the
 * scheduler cancelled it (`RunOptions.signal`). Holds beside the gate's
 * earlier holds.
 */
export function holdRun(h: Harness, path = LISTS, pick: () => boolean = () => true) {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const run: { id: string | null; key: CheckKey | null; signal?: AbortSignal | undefined } = {
    id: null,
    key: null,
  };
  const earlier = h.gate.before;
  h.gate.before = async (files, options) => {
    await earlier?.(files, options);
    if (!files.some((f) => f.path === path)) return;
    if (run.id === null && pick()) {
      run.id = options.runId;
      run.key = h.keyOf(path);
    }
    if (options.runId !== run.id) return;
    run.signal = options.signal;
    await held;
  };
  return { run, release, cancelled: () => run.signal?.aborted === true };
}
