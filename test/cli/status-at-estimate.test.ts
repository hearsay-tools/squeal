import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { result } from "../store/helpers.js";
import { check, clean, run, standIn, standInTree, testOf, withStore } from "./status-at-kit.js";

/*
 * Row 023-40 (D7.3): `--run` tells the queueing estimate of what the
 * commit daemon selected, and how to narrow it, when it runs past the
 * wait. Row 023-41 removed this file's in-call run test (row 023-19, P3).
 * Row 023-49 (V2): the estimate is the report's, of what still runs when
 * the wait ends, per side, at the side's share of the pool.
 */

/** Marks `files` queued in the daemon of `root`, at the stand-in commit daemon's keys. */
function queued(f: ReturnType<typeof fixture>, root: string, files: readonly TestFileRef[]) {
  withStore(f, (store) =>
    store.testFileKeys.upsertMany(
      files.map((testFile) => ({
        worktreeId: worktreeIdFor(root as AbsolutePath),
        testFile,
        key: `commit-${testFile.path}`,
        revision: 2,
        pending: "queued" as const,
      })),
    ),
  );
}

const A1 = ref("test/a1.test.ts");
const A2 = ref("test/a2.test.ts");
const Z = ref("test/z.test.ts");
const ZZ = ref("test/zz.test.ts");

/** Commit A with four tests, and HEAD changing `src/a.ts`, which they read. */
function four() {
  const f = fixture({
    "squeal.config.json": "{}\n",
    "src/a.ts": "export const value = 2;\n",
    ...Object.fromEntries([A1, A2, Z, ZZ].map((file) => [file.path, testOf("a", 2)])),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2; // b\n" });
  return { f, a };
}

describe("status --at --run: the queueing estimate (row 023-40)", SLOW, () => {
  it("tells the estimate per side and how to narrow it when the selection runs past the wait (rows 023-40, 023-49)", async () => {
    const { f, a } = four();
    withStore(f, (store) =>
      store.results.putMany(
        [A1, A2].map((file) => ({ ...result(check(file.path), "elsewhere"), durationMs: 900_000 })),
      ),
    );
    // Row 023-40c: the commit daemon selects the four files; the call tells the estimate of them.
    const tree = standInTree(f);
    const daemons = standIn(tree, () => undefined, {
      select: () => [A1, A2, Z, ZZ],
      rows: (at, files) => queued(f, at, files),
    });
    const options = {
      cacheRoot: f.cacheRoot,
      install: linkInstall().install,
      daemons: daemons.ports,
    };
    const cut = await run(f, { commit: a, run: { allMissing: false }, waitMs: 3000 }, options);
    const at = a.slice(0, 9);
    expect(cut.out).toMatch(
      new RegExp(
        `\nStill to run, at ${at}: about \\d+ (s|min|h) for 4 test files, up to \\d+ at once, from their stored durations[^;\n]*;.*name test files or folders to narrow it: squeal status --at ${a} <path>\\.\\.\\. --run\n`,
      ),
    );
    expect(cut.err).not.toContain("this machine's rate");
    clean(f);
  });
});
