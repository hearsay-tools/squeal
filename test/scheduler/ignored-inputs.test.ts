import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFsHasher } from "../../src/core/hash/index.js";
import { statCandidates } from "../../src/core/revision/index.js";
import type { InvalidatedPath } from "../../src/core/types/index.js";
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

/**
 * reviews/wave-4.md B3: `dist -> real-build`, both ignored, in two worktrees
 * with different builds, and a tracked `build.json` identical in both. With
 * `tracked`, git tracks the link under a directory-only rule
 * (reviews/wave-4.5.md B1).
 */
function linkedBuilds(tracked: boolean) {
  const repo = createRepo();
  appendFileSync(
    join(repo.main, ".gitignore"),
    tracked ? "dist/\nreal-build/\n" : "dist\nreal-build/\n",
  );
  writeFileSync(join(repo.main, "build.json"), '{"version":1}\n');
  if (tracked) symlinkSync("real-build", join(repo.main, "dist"));
  git(repo.main, ["add", "-A"]);
  git(repo.main, ["commit", "-qm", "ignore the build"]);
  if (tracked) expect(git(repo.main, ["ls-files", "dist"]).trim()).toBe("dist");
  const second = addWorktree(repo.main, repo.dir, "second");
  for (const [root, build] of [
    [repo.main, "a"],
    [second, "b"],
  ] as const) {
    mkdirSync(join(root, "real-build"));
    writeFileSync(join(root, "real-build/index.js"), `export const build = '${build}';\n`);
    if (!tracked) symlinkSync("real-build", join(root, "dist"));
  }
  return { repo, second };
}

