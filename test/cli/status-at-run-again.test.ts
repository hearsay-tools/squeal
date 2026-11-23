import { describe, expect, it } from "vitest";
import type { AtDaemons } from "../../src/cli/status-at-daemons.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { type Fixture, fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { result } from "../store/helpers.js";
import { type Ask, check, run, standIn, standInTree, testOf, withStore } from "./status-at-kit.js";

/*
 * Row 023-58 (dogfood round 7, W1): in s1-04 the working tree's side
 * dropped 13 files when the first call's wait ended ("group tests: not
 * asked: the call's wait ended"), and a later `--run` did not queue them:
 * they passed at the commit by then, so the commit daemon queued none of
 * them, and the working tree ran only what the commit daemon queued. A
 * group the wait's end left not asked now says how to ask it, and a later
 * `--run` queues in the working tree every file the change selects that
 * has no result there, a result at the commit or not.
 */

const A = ref("test/a.test.ts");
const B = ref("test/b.test.ts");

/** Commit A: both tests read `src/a.ts`; HEAD changes it. */
function changed() {
  const f = fixture({
    "src/a.ts": "export const value = 1;\n",
    [A.path]: testOf("a", 1),
    [B.path]: testOf("a", 1),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 1; // b\n" });
  return { f, a };
}

/** The commit daemon of `tree` lists `files`, each with a pass at its key. */
function passedAt(f: Fixture, tree: AbsolutePath, files: readonly TestFileRef[]) {
  withStore(f, (store) => {
    store.testFileKeys.upsertMany(
      files.map((testFile) => ({
        worktreeId: worktreeIdFor(tree),
        testFile,
        key: `commit-${testFile.path}`,
        revision: 2,
        pending: null,
      })),
    );
    store.results.putMany(files.map((r) => result(check(r.path), `commit-${r.path}`)));
  });
}

const askedPaths = (asks: readonly Ask[], root: string) =>
  asks.filter((ask) => ask.root === root).flatMap((ask) => [...ask.paths]);

describe("a later --run asks what an earlier call left (row 023-58, W1)", SLOW, () => {
  it("names how to ask a group the wait's end left not asked", { timeout: 60_000 }, async () => {
    const { f, a } = changed();
    const tree = standInTree(f);
    const base = standIn(tree, () => undefined, { select: () => [A, B] });
    // The commit daemon selects only once the call's requests are over, as s1-04's install did.
    const daemons: AtDaemons = {
      ...base.ports,
      async commitRead(at, owners, askBy) {
        while (Date.now() < askBy) await new Promise((done) => setTimeout(done, 50));
        return base.ports.commitRead(at, owners, askBy);
      },
    };
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install, daemons };
    const first = await run(f, { commit: a, run: { allMissing: false }, waitMs: 0 }, options);
    expect(askedPaths(base.asks, f.root)).toEqual([]);
    expect(first.out).toContain(
      `now: 2 without a result: group tests: not asked: the call's wait ended; squeal status --at ${a} --run queues them again\n`,
    );
  });

  it("queues in the working tree the selected files that already pass at the commit", async () => {
    const { f, a } = changed();
    const tree = standInTree(f);
    // Both files have a result at the commit: it queues none, and tells them.
    const base = standIn(tree, () => undefined, { select: () => [], withResult: () => [A, B] });
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install, daemons: base.ports };
    const again = await run(f, { commit: a, run: { allMissing: false }, waitMs: 2000 }, options);
    expect(askedPaths(base.asks, f.root).sort()).toEqual([A.path, B.path]);
    expect(again.out).toContain(
      "--run, now: queued 2 test files the change selects with no result in the working tree",
    );
  });

  it("a join names the files with a result at the commit that the working tree neither has nor runs", async () => {
    const { f, a } = changed();
    const tree = standInTree(f);
    passedAt(f, tree, [A, B]);
    const base = standIn(tree, () => undefined, { select: () => [] });
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install, daemons: base.ports };
    const joined = await run(f, { commit: a, waitMs: 2000 }, options);
    expect(joined.out).toContain(`${A.path}: pass -> no result`);
    expect(joined.out).toContain(
      // Review 0.1.607 B2: no kept ask tells the selection, so no count is promised.
      `now: 2 test files with a result at ${a.slice(0, 9)} have none in the working tree, and none is queued or running there; \`squeal status --at ${a} --run\` queues those of them it selects\n`,
    );
    expect(base.asks).toEqual([]);
  });
});
