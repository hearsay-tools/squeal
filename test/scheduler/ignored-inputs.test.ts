import { appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import { addWorktree, createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/*
 * Spec 004 D6, lessons defect 7: a slow file whose declared inputs name a
 * gitignored build output is keyed by that output's bytes. Two worktrees
 * with different builds never share its key, and an edit of the build
 * re-keys it. Installed dependencies stay out: they enter keys through the
 * environment, not as declared inputs.
 */

const STRINGS = "test/strings.test.ts";
const MATH = "test/math.test.ts";

const policy: Partial<Policy> = {
  slow: { ...DEFAULT_POLICY.slow, include: [STRINGS] },
  inputs: { [STRINGS]: ["dist/**", "**/*.cjs"] },
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Harness options with a slot of the test's own and a calm host. */
function options() {
  const slotDir = mkdtempSync(join(tmpdir(), "squeal-004-28-slot-"));
  dirs.push(slotDir);
  return { policy, slow: { slotDir, recheckMs: 50, load: () => [0], cpus: () => 1 } };
}

/** The `basic` fixture with `dist/` gitignored and committed so. */
function repoWithIgnoredDist() {
  const repo = createRepo();
  appendFileSync(join(repo.main, ".gitignore"), "dist/\n");
  git(repo.main, ["commit", "-qam", "ignore dist"]);
  return repo;
}

describe("a gitignored declared input (lessons defect 7)", SLOW, () => {
  it("keys the slow file by the build, per worktree, and re-keys on its edit", async () => {
    const repo = repoWithIgnoredDist();
    const second = addWorktree(repo.main, repo.dir, "second");
    const store = openRepoStore(repo.commonDir);
    const a = await openHarness(repo.main, store, repo.commonDir, options());
    const b = await openHarness(second, store, repo.commonDir, options());
    a.write("dist/index.js", "export const build = 'a';\n");
    b.write("dist/index.js", "export const build = 'b';\n");
    // Installed packages are no declared input, whatever the glob says.
    a.write("node_modules/pkg/index.cjs", "module.exports = 1;\n");
    await a.scheduler.start();
    await b.scheduler.start();
    await a.scheduler.idle();
    await b.scheduler.idle();

    expect(a.keyOf(STRINGS)).not.toBeNull();
    expect(a.keyOf(STRINGS)).not.toBe(b.keyOf(STRINGS));
    // A file the declaration does not name keys the same in both.
    expect(a.keyOf(MATH)).toBe(b.keyOf(MATH));
    expect(a.scheduler.extraFiles()).toContain("dist/index.js");
    expect(a.scheduler.extraFiles()).not.toContain("node_modules/pkg/index.cjs");

    // The same build in both worktrees shares the key.
    b.write("dist/index.js", "export const build = 'a';\n");
    await b.batch("dist/index.js");
    expect(b.keyOf(STRINGS)).toBe(a.keyOf(STRINGS));

    const before = a.keyOf(STRINGS);
    a.write("dist/index.js", "export const build = 'a2';\n");
    await a.batch("dist/index.js");
    expect(a.keyOf(STRINGS)).not.toBe(before);
    expect(a.keyOf(MATH)).toBe(b.keyOf(MATH));
    await a.scheduler.idle();

    // A rebuild adds a file no watch reports beside one it rewrites: it joins the key.
    const rebuilt = a.keyOf(STRINGS);
    a.write("dist/index.js", "export const build = 'a3';\n");
    a.write("dist/chunk.js", "export const chunk = 1;\n");
    await a.batch("dist/index.js");
    await a.scheduler.idle();
    expect(a.scheduler.extraFiles()).toContain("dist/chunk.js");
    const withChunk = a.keyOf(STRINGS);
    expect(withChunk).not.toBe(rebuilt);
    a.write("dist/chunk.js", "export const chunk = 2;\n");
    await a.batch("dist/chunk.js");
    expect(a.keyOf(STRINGS)).not.toBe(withChunk);
    await a.scheduler.idle();
    await b.scheduler.idle();
  });

  it("lists them again when a policy reload declares them", async () => {
    const repo = repoWithIgnoredDist();
    const store = openRepoStore(repo.commonDir);
    const next: Policy = { ...DEFAULT_POLICY, ...policy };
    const h = await openHarness(repo.main, store, repo.commonDir, {
      ...options(),
      policy: { ...policy, inputs: [] },
      reloadPolicy: (changes) =>
        changes.some((c) => c.path === "squeal.config.json") ? next : null,
    });
    h.write("dist/index.js", "export const build = 'a';\n");
    await h.scheduler.start();
    await h.scheduler.idle();
    expect(h.scheduler.extraFiles()).not.toContain("dist/index.js");

    h.write("squeal.config.json", JSON.stringify({ inputs: next.inputs }));
    await h.batch("squeal.config.json");
    await h.scheduler.idle();
    expect(h.scheduler.extraFiles()).toContain("dist/index.js");
    const declared = h.keyOf(STRINGS);
    h.write("dist/index.js", "export const build = 'b';\n");
    await h.batch("dist/index.js");
    expect(h.keyOf(STRINGS)).not.toBe(declared);
    await h.scheduler.idle();
  });
});
