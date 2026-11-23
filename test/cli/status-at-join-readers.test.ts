import { describe, expect, it } from "vitest";
import type { AtDaemons } from "../../src/cli/status-at-daemons.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import type { AbsolutePath, RelativePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { type Fixture, fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { run, standIn, standInTree, testOf, withStore } from "./status-at-kit.js";
import { keyedNow } from "./status-at-now-stand-in.js";

/*
 * Review 0.1.599 B2 (spec 023 D7.3, V4): a narrowed `--wait` on a source
 * path joins the files at the commit that read it. A wide `--run` asked
 * first named no path, so its kept ask has no readers; the join read
 * readers only there, dropped the running reader and said "nothing is
 * queued or running" at once. The readers come from the commit daemon's
 * key index now (its `sync` with the paths), and the join still waits for
 * no unrelated file.
 */

const A = ref("test/a.test.ts");
const Z = ref("test/z.test.ts");

/** Commit A: `test/a` reads `src/a.ts`, `test/z` reads `src/z.ts`; HEAD changes both sources. */
function two() {
  const f = fixture({
    "squeal.config.json": "{}\n",
    "src/a.ts": "export const value = 2;\n",
    "src/z.ts": "export const value = 2;\n",
    [A.path]: testOf("a", 2),
    [Z.path]: testOf("z", 2),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({
    "src/a.ts": "export const value = 2; // b\n",
    "src/z.ts": "export const value = 2; // b\n",
  });
  return { f, a };
}

/** Marks `files` queued in the commit daemon of `tree`, at the stand-in's keys. */
function queued(f: Fixture, tree: string, files: readonly TestFileRef[]) {
  withStore(f, (store) =>
    store.testFileKeys.upsertMany(
      files.map((testFile) => ({
        worktreeId: worktreeIdFor(tree as AbsolutePath),
        testFile,
        key: `commit-${testFile.path}`,
        revision: 2,
        pending: "queued" as const,
      })),
    ),
  );
}

/** The commit daemon's readers, by its key index: `src/a.ts` is read by `test/a` only. */
const INDEX: Record<string, readonly TestFileRef[]> = { "src/a.ts": [A], "src/z.ts": [Z] };

describe("a narrowed wait on a source path (review 0.1.599 B2)", SLOW, () => {
  it("joins the commit's readers of a named source path after a wide ask, and no unrelated file", async () => {
    const { f, a } = two();
    const tree = standInTree(f);
    const waited: { root: string; files: string[] }[] = [];
    const base = standIn(
      tree,
      (root, files) => waited.push({ root, files: files.map((r) => r.path) }),
      {
        select: () => [A, Z],
        rows: (at, files) => queued(f, at, files),
      },
    );
    const asked: (readonly RelativePath[])[] = [];
    const ports: AtDaemons = {
      ...base.ports,
      async now(root, paths, deadline) {
        if (root !== tree) return keyedNow(root, paths, deadline);
        asked.push(paths);
        return {
          kind: "read",
          revision: 2,
          readers: new Map(paths.map((p) => [p, INDEX[p] ?? []])),
        };
      },
    };
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install, daemons: ports };
    const at = a.slice(0, 9);
    await run(f, { commit: a, run: { allMissing: false }, waitMs: 2000 }, options);
    expect(base.commitAsks.map((ask) => ask.named)).toEqual([[]]);
    waited.length = 0;

    const join = await run(f, { commit: a, paths: ["src/a.ts"], waitMs: 3000 }, options);
    expect(join.out).not.toContain("--wait: nothing is queued or running");
    expect(waited.filter((w) => w.root === tree)).toEqual([{ root: tree, files: [A.path] }]);
    expect(asked).toEqual([["src/a.ts"]]);
    expect(join.out).toContain(`src/a.ts: 1 of 1 queued at ${at}, `);
    expect(join.out).toContain(
      `The rest of the queue, outside these paths: 1 more test files queued or running at ${at} (its worktree)`,
    );
    expect(base.commitAsks).toHaveLength(1);

    // A named source folder selects the test files under it, as the commit's ask does: none
    // here. It joins nothing of the wide ask's, and waits for no unrelated file.
    waited.length = 0;
    await run(f, { commit: a, paths: ["src"], waitMs: 2000 }, options);
    expect(waited.filter((w) => w.root === tree).flatMap((w) => w.files)).toEqual([]);
    expect(base.commitAsks).toHaveLength(1);
  });
});
