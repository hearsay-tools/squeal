import { cpSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commitPolicy } from "../../src/core/daemon/commit-mode.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/policy.js";
import { git } from "../hash/git-repo.js";
import { SLOW } from "./cleanup.js";
import { addWorktree, createRepo, openRepoStore } from "./repo.js";
import { type Harness, openHarness } from "./vitest-harness.js";

/*
 * Review wave-23-third B2 (row 023-46, `tasks/023-46-notes.md`, Round 4): a
 * start's stored walk proves a miss only when the list it keyed from holds no
 * import unresolved here. Real Vitest resolution, a real store and git:
 *
 * - A: `test/foo.test.ts` imports extensionless `../src/foo`, which has no
 *   target. A's walk lists the absent candidates (`src/foo.js`,
 *   `src/foo.ts`, ...) and stores a walk at key K. A keeps its row at K.
 * - B, another worktree: adds and commits `src/foo.js`. Its walk resolves the
 *   import; the newest stored list now names `src/foo.js` and no other
 *   candidate.
 * - C, a commit worktree at A: keys B's list at K (`src/foo.js` is absent
 *   here, so the key leaves it out), and A's walk row at K exists. The list
 *   cannot prove A's closure, so C walks: `src/foo.ts` is among its
 *   candidates, and a change that adds it selects the test.
 */

const FOO = "test/foo.test.ts";
/** A resolved extensionless import: its list names no absent path, so its stored walk proves it. */
const BAR = "test/bar.test.ts";
const LOOKUP_ONLY: Partial<Policy> = { baseline: { onStart: "lookup-only" } };

/** A start of `root`, lookup-only, and the test files its runner walked. */
async function started(
  root: string,
  repo: { commonDir: string },
  policy: Partial<Policy>,
): Promise<{ h: Harness; walked: string[] }> {
  const store = openRepoStore(repo.commonDir);
  // Registered as a daemon registers it: pruning keeps the walks at the keys its rows hold.
  store.worktrees.upsert({
    id: worktreeIdFor(root),
    root,
    commonDir: repo.commonDir,
    isMain: root === realpathSync(join(repo.commonDir, "..")),
    registeredAt: Date.now(),
    daemon: null,
  });
  const h = await openHarness(root, store, repo.commonDir, { policy });
  const walked: string[] = [];
  const closure = h.runner.closure.bind(h.runner);
  h.runner.closure = async (testFile) => {
    walked.push(testFile.path);
    return closure(testFile);
  };
  await h.scheduler.start();
  await h.quiet();
  return { h, walked };
}

describe("a stored walk proves no miss whose list holds an unresolved import (B2)", SLOW, () => {
  it("a commit worktree at A walks the test B's resolved list keys at A's key, and selects src/foo.ts", async () => {
    const repo = createRepo();
    writeFileSync(
      join(repo.main, FOO),
      'import { it } from "vitest";\nimport { foo } from "../src/foo";\n\nit("foo", () => foo());\n',
    );
    writeFileSync(
      join(repo.main, BAR),
      'import { expect, it } from "vitest";\nimport { add } from "../src/math";\n\nit("bar", () => expect(add(1, 1)).toBe(2));\n',
    );
    git(repo.main, ["add", "-A"]);
    git(repo.main, ["commit", "-qm", "A: foo imports a missing file"]);

    // A walks and keeps its row at K: pruning keeps the walk.
    const a = await started(repo.main, repo, LOOKUP_ONLY);
    expect(a.walked).toContain(FOO);
    const k = a.h.keyOf(FOO);
    expect(k).not.toBeNull();
    expect(a.h.store.testFiles.get({ project: "", path: FOO })?.closure.paths).toContain(
      "src/foo.ts",
    );

    // B resolves the import; its list becomes the newest stored list.
    const bRoot = addWorktree(repo.main, repo.dir, "b");
    writeFileSync(join(bRoot, "src/foo.js"), "export const foo = () => {};\n");
    git(bRoot, ["add", "-A"]);
    git(bRoot, ["commit", "-qm", "B: add foo.js"]);
    const b = await started(bRoot, repo, LOOKUP_ONLY);
    expect(b.walked).toContain(FOO);
    const bList = b.h.store.testFiles.get({ project: "", path: FOO })?.closure.paths ?? [];
    expect(bList).toContain("src/foo.js");
    expect(bList).not.toContain("src/foo.ts");
    await b.h.scheduler.close();

    // C: a commit worktree at A, started as a commit daemon is.
    const cRoot = join(repo.dir, "commit");
    git(repo.main, ["worktree", "add", "-q", "--detach", cRoot, "HEAD"]);
    cpSync(join(repo.main, "src/gen"), join(cRoot, "src/gen"), { recursive: true });
    const c = await started(realpathSync(cRoot), repo, {
      baseline: commitPolicy(DEFAULT_POLICY).baseline,
    });

    expect(c.h.keyOf(FOO)).toBe(k);
    // Only the unresolved import is walked: every other file's stored walk proves it.
    expect(c.walked).toEqual([FOO]);
    expect(c.h.keyOf(BAR)).toBe(a.h.keyOf(BAR));
    const changed = (await c.h.scheduler.changedSelects?.(["src/foo.ts"])) ?? [];
    expect(changed.map((ref) => ref.path)).toEqual([FOO]);
    const reads = await c.h.scheduler.closureReads?.((path) => path === "src/foo.ts");
    expect([...(reads?.values() ?? [])]).toEqual(["src/foo.ts"]);
  });
});
