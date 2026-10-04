import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkIgnored, gitStatus } from "../../src/core/watcher/git.js";
import { buildWatchSpec, sameWatchSpec } from "../../src/core/watcher/watch-spec.js";
import { git, makeRepo } from "./helpers.js";

function write(root: string, path: string, content = "x\n"): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

describe("git helpers", () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeRepo());
  });
  afterEach(() => cleanup());

  it("classifies a batch with one check-ignore call", async () => {
    const ignored = await checkIgnored(root, ["src/a.ts", "out/gen.js", "src/x.log", "gone/y.log"]);
    expect([...ignored].sort()).toEqual(["gone/y.log", "out/gen.js", "src/x.log"]);
    expect(await checkIgnored(root, [])).toEqual(new Set());
  });

  it("reports dirty paths and nested repositories from git status", async () => {
    write(root, "src/a.ts", "changed\n");
    write(root, "new/deep/file.ts");
    write(root, "src/debug.log");
    git(root, "rm", "-q", "README.md");
    mkdirSync(join(root, "new/nested"), { recursive: true });
    git(join(root, "new/nested"), "init", "-q");
    const status = await gitStatus(root);
    expect(status.paths).toEqual(["README.md", "new/deep/file.ts", "src/a.ts"]);
    expect(status.nestedRepos).toEqual(["new/nested"]);
  });
});

describe("buildWatchSpec", () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeRepo());
  });
  afterEach(() => cleanup());

  it("excludes .git and ignored output", async () => {
    write(root, "node_modules/pkg/index.js");
    write(root, "src/debug.log");
    const spec = await buildWatchSpec(root);
    expect(spec.root).toBe(root);
    expect(spec.excluded).toEqual(
      [".git", "node_modules", "out", "src/debug.log"].map((p) => join(root, p)),
    );
    expect(spec.extraFiles).toEqual([]);
  });

  it("excludes every nested directory that contains a .git entry", async () => {
    for (const dir of ["src/nested", "untracked/deeper/clone"]) {
      mkdirSync(join(root, dir), { recursive: true });
      git(join(root, dir), "init", "-q");
    }
    write(root, "untracked/deeper/plain.ts");
    const spec = await buildWatchSpec(root);
    expect(spec.excluded).toContain(join(root, "src/nested"));
    expect(spec.excluded).toContain(join(root, "untracked/deeper/clone"));
    expect(spec.excluded).not.toContain(join(root, "untracked"));
  });

  it("excludes a registered submodule even when it is clean", async () => {
    const sub = join(root, "vendor/lib");
    mkdirSync(sub, { recursive: true });
    git(sub, "init", "-q");
    write(root, "vendor/lib/index.ts");
    git(sub, "add", ".");
    git(sub, "-c", "user.email=a@b.c", "-c", "user.name=a", "commit", "-q", "-m", "sub");
    write(root, ".gitmodules", '[submodule "lib"]\n\tpath = vendor/lib\n\turl = ./vendor/lib\n');
    git(root, "add", ".gitmodules", "vendor/lib");
    git(root, "commit", "-q", "-m", "add submodule");
    expect((await gitStatus(root)).nestedRepos).toEqual([]);
    const spec = await buildWatchSpec(root);
    expect(spec.excluded).toContain(sub);
  });

  it("keeps a directory watched when only its current contents are ignored", async () => {
    write(root, "logs/today.log");
    const spec = await buildWatchSpec(root);
    expect(spec.excluded).not.toContain(join(root, "logs"));
  });

  it("carries extra files as absolute paths and compares specs by content", async () => {
    const a = await buildWatchSpec(root, ["out/gen.js"]);
    expect(a.extraFiles).toEqual([join(root, "out/gen.js")]);
    expect(sameWatchSpec(a, await buildWatchSpec(root, ["out/gen.js"]))).toBe(true);
    expect(sameWatchSpec(a, await buildWatchSpec(root))).toBe(false);
  });
});
