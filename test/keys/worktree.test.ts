import { cpSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readObjectFormat, StatCache, seedStatCache } from "../../src/core/hash/index.js";
import {
  assembleClosure,
  coreEnvironmentInputs,
  environmentHash,
  installedDependenciesFingerprint,
  KeyIndex,
  selectDeclaredInputs,
} from "../../src/core/keys/index.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/index.js";
import { git, initRepo, tempDir, writeFile } from "../hash/git-repo.js";

const FIXTURE = join(import.meta.dirname, "../fixtures/keys/project");
const testFile: TestFileRef = { project: "", path: "test/math.test.ts" };

const listFiles = (root: string, dir = root): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".git" || entry.name === "node_modules") return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(root, path) : [relative(root, path)];
  });

/** Everything the daemon would do to key the fixture's one test file in a worktree. */
async function keyOf(root: string): Promise<CheckKey | null> {
  const files = listFiles(root);
  const cache = new StatCache();
  await seedStatCache(cache, root, files, { objectFormat: await readObjectFormat(root) });

  const core = coreEnvironmentInputs({
    squealVersion: "0.0.0",
    installedDependencies: await installedDependenciesFingerprint(root, root),
    allowlist: [],
  });
  const runner = {
    project: "",
    runnerName: "vitest",
    runnerVersion: "5.0.3",
    adapterVersion: "1",
    resolvedConfig: "{}",
    files: ["package.json"],
  };
  const index = new KeyIndex((path) => cache.hashOf(path));
  index.setEnvironment(
    "",
    environmentHash(core, runner, (path) => cache.hashOf(path)),
  );
  index.setClosure(
    assembleClosure(
      {
        testFile,
        paths: ["src/math.ts", "src/util/index.ts", "test/__snapshots__/math.test.ts.snap"],
      },
      selectDeclaredInputs(["test/data/**"], files),
    ),
  );
  return index.key(testFile);
}

describe("check key across worktrees", () => {
  const dir = tempDir();
  const main = join(dir.path, "main");
  const other = join(dir.path, "elsewhere/deeper/other-worktree");

  beforeAll(() => {
    initRepo(main, {});
    cpSync(FIXTURE, main, { recursive: true });
    writeFile(main, "node_modules/.package-lock.json", '{"packages":{}}');
    writeFile(main, ".gitignore", "node_modules/\n");
    git(main, ["add", "-A"]);
    git(main, ["commit", "-qm", "fixture"]);
    git(main, ["worktree", "add", "-q", "-b", "other", other]);
    writeFile(other, "node_modules/.package-lock.json", '{"packages":{}}');
  });
  afterAll(() => dir.cleanup());

  it("is identical for a worktree copy at another absolute path", async () => {
    const key = await keyOf(main);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(await keyOf(other)).toBe(key);
  });

  it("is identical when one copy's files are dirty but byte-equal", async () => {
    // Same bytes, new mtime, untracked input in both: hashed from bytes, not the index.
    writeFile(other, "src/math.ts", git(main, ["show", "HEAD:src/math.ts"]));
    writeFile(main, "test/data/extra.json", "{}\n");
    writeFile(other, "test/data/extra.json", "{}\n");
    expect(await keyOf(other)).toBe(await keyOf(main));
  });

  it("differs once a closure file differs, and matches again when it is restored", async () => {
    const key = await keyOf(main);
    const original = git(main, ["show", "HEAD:src/util/index.ts"]);
    writeFile(other, "src/util/index.ts", `${original}// edit\n`);
    expect(await keyOf(other)).not.toBe(key);
    writeFile(other, "src/util/index.ts", original);
    expect(await keyOf(other)).toBe(key);
  });
});
