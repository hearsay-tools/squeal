import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StatCache, seedStatCache } from "../../src/core/hash/index.js";
import { assembleClosure, KeyIndex } from "../../src/core/keys/index.js";
import type { TestFileRef } from "../../src/core/types/index.js";
import { git, initRepo, tempDir, writeFile } from "../hash/git-repo.js";

const testFile: TestFileRef = { project: "", path: "test/api.test.ts" };
const generated = "src/gen/client.ts";

describe("a closure with a gitignored generated file", () => {
  let dir: ReturnType<typeof tempDir>;
  let root: string;

  beforeEach(() => {
    dir = tempDir();
    root = join(dir.path, "repo");
    initRepo(root, {
      ".gitignore": "src/gen/\n",
      "src/api.ts": "export * from './gen/client';\n",
      "test/api.test.ts": "import '../src/api';\n",
    });
    writeFile(root, generated, "export const version = 1;\n");
  });
  afterEach(() => dir.cleanup());

  it("stays unkeyed until the path is hashed, then re-keys on change", async () => {
    // The daemon seeds what git lists; the ignored generated file is not among them.
    const tracked = git(root, ["ls-files", "-z"]).split("\0").filter(Boolean);
    expect(tracked).not.toContain(generated);
    const cache = new StatCache();
    await seedStatCache(cache, root, tracked, { objectFormat: "sha1" });
    const index = new KeyIndex((path) => cache.hashOf(path));
    index.setEnvironment("", "env1");

    const update = index.setClosure(
      assembleClosure({ testFile, paths: ["src/api.ts", generated] }, []),
    );

    expect(update).toEqual({ changes: [], untracked: [generated] });
    expect(index.key(testFile)).toBeNull();

    await seedStatCache(cache, root, update.untracked, { objectFormat: "sha1" });
    const [keyed] = index.rekey(update.untracked);
    expect(keyed).toEqual({ testFile, previous: null, key: expect.any(String) });

    // Codegen rewrites the file; once its new hash is in the cache, the key follows.
    writeFile(root, generated, "export const version = 2;\n");
    await seedStatCache(cache, root, [generated], { objectFormat: "sha1" });
    const [changed] = index.rekey([generated]);
    expect(changed).toEqual({ testFile, previous: keyed?.key, key: expect.any(String) });
    expect(changed?.key).not.toBe(keyed?.key);
  });
});
