import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { type Fixture, fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { result } from "../store/helpers.js";
import { liveDaemon } from "./status-at-daemon.js";
import { check, run, standIn, standInTree, testOf, withStore } from "./status-at-kit.js";

/*
 * Review wave-23 S2 and B3 on a `$TMPDIR` fixture with stand-in daemons.
 * S2: a joined call reports from the states its wait ended with, never
 * with Q1's `--run` step read before the wait, in text and JSON, when the
 * join completes and when part of it still runs. B3's negative control,
 * row 023-40c: the call keys nothing at the commit, so the commit is read
 * only at the key its daemon's row holds; a result at another key is never
 * read as the commit's.
 */

const A = ref("test/a.test.ts");
const B = ref("test/b.test.ts");

/** Commit A, then HEAD changes both tests; a live daemon in the worktree lists them. */
function changed() {
  const f = fixture({
    "squeal.config.json": "{}\n",
    "src/a.ts": "export const value = 1;\n",
    [A.path]: testOf("a", 1),
    [B.path]: testOf("a", 1),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ [A.path]: testOf("a", 2), [B.path]: testOf("a", 2) });
  withStore(f, (store) => liveDaemon(f, store, [A, B]));
  return { f, a, tree: standInTree(f) };
}

/** `files` in the daemon of `root` at `key`, running or done (`null`). */
function rows(
  f: Fixture,
  root: string,
  files: readonly TestFileRef[],
  key: (file: TestFileRef) => string,
  phase: "running" | null,
): void {
  withStore(f, (store) =>
    store.testFileKeys.upsertMany(
      files.map((testFile) => ({
        worktreeId: worktreeIdFor(root as AbsolutePath),
        testFile,
        key: key(testFile),
        revision: 2,
        pending: phase,
      })),
    ),
  );
}

type Side = { state: string; key?: string; reason?: string; origin?: { kind: string } };
const sideOf = (out: string, file: TestFileRef) =>
  (JSON.parse(out).files as { path: string; at: Side; now: Side }[]).find(
    (x) => x.path === file.path,
  );

/** Each file's key at the commit, as the stand-in commit daemon's rows hold it. */
const key = (file: TestFileRef) => `commit-${file.path}`;

/** A join whose wait ends `done` on both sides; the rest still runs. */
async function join(f: Fixture, a: string, tree: AbsolutePath, done: readonly TestFileRef[]) {
  const own = (file: TestFileRef) => `daemon-${file.path}`;
  rows(f, tree, [A, B], key, "running");
  rows(f, f.root, [A, B], own, "running");
  const ending = standIn(tree, (root) => {
    const at = root === tree;
    withStore(f, (store) =>
      store.results.putMany(
        done.map((file) =>
          result(check(file.path), at ? key(file) : own(file), {
            worktreeId: worktreeIdFor(root as AbsolutePath),
          }),
        ),
      ),
    );
    rows(f, root, done, at ? key : own, null);
  });
  const options = { cacheRoot: f.cacheRoot, install: linkInstall().install, daemons: ending.ports };
  const args = { commit: a, paths: ["test"], waitMs: 5000 };
  const json = await run(f, { ...args, json: true }, options);
  const text = await run(f, args, options);
  return { json, text };
}

describe("status --at after the wait (review wave-23 S2, B3)", SLOW, () => {
  it("drops Q1's --run step from a join that completed, in text and JSON", async () => {
    const { f, a, tree } = changed();
    const { json, text } = await join(f, a, tree, [A, B]);
    expect(json.code).toBe(0);
    expect(JSON.parse(json.out).next).toBeNull();
    expect(JSON.parse(json.out).run).toMatchObject({ mode: "join", commit: { known: 2 } });
    expect(text.code).toBe(0);
    expect(text.out).toContain("0 pass -> fail, 0 fail -> pass, 2 unchanged, 0 unknown");
    expect(text.out).not.toMatch(/--run\b/);
  });

  it("ends a partial join with Q7's line, not with Q1's --run step", async () => {
    const { f, a, tree } = changed();
    const { json, text } = await join(f, a, tree, [A]);
    expect(json.code).toBe(3);
    expect(JSON.parse(json.out).next).toBeNull();
    expect(JSON.parse(json.out).run).toMatchObject({
      mode: "join",
      commit: { known: 1, running: 1 },
      again: `squeal status --at ${a} test --wait 100000`,
    });
    expect(text.code).toBe(3);
    expect(text.out).not.toMatch(/--run\b/);
    expect(text.out.trimEnd().split("\n").at(-1)).toBe(
      `1 still running at ${a.slice(0, 9)} (its worktree), 1 in the working tree; their runs go on in the daemons. squeal status --at ${a} test --wait 100000 waits for them; squeal ps shows them.`,
    );
  });

  it("reads the commit only at its daemon's live key: a result at another key is not the commit's", async () => {
    const { f, a, tree } = changed();
    const wrong = "0123456789abcdef-not-the-commits";
    // The commit daemon lists A at its own key; a pass of A sits at a key its row does not hold.
    const stored = standIn(
      tree,
      (root) => {
        if (root !== tree) return;
        withStore(f, (store) =>
          store.results.putMany([
            result(check(A.path), wrong, { worktreeId: worktreeIdFor(tree) }),
          ]),
        );
        rows(f, tree, [A], key, null);
      },
      { rows: (at, files) => rows(f, at, files, key, "running") },
    );
    const options = {
      cacheRoot: f.cacheRoot,
      install: linkInstall().install,
      daemons: stored.ports,
    };
    const called = await run(
      f,
      { commit: a, paths: [A.path], run: { allMissing: false }, waitMs: 5000, json: true },
      options,
    );
    expect(called.code).toBe(3);
    expect(sideOf(called.out, A)?.at).toEqual({ state: "no result", key: key(A) });
  });
});
