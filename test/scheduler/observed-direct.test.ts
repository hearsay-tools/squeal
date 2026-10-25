import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { observedDirectMetaKey, observedMetaKey } from "../../src/core/keys/index.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import {
  type CatchUpFile,
  type CatchUpRepo,
  catchUpRepo,
  catchUpSide,
} from "./catch-up-fixture.js";
import { editAndRun, pathsOf } from "./edit-cut-fixture.js";
import { createRepo, openRepoStore, SLOW } from "./helpers.js";
import { type Observing, observing } from "./one-write-path-fixture.js";
import { NT, open as openNodeTest } from "./preload-worktrees.js";

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

  it("marks a child's import its closure reaches only through another module", async () => {
    // X and Z reach CHILD through src/a.ts; only X's child imports it, so only X is direct.
    const through = (path: string, ms: number): CatchUpFile => ({
      path,
      ms,
      imports: ["src/a.ts"],
      through: [CHILD],
    });
    const x = through("test/x.test.ts", 500);
    const z = through("test/z.test.ts", 100);
    const files = [x, z];
    const what: Observing = {
      observed: { [x.path]: { paths: [CHILD], directories: [], direct: [CHILD] } },
      loads: true,
    };
    const repo = catchUpRepo(files, ["src/a.ts", CHILD]);
    const first = open(repo, repo.main, files, what);
    await first.scheduler.start();
    await first.scheduler.idle();
    // The path is in X's closure, so nothing grew: the mark alone is stored.
    expect(first.store.meta.get(observedMetaKey(""))).toBeNull();
    expect(JSON.parse(first.store.meta.get(observedDirectMetaKey("")) ?? "{}")).toEqual({
      [x.path]: [CHILD],
    });
    await first.scheduler.close();

    const restarted = open(repo, repo.main, files, what);
    await restarted.scheduler.start();
    await restarted.scheduler.idle();
    const cut = await editAndRun(restarted, CHILD);
    expect(cut.edits[0]?.files.map((f) => f.path)).toEqual([x.path]);
    expect(cut.catchUpPaths).toEqual([z.path]);
  });

  it("reads a mark a live second worktree stored after this one started (review 0.1.313 B1)", async () => {
    // X and Z reach CHILD through src/a.ts only; without X's mark the K = 1 shortest is Z.
    const through = (path: string, ms: number): CatchUpFile => ({
      path,
      ms,
      imports: ["src/a.ts"],
      through: [CHILD],
    });
    const x = through("test/x.test.ts", 500);
    const z = through("test/z.test.ts", 100);
    const files = [x, z];
    const repo = catchUpRepo(files, ["src/a.ts", CHILD]);
    // B's runs mark nothing; it starts first and keeps the store's marks as they were.
    const b = open(repo, repo.other, files, { loads: true });
    await b.scheduler.start();
    await b.scheduler.idle();
    expect(b.store.meta.get(observedDirectMetaKey(""))).toBeNull();

    // A's copy of CHILD differs, so A runs both files, and its run of X marks CHILD.
    writeFileSync(join(repo.main, CHILD), "// a's child\n");
    const what: Observing = {
      observed: { [x.path]: { paths: [CHILD], directories: [], direct: [CHILD] } },
      loads: true,
    };
    const a = open(repo, repo.main, files, what);
    await a.scheduler.start();
    await a.scheduler.idle();
    expect(JSON.parse(b.store.meta.get(observedDirectMetaKey("")) ?? "{}")).toEqual({
      [x.path]: [CHILD],
    });

    // B, still live, edits CHILD: A's mark makes X a direct importer, so X is the edit.
    const cut = await editAndRun(b, CHILD);
    expect(cut.editPaths).toEqual([x.path]);
    expect(cut.catchUpPaths).toEqual([z.path]);
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

  it("stores a node:test child's import of a closure path as a mark, beside no observed path", async () => {
    // The test file reaches lib/b.mjs through lib/a.mjs; the child it spawns imports b directly.
    const repo = createRepo("basic");
    const files: Record<string, string> = {
      "nt/package.json": `${JSON.stringify({ name: "nt", private: true, type: "module" })}\n`,
      "nt/lib/a.mjs": `export { b } from "./b.mjs";\n`,
      "nt/lib/b.mjs": "export const b = 1;\n",
      "nt/bin/child.mjs": `import { b } from "../lib/b.mjs";\nprocess.stdout.write(String(b));\n`,
      "nt/test/t.test.mjs": [
        `import assert from "node:assert/strict";`,
        `import { execFileSync } from "node:child_process";`,
        `import { test } from "node:test";`,
        `import { b } from "../lib/a.mjs";`,
        `test("t", () => assert.equal(execFileSync(process.execPath, ["bin/child.mjs"], { encoding: "utf8" }), String(b)));`,
        "",
      ].join("\n"),
    };
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(repo.main, path)), { recursive: true });
      writeFileSync(join(repo.main, path), text);
    }
    git(repo.main, ["add", "-A"]);
    git(repo.main, ["commit", "-qm", "nt"]);
    const store = openRepoStore(repo.commonDir);
    const project = { ...NT, slow: true };
    const side = await openNodeTest(
      repo.main,
      store,
      repo.commonDir,
      undefined,
      project,
      undefined,
      RUN_MISSING,
    );
    await side.scheduler.start();
    await side.scheduler.idle();
    expect(JSON.parse(store.meta.get(observedDirectMetaKey(NT.name)) ?? "{}")).toEqual({
      "nt/test/t.test.mjs": ["nt/bin/child.mjs", "nt/lib/b.mjs"],
    });
    // b is in the static closure: only the child's entry grew the observed set.
    expect(JSON.parse(store.meta.get(observedMetaKey(NT.name)) ?? "{}")).toEqual({
      "nt/test/t.test.mjs": ["nt/bin/child.mjs"],
    });
  });
});
