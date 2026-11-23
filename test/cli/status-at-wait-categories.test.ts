import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { type Fixture, fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { run, standIn, standInTree, testOf, withStore } from "./status-at-kit.js";

/*
 * Row 023-61 (dogfood round 7, W5): after `--at <parent> --run`, a bare
 * `--at <parent> --wait` printed `1809 test files: no result -> no result`
 * and `13 unchanged, 1907 unknown`, without T2's line for the files the
 * change did not select (s1-02, s1-04). A join now keeps the categories of
 * the wide `--run` it joins: only a kept ask of its own change that named
 * no path tells what the change selects.
 */

const A = ref("test/a.test.ts");
const B = ref("test/b.test.ts");

/** Commit A: `test/a` reads `src/a.ts`, `test/b` reads `src/b.ts`; HEAD changes `src/a.ts`. */
function changedA() {
  const f = fixture({
    "src/a.ts": "export const value = 1;\n",
    "src/b.ts": "export const value = 1;\n",
    [A.path]: testOf("a", 1),
    [B.path]: testOf("b", 1),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 1; // b\n" });
  return { f, a };
}

/** The commit daemon of `tree` lists `files`, none with a result, none pending. */
function listedAt(f: Fixture, tree: AbsolutePath, files: readonly TestFileRef[]) {
  withStore(f, (store) =>
    store.testFileKeys.upsertMany(
      files.map((testFile) => ({
        worktreeId: worktreeIdFor(tree),
        testFile,
        key: `commit-${testFile.path}`,
        revision: 2,
        pending: null,
      })),
    ),
  );
}

const sideOf = (out: string, path: string) =>
  (JSON.parse(out).files as { path: string; at: Record<string, unknown> }[]).find(
    (x) => x.path === path,
  )?.at;

describe("a bare --wait keeps the categories of the --run it joins (row 023-61, W5)", SLOW, () => {
  it("counts the files the change did not select apart, as the --run did", async () => {
    const { f, a } = changedA();
    const at = a.slice(0, 9);
    const tree = standInTree(f);
    listedAt(f, tree, [A, B]);
    // The change selects A only; the runner tells every closure complete.
    const base = standIn(tree, () => undefined, { select: () => [A], incomplete: { "": [] } });
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install, daemons: base.ports };
    const queued = await run(f, { commit: a, run: { allMissing: false }, waitMs: 2000 }, options);
    expect(queued.out).toContain(", 1 not selected\n");

    const joined = await run(f, { commit: a, waitMs: 2000 }, options);
    expect(joined.out).toContain(
      `1 test file not selected: none of its inputs differs between ${at} and the working tree, so this commit cannot change its result: ${B.path}\n`,
    );
    expect(joined.out).toContain("0 unchanged, 1 unknown, 1 not selected\n");
    const json = await run(f, { commit: a, waitMs: 2000, json: true }, options);
    expect(sideOf(json.out, B.path)).toMatchObject({ notSelected: true, closure: "complete" });
    expect(sideOf(json.out, A.path)).not.toHaveProperty("notSelected");
  });

  it("marks nothing not selected from an ask narrowed by paths", async () => {
    const { f, a } = changedA();
    const tree = standInTree(f);
    listedAt(f, tree, [A, B]);
    const base = standIn(tree, () => undefined, { select: () => [A], incomplete: { "": [] } });
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install, daemons: base.ports };
    await run(f, { commit: a, paths: [A.path], run: { allMissing: false }, waitMs: 2000 }, options);
    const json = await run(f, { commit: a, waitMs: 2000, json: true }, options);
    expect(sideOf(json.out, B.path)).not.toHaveProperty("notSelected");
    expect(JSON.parse(json.out).notSelected.files).toBe(0);
  });
});