describe(
  "a declared build beyond a symlinked ignored directory (reviews/wave-4.md B3, wave-4.5.md B1)",
  SLOW,
  () => {
    it.each([
      { link: "untracked", tracked: false, glob: "dist/**" },
      { link: "tracked", tracked: true, glob: "**/dist/**" },
      { link: "tracked", tracked: true, glob: "dist/**" },
    ])(
      "keys each worktree by its own build through an $link link declared $glob, so neither inherits the other's pass, and re-keys on its edit",
      async ({ tracked, glob }) => {
        const { repo, second } = linkedBuilds(tracked);
        const store = openRepoStore(repo.commonDir);
        const declared = {
          ...options(),
          policy: { ...policy, inputs: { [STRINGS]: [glob, "build.json"] } },
        };
        const a = await openHarness(repo.main, store, repo.commonDir, declared);
        await a.scheduler.start();
        await expect.poll(() => a.runsOf(STRINGS).length, { timeout: 60_000 }).toBe(1);
        await a.scheduler.idle();
        expect(a.scheduler.extraFiles()).toContain("dist/index.js");

        const b = await openHarness(second, store, repo.commonDir, declared);
        await b.scheduler.start();
        expect(b.scheduler.extraFiles()).toContain("dist/index.js");
        expect(b.keyOf(STRINGS)).not.toBe(a.keyOf(STRINGS));
        // B's build differs, so B runs the slow file itself instead of inheriting A's pass.
        await expect.poll(() => b.runsOf(STRINGS).length, { timeout: 60_000 }).toBe(1);
        await b.scheduler.idle();

        const before = a.keyOf(STRINGS);
        a.write("real-build/index.js", "export const build = 'a2';\n");
        await a.batch("dist/index.js");
        expect(a.keyOf(STRINGS)).not.toBe(before);
        // The same build in both worktrees shares the key.
        a.write("real-build/index.js", "export const build = 'b';\n");
        await a.batch("dist/index.js");
        expect(a.keyOf(STRINGS)).toBe(b.keyOf(STRINGS));
        await a.scheduler.idle();
      },
    );
  },
);

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

  it.each([
    { where: "an ignored directory", linked: false },
    { where: "a tracked build link", linked: true },
  ])(
    "joins a file a rebuild only adds in $where at the next interval reconciliation (004-33)",
    async ({ linked }) => {
      const { repo } = linked ? linkedBuilds(true) : { repo: repoWithIgnoredDist() };
      const store = openRepoStore(repo.commonDir);
      const glob = linked ? "**/dist/**" : "dist/**";
      const h = await openHarness(repo.main, store, repo.commonDir, {
        ...options(),
        policy: { ...policy, inputs: { [STRINGS]: [glob] } },
      });
      const build = linked ? "real-build" : "dist";
      h.write(`${build}/index.js`, "export const build = 'a';\n");
      await h.scheduler.start();
      await h.scheduler.idle();
      const before = h.keyOf(STRINGS);
      expect(before).not.toBeNull();

      // No watch batch reports an addition under an ignored directory.
      h.write(`${build}/chunk.js`, "export const chunk = 1;\n");
      await h.scheduler.handleBatch({ trigger: "interval", paths: [] });
      expect(h.scheduler.extraFiles()).toContain("dist/chunk.js");
      const added = h.keyOf(STRINGS);
      expect(added).not.toBe(before);
      // A pass that finds nothing new leaves the key, and the chunk is watched from here on.
      await h.scheduler.handleBatch({ trigger: "interval", paths: [] });
      expect(h.keyOf(STRINGS)).toBe(added);
      h.write(`${build}/chunk.js`, "export const chunk = 2;\n");
      await h.batch("dist/chunk.js");
      expect(h.keyOf(STRINGS)).not.toBe(added);
      await h.scheduler.idle();
    },
  );

  it.each([
    { where: "an ignored directory", linked: false },
    { where: "a tracked build link", linked: true },
  ])(
    "joins a file a rebuild adds in $where at an interval that also finds a source edit (reviews/wave-4.6.md B1)",
    async ({ linked }) => {
      const { repo } = linked ? linkedBuilds(true) : { repo: repoWithIgnoredDist() };
      const store = openRepoStore(repo.commonDir);
      const glob = linked ? "**/dist/**" : "dist/**";
      const h = await openHarness(repo.main, store, repo.commonDir, {
        ...options(),
        policy: { ...policy, inputs: { [STRINGS]: [glob] } },
      });
      const build = linked ? "real-build" : "dist";
      h.write(`${build}/index.js`, "export const build = 'a';\n");
      await h.scheduler.start();
      await expect.poll(() => h.runsOf(STRINGS).length, { timeout: 60_000 }).toBe(1);
      await h.scheduler.idle();
      const before = h.keyOf(STRINGS);
      const math = h.keyOf(MATH);

      // No watch batch reports the addition; the interval pass hands over a tracked source edit.
      h.write(`${build}/late.js`, "export const late = 1;\n");
      h.write("src/math.ts", "export const add = (a: number, b: number) => b + a;\n");
      const hasher = createFsHasher(repo.main, "sha1");
      const paths = await statCandidates(["src/math.ts"], hasher);
      await h.scheduler.handleBatch({ trigger: "interval", paths });

      expect(h.scheduler.extraFiles()).toContain("dist/late.js");
      expect(h.keyOf(STRINGS)).not.toBe(before);
      // The source edit stays in the same revision.
      expect(h.keyOf(MATH)).not.toBe(math);
      const changed = store.revisions.latest(h.worktreeId)?.changes.map((c) => c.path);
      expect(changed).toEqual(["dist/late.js", "src/math.ts"]);
      await expect.poll(() => h.runsOf(STRINGS).length, { timeout: 60_000 }).toBe(2);
      await h.scheduler.idle();
    },
  );

  it("does not touch the runner for an ignored input an interval lists with its bytes unchanged", async () => {
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, options());
    // Seen by git at start, so hashed and not watched; ignored from here on.
    h.write("dist/index.js", "export const build = 'a';\n");
    await h.scheduler.start();
    await h.scheduler.idle();
    expect(h.scheduler.extraFiles()).not.toContain("dist/index.js");
    appendFileSync(join(repo.main, ".gitignore"), "dist/\n");
    // Rewritten with the same bytes: its stat moves, its content does not.
    h.write("dist/index.js", "export const build = 'a';\n");
    const later = new Date(Date.now() + 5_000);
    utimesSync(join(repo.main, "dist/index.js"), later, later);
    const invalidated: InvalidatedPath[] = [];
    const invalidate = h.runner.invalidate;
    Object.assign(h.runner, {
      invalidate: (paths: readonly InvalidatedPath[]) => {
        invalidated.push(...paths);
        return invalidate(paths);
      },
    });

    const key = h.keyOf(STRINGS);
    await h.scheduler.handleBatch({ trigger: "interval", paths: [] });
    await h.scheduler.idle();
    expect(h.scheduler.extraFiles()).toContain("dist/index.js");
    expect(h.keyOf(STRINGS)).toBe(key);
    expect(invalidated).toEqual([]);
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
