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
 * Row 016-24: each revision reads those names again, and the names a run of
 * a file that listed the directory leaves there are that run's own.
 */

const A = "test/a.test.ts";
const B = "test/b.test.ts";
const NOTES = "notes.md";
const FILES: readonly CatchUpFile[] = [{ path: A, ms: 100, imports: [] }];
const LISTED = "ignored/list";

/** Both worktrees of a repository of `files` whose `ignored/` git ignores. */
function repoIgnoring(files = FILES): CatchUpRepo {
  const repo = catchUpRepo(files, [NOTES]);
  mkdirSync(join(repo.main, ".git/info"), { recursive: true });
  appendFileSync(join(repo.main, ".git/info/exclude"), "ignored/\n");
  return repo;
}

/** Writes each of `names` into the listed directory below `root`. */
function list(root: string, ...names: string[]): void {
  mkdirSync(join(root, LISTED), { recursive: true });
  for (const name of names) writeFileSync(join(root, LISTED, name), `${name}\n`);
}

interface Opening {
  /** Each run of A writes a new name into the listed directory as it starts. */
  readonly writes?: boolean;
  /** The directories each run reports it wrote above the listing (016 D4). */
  readonly written?: readonly string[];
  readonly files?: readonly CatchUpFile[];
}

/**
 * A side at `root` whose runs of each of `files` list `ignored/list`, as
 * Vitest's recorder reports a `readdir`.
 */
function open(repo: CatchUpRepo, root: string, { writes, written, files = FILES }: Opening = {}) {
  const side = catchUpSide(repo, root, { files, hostSlots: 4, policy: RUN_MISSING });
  const seen = { paths: [], directories: [LISTED], ...(written === undefined ? {} : { written }) };
  observing(side, { observed: Object.fromEntries(files.map((f) => [f.path, seen])) });
  if (writes === true) {
    side.runner.beforeRun = (files) => {
      if (files.some((f) => f.path === A)) list(root, `run-${++runsWritten}.json`);
    };
  }
  return side;
}

/** How many runs of A wrote a name: each writes a name no run wrote before. */
let runsWritten = 0;

/** A side at `root` that starts, settles and closes; its runner's runs of A. */
async function settle(repo: CatchUpRepo, root: string, failing = false, writes = false) {
  const side = open(repo, root, { writes });
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

  it("inherits where the names are the same, and sees a name added in the same worktree at the next revision (row 016-24)", async () => {
    const repo = repoIgnoring();
    list(repo.main, "a.json");
    list(repo.other, "a.json");
    expect((await settle(repo, repo.main)).runs).toBe(2);

    // B's directory holds the same name: B inherits A's pass.
    const b = await settle(repo, repo.other);
    expect(b.runs).toBe(0);
    expect(b.current).toBe(true);

    // A name added while A's daemon runs: the watcher reports no change in
    // the ignored directory, but the next revision, an edit of an unrelated
    // file, reads the names again, and the file runs once, with no restart.
    const a = open(repo, repo.main);
    await a.scheduler.start();
    await a.scheduler.idle();
    expect(a.runner.runsOf(A)).toHaveLength(0);
    list(repo.main, "b.json");
    await a.edit("watch", NOTES);
    await a.scheduler.idle();
    expect(a.runner.runsOf(A)).toHaveLength(1);
    expect(a.current(A)).toBe(true);
    await a.edit("watch", NOTES);
    await a.scheduler.idle();
    expect(a.runner.runsOf(A)).toHaveLength(1);
    await a.scheduler.close();

    // The restart reads the same two names and inherits that run's pass.
    expect((await settle(repo, repo.main)).runs).toBe(0);
  });

  it("runs a file that writes into the directory it lists once at first sight, and not at each revision (row 016-24)", async () => {
    const repo = repoIgnoring();
    list(repo.main, "a.json");

    // The listing is first seen, so the file runs once more; that run's own
    // name is not a change a revision finds.
    const a = open(repo, repo.main, { writes: true });
    await a.scheduler.start();
    await a.scheduler.idle();
    expect(a.runner.runsOf(A)).toHaveLength(2);
    expect(a.current(A)).toBe(true);
    for (let i = 0; i < 3; i++) {
      await a.edit("watch", NOTES);
      await a.scheduler.idle();
    }
    expect(a.runner.runsOf(A)).toHaveLength(2);
    expect(a.current(A)).toBe(true);
    await a.scheduler.close();

    // A restart reads the names the last run left, and the file runs once.
    expect((await settle(repo, repo.main, false, true)).runs).toBe(1);
  });

  it("runs another file that lists the directory a writer lists at the next revision, and the writer with it", async () => {
    const repo = repoIgnoring([...FILES, { path: B, ms: 100, imports: [] }]);
    list(repo.main, "a.json");
    const side = open(repo, repo.main, {
      writes: true,
      files: [...FILES, { path: B, ms: 100, imports: [] }],
    });
    await side.scheduler.start();
    await side.scheduler.idle();
    const before = { a: side.runner.runsOf(A).length, b: side.runner.runsOf(B).length };

    // A's names are B's input: they are A's own only while A alone lists the
    // directory, so the next revision runs B, and A, whose key they move too.
    await side.edit("watch", NOTES);
    await side.scheduler.idle();
    expect(side.runner.runsOf(B).length).toBe(before.b + 1);
    expect(side.runner.runsOf(A).length).toBe(before.a + 1);
    expect(side.current(B)).toBe(true);
    await side.scheduler.close();
  });

  it("drops the listing of a directory below one the run wrote, and runs nothing at later revisions (016 D4)", async () => {
    const repo = repoIgnoring();
    list(repo.main, "a.json");

    // The run writes a name below `ignored/` and reports it among `written`:
    // the written-directory bound drops the listing as the run's own scratch.
    const a = open(repo, repo.main, { writes: true, written: ["ignored"] });
    await a.scheduler.start();
    await a.scheduler.idle();
    expect(a.runner.runsOf(A)).toHaveLength(1);
    expect(a.store.meta.get(observedMetaKey(""))).toBeNull();
    for (let i = 0; i < 3; i++) {
      await a.edit("watch", NOTES);
      await a.scheduler.idle();
    }
    expect(a.runner.runsOf(A)).toHaveLength(1);
    await a.scheduler.close();
  });
});
