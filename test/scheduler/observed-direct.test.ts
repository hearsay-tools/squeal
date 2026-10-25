import { describe, expect, it } from "vitest";
import { observedDirectMetaKey } from "../../src/core/keys/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpRepo,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { editAndRun, pathsOf } from "./edit-cut-fixture.js";
import { SLOW } from "./helpers.js";
import { type Observing, observing } from "./one-write-path-fixture.js";

/*
 * Spec 016 D4, goal 6 (row 007-56): an edit of a path a process the test
 * file started imported puts the file in `direct`, after a restart and in a
 * second worktree, since the core stores the mark beside the observed paths.
 * 011 C4 step 4 as amended for 016-17: such a file counts among the K
 * shortest of the other direct importers, never as a bare source's
 * fallback, so `runner.tierSize` caps what stored marks keep as edits.
 */

const CHILD = "src/child.ts";

/** A test file of `ms` that imports nothing statically; what its runs read is `reads`'s. */
const reader = (path: string, ms: number): CatchUpFile => ({ path, ms, imports: [] });

function open(repo: CatchUpRepo, root: string, files: readonly CatchUpFile[], what: Observing) {
  const side = catchUpSide(repo, root, {
    files,
    hostSlots: 23,
    tierSize: 1,
    policy: RUN_MISSING,
  });
  observing(side, what);
  return side;
}

/** Each of `direct` imports `CHILD` in a child process; each of `read` reads it. */
function reads(direct: readonly CatchUpFile[], read: readonly CatchUpFile[]): Observing {
  const observed: Record<string, { paths: string[]; directories: []; direct?: string[] }> = {};
  for (const f of direct) observed[f.path] = { paths: [CHILD], directories: [], direct: [CHILD] };
  for (const f of read) observed[f.path] = { paths: [CHILD], directories: [] };
  return { observed, loads: true };
}

describe("scheduler: stored direct marks (016 D4, goal 6)", SLOW, () => {
  // X is slower than Y: without its mark, the K = 1 shortest reader would be Y.
  const X = reader("test/x.test.ts", 500);
  const Y = reader("test/y.test.ts", 100);
  const FILES = [X, Y];
  const WHAT = reads([X], [Y]);

  it("keeps a child's import direct after a restart", async () => {
    const repo = catchUpRepo(FILES, [CHILD]);
    const first = open(repo, repo.main, FILES, WHAT);
    await first.scheduler.start();
    await first.scheduler.idle();
    expect(JSON.parse(first.store.meta.get(observedDirectMetaKey("")) ?? "{}")).toEqual({
      [X.path]: [CHILD],
    });
    await first.scheduler.close();

    const restarted = open(repo, repo.main, FILES, WHAT);
    await restarted.scheduler.start();
    await restarted.scheduler.idle();
    const cut = await editAndRun(restarted, CHILD);
    expect(cut.edits[0]?.files.map((f) => f.path)).toEqual([X.path]);
    expect(cut.catchUpPaths).toEqual([Y.path]);
  });

  it("keeps a child's import direct in a second worktree", async () => {
    const repo = catchUpRepo(FILES, [CHILD]);
    const a = open(repo, repo.main, FILES, WHAT);
    await a.scheduler.start();
    await a.scheduler.idle();

    const b = open(repo, repo.other, FILES, WHAT);
    await b.scheduler.start();
    await b.scheduler.idle();
    // B inherits A's results: its keys hold the paths A observed.
    expect(b.runner.runs).toEqual([]);
    const cut = await editAndRun(b, CHILD);
    expect(cut.edits[0]?.files.map((f) => f.path)).toEqual([X.path]);
    expect(cut.catchUpPaths).toEqual([Y.path]);
  });

  it("keeps the K shortest of more than K marked files as edits, the rest catch-up", async () => {
    const marked = [100, 200, 300, 400].map((ms, i) => reader(`test/m${i}.test.ts`, ms));
    const repo = catchUpRepo(marked, [CHILD]);
    const side = catchUpSide(repo, repo.main, {
      files: marked,
      hostSlots: 23,
      tierSize: 2,
      policy: RUN_MISSING,
    });
    observing(side, reads(marked, []));
    await side.scheduler.start();
    await side.scheduler.idle();
    const cut = await editAndRun(side, CHILD);
    expect(cut.editPaths).toEqual(pathsOf(marked.slice(0, 2)));
    expect(cut.catchUpPaths).toEqual(pathsOf(marked.slice(2)));
  });

  it("leaves marked files out of a bare source's fallback: only the runner's importers stay", async () => {
    // R imports CHILD statically; CHILD has no namesake, so the cut keeps R as its fallback.
    const R: CatchUpFile = { path: "test/r.test.ts", ms: 900, imports: [CHILD] };
    const marked = [100, 200, 300].map((ms, i) => reader(`test/m${i}.test.ts`, ms));
    const files = [R, ...marked];
    const repo = catchUpRepo(files, [CHILD]);
    const side = catchUpSide(repo, repo.main, {
      files,
      hostSlots: 23,
      tierSize: 1,
      policy: RUN_MISSING,
    });
    observing(side, reads(marked, []));
    await side.scheduler.start();
    await side.scheduler.idle();
    const cut = await editAndRun(side, CHILD);
    // R by the fallback, and the K = 1 shortest marked file; the other two are catch-up.
    expect(cut.editPaths).toEqual(pathsOf([R, marked[0] as CatchUpFile]));
    expect(cut.catchUpPaths).toEqual(pathsOf(marked.slice(1)));
  });
});
