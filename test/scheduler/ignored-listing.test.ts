import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { observedMetaKey } from "../../src/core/keys/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpRepo,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { SLOW } from "./helpers.js";
import { observing } from "./one-write-path-fixture.js";

/*
 * Row 016-23: a test file that lists a git-ignored directory is keyed by the
 * names the directory holds on disk, so a worktree whose directory holds
 * other names than the run that made a result does not inherit it. Main
 * `1119021a6` dropped the listing, and 0.1.313 hashed it as no names.
 */

const A = "test/a.test.ts";
const NOTES = "notes.md";
const FILES: readonly CatchUpFile[] = [{ path: A, ms: 100, imports: [] }];
const LISTED = "ignored/list";

/** Both worktrees of a repository whose `ignored/` git ignores. */
function repoIgnoring(): CatchUpRepo {
  const repo = catchUpRepo(FILES, [NOTES]);
  mkdirSync(join(repo.main, ".git/info"), { recursive: true });
  appendFileSync(join(repo.main, ".git/info/exclude"), "ignored/\n");
  return repo;
}

/** Writes each of `names` into the listed directory below `root`. */
function list(root: string, ...names: string[]): void {
  mkdirSync(join(root, LISTED), { recursive: true });
  for (const name of names) writeFileSync(join(root, LISTED, name), `${name}\n`);
}

/** A side at `root` whose runs of A list `ignored/list`, as Vitest's recorder reports a `readdir`. */
function open(repo: CatchUpRepo, root: string) {
  const side = catchUpSide(repo, root, { files: FILES, hostSlots: 4, policy: RUN_MISSING });
  observing(side, { observed: { [A]: { paths: [], directories: [LISTED] } } });
  return side;
}

/** A side at `root` that starts, settles and closes; its runner's runs of A. */
async function settle(repo: CatchUpRepo, root: string, failing = false) {
  const side = open(repo, root);
  if (failing) side.runner.failing.add(A);
  await side.scheduler.start();
  await side.scheduler.idle();
  const runs = side.runner.runsOf(A).length;
  const current = side.current(A);
  await side.scheduler.close();
  return { side, runs, current };
}

describe("scheduler: a git-ignored directory's listing (row 016-23)", SLOW, () => {
  it("keys the names on disk: B, whose directory lists two names, does not inherit A's pass made with one", async () => {
    const repo = repoIgnoring();
    list(repo.main, "a.json");
    list(repo.other, "a.json", "b.json");

    // A's run lists one name and passes. The listing is first seen after the
    // run began, so the file runs once more under the key that holds it.
    const a = await settle(repo, repo.main);
    expect(JSON.parse(a.side.store.meta.get(observedMetaKey("")) ?? "null")).toEqual({
      [A]: [`${LISTED}/`],
    });
    expect(a.runs).toBe(2);
    expect(a.current).toBe(true);

    // B lists two names: a direct run there fails, and B runs the file. Its
    // own new failure runs once more (001 D6, task 001-171).
    const b = await settle(repo, repo.other, true);
    expect(b.runs).toBe(2);
    expect(b.current).toBe(true);

    // A restarted lists its one name again and inherits its own pass.
    const restarted = await settle(repo, repo.main);
    expect(restarted.runs).toBe(0);
    expect(restarted.current).toBe(true);
  });

  it("inherits where the names are the same, and sees a name added in the same worktree at the next restart", async () => {
    const repo = repoIgnoring();
    list(repo.main, "a.json");
    list(repo.other, "a.json");
    expect((await settle(repo, repo.main)).runs).toBe(2);

    // B's directory holds the same name: B inherits A's pass.
    const b = await settle(repo, repo.other);
    expect(b.runs).toBe(0);
    expect(b.current).toBe(true);

    // A name added while A's daemon runs: no change the watcher reports moves
    // the listing, so the next revision keeps the key (a residual of 016-23).
    const a = open(repo, repo.main);
    await a.scheduler.start();
    await a.scheduler.idle();
    expect(a.runner.runsOf(A)).toHaveLength(0);
    list(repo.main, "b.json");
    await a.edit("watch", NOTES);
    await a.scheduler.idle();
    expect(a.runner.runsOf(A)).toHaveLength(0);
    await a.scheduler.close();

    // The restart reads the two names, and the file runs.
    expect((await settle(repo, repo.main)).runs).toBe(1);
  });
});
