import { appendFileSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkIgnored } from "../../src/core/watcher/git.js";
import { git, makeRepo } from "./helpers.js";

function write(root: string, path: string, content = "x\n"): void {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

const sorted = (set: Set<string>) => [...set].sort();

/*
 * Task 001-118 (review wave 11f, B1): a path beyond a symlinked directory takes
 * the class of the link, as git ignores the link's own path or a directory there.
 */
describe("checkIgnored beyond a symlinked directory", () => {
  let root: string;
  let cleanup: () => void;

  beforeEach(() => {
    ({ root, cleanup } = makeRepo());
    write(root, "../shared/.package-lock.json", "{}\n");
    write(root, "../linked-source/a.ts");
  });
  afterEach(() => cleanup());

  it("ignores what is beyond a link a directory-only pattern names (`node_modules/`)", async () => {
    symlinkSync("../shared", join(root, "node_modules"));
    const ignored = await checkIgnored(root, ["node_modules", "node_modules/.package-lock.json"]);
    // The link itself is a file to git, which `node_modules/` does not match.
    expect(sorted(ignored)).toEqual(["node_modules/.package-lock.json"]);
  });

  it("ignores what is beyond a link a pattern without a slash names", async () => {
    appendFileSync(join(root, ".gitignore"), "/deps\n");
    symlinkSync("../shared", join(root, "deps"));
    const ignored = await checkIgnored(root, ["deps", "deps/.package-lock.json"]);
    expect(sorted(ignored)).toEqual(["deps", "deps/.package-lock.json"]);
  });

  it("applies info/exclude and patterns from a nested .gitignore above the link", async () => {
    git(root, "config", "core.excludesFile", "/nonexistent");
    appendFileSync(join(root, ".git/info/exclude"), "vendor/\n");
    write(root, "pkg/.gitignore", "cache/\n");
    symlinkSync("../shared", join(root, "vendor"));
    symlinkSync("../../shared", join(root, "pkg/cache"));
    symlinkSync("../../linked-source", join(root, "pkg/lib"));
    const ignored = await checkIgnored(root, [
      "vendor/.package-lock.json",
      "pkg/cache/.package-lock.json",
      "pkg/lib/a.ts",
    ]);
    expect(sorted(ignored)).toEqual(["pkg/cache/.package-lock.json", "vendor/.package-lock.json"]);
  });

  it("does not ignore what is beyond a committed source link", async () => {
    symlinkSync("../linked-source", join(root, "lib"));
    git(root, "add", "lib");
    git(root, "commit", "-qm", "link");
    const ignored = await checkIgnored(root, ["lib", "lib/a.ts", "lib/added.test.ts", "x.log"]);
    expect(sorted(ignored)).toEqual(["x.log"]);
  });

  it("does not ignore what is beyond an untracked source link, while patterns still apply elsewhere", async () => {
    symlinkSync("../linked-source", join(root, "lib"));
    symlinkSync("../shared", join(root, "node_modules"));
    const ignored = await checkIgnored(root, [
      "lib/a.ts",
      "node_modules/.package-lock.json",
      "out/gen.js",
      "src/a.ts",
    ]);
    expect(sorted(ignored)).toEqual(["node_modules/.package-lock.json", "out/gen.js"]);
  });

  it("costs one more git call only for a batch that reaches a link", async () => {
    symlinkSync("../shared", join(root, "node_modules"));
    const plain = ["src/a.ts", "out/gen.js"];
    const linked = [...plain, "node_modules/.package-lock.json"];
    const time = async (paths: string[]) => {
      const start = performance.now();
      for (let i = 0; i < 10; i++) await checkIgnored(root, paths);
      return (performance.now() - start) / 10;
    };
    await time(linked);
    const [plainMs, linkedMs] = [await time(plain), await time(linked)];
    console.log(
      `checkIgnored: ${plainMs.toFixed(1)} ms plain, ${linkedMs.toFixed(1)} ms via a link`,
    );
    // Two git processes against one, and a scratch tree of one .gitignore. A loaded host stretches
    // a spawn to tens of milliseconds, so only an order of magnitude is asserted.
    expect(linkedMs).toBeLessThan(plainMs * 10 + 100);
  });
});
