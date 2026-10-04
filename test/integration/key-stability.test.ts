import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readObjectFormat, StatCache, seedStatCache } from "../../src/core/hash/index.js";
import {
  assembleClosure,
  coreEnvironmentInputs,
  environmentHash,
  installedDependenciesFingerprint,
  KeyIndex,
} from "../../src/core/keys/index.js";
import type { CheckKey, RunnerClosure, TestFileRef } from "../../src/core/types/index.js";
import { createVitestAdapter } from "../../src/runners/vitest/index.js";
import { git, initRepo, writeFile } from "../hash/git-repo.js";

const fixturesDir = resolve(import.meta.dirname, "../fixtures/vitest");
/** Inside the repository, so the fixture resolves `vitest` from its `node_modules`. Git-ignored. */
const scratchDir = join(fixturesDir, ".tmp");

const SLOW = { timeout: 120_000 } as const;

const api: TestFileRef = { project: "", path: "test/api.test.ts" };
const math: TestFileRef = { project: "", path: "test/math.test.ts" };
const id = (ref: TestFileRef) => `${ref.project}:${ref.path}`;

const listFiles = (root: string, dir = root): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === ".git" || entry.name === "node_modules") return [];
    const path = join(dir, entry.name);
    return entry.isDirectory()
      ? listFiles(root, path)
      : [relative(root, path).split(sep).join("/")];
  });

interface Keyed {
  readonly keys: ReadonlyMap<string, CheckKey | null>;
  readonly closures: readonly RunnerClosure[];
}

/**
 * Everything the daemon would do to key every test file of a worktree, from
 * real adapter output. With `stored`, closures come from the store instead
 * of the adapter, as at bootstrap (D5 step 3).
 */
async function keysOf(root: string, stored?: readonly RunnerClosure[]): Promise<Keyed> {
  const adapter = await createVitestAdapter({ root });
  try {
    const environments = await adapter.environment();
    const closures =
      stored ?? (await Promise.all((await adapter.testFiles()).map((ref) => adapter.closure(ref))));

    const cache = new StatCache();
    const paths = new Set([
      ...listFiles(root),
      ...environments.flatMap((e) => e.files),
      ...closures.flatMap((c) => c.paths),
    ]);
    await seedStatCache(cache, root, [...paths], { objectFormat: await readObjectFormat(root) });
    const hashOf = (path: string) => cache.hashOf(path);

    const core = coreEnvironmentInputs({
      squealVersion: "0.0.0",
      installedDependencies: await installedDependenciesFingerprint(root, root),
      allowlist: [],
    });
    const index = new KeyIndex(hashOf);
    for (const env of environments) {
      index.setEnvironment(env.project, environmentHash(core, env, hashOf));
    }
    for (const closure of closures) index.setClosure(assembleClosure(closure, []));
    return {
      keys: new Map(closures.map((c) => [id(c.testFile), index.key(c.testFile)])),
      closures,
    };
  } finally {
    await adapter.close();
  }
}

describe("check keys from the Vitest adapter across worktrees (review S9, B1)", SLOW, () => {
  const dir = join(scratchDir, `key-stability-${randomUUID()}`);
  const main = join(dir, "main");
  const other = join(dir, "elsewhere/other-worktree");

  beforeAll(() => {
    mkdirSync(scratchDir, { recursive: true });
    initRepo(main, {});
    cpSync(join(fixturesDir, "basic"), main, { recursive: true });
    // Imports a module that does not exist yet in this commit.
    writeFile(
      main,
      "test/api.test.ts",
      [
        'import { expect, it } from "vitest";',
        'import { client } from "../src/client";',
        'it("calls the client", () => { expect(client()).toBe(1); });',
        "",
      ].join("\n"),
    );
    git(main, ["add", "-A"]);
    git(main, ["commit", "-qm", "fixture"]);
    git(main, ["worktree", "add", "-q", "-b", "other", other]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("is identical in a git worktree add copy at another absolute path", async () => {
    const [a, b] = [await keysOf(main), await keysOf(other)];
    expect([...a.keys.keys()]).toEqual(
      [
        "test/api.test.ts",
        "test/each.test.ts",
        "test/greeting.test.ts",
        "test/math.test.ts",
        "test/strings.test.ts",
      ].map((path) => id({ project: "", path })),
    );
    for (const key of a.keys.values()) expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(b.keys).toEqual(a.keys);
    expect(b.closures).toEqual(a.closures);
  });

  it("differs when a stored closure list is keyed where the import target exists", async () => {
    const a = await keysOf(main);
    // Review B1 scenario 1: the other worktree has the module, the stored
    // closure list comes from the worktree that did not.
    writeFile(other, "src/client.ts", "export const client = () => 1;\n");
    try {
      const b = await keysOf(other, a.closures);
      expect(b.keys.get(id(api))).not.toBe(a.keys.get(id(api)));
      expect(b.keys.get(id(math))).toBe(a.keys.get(id(math)));
    } finally {
      rmSync(join(other, "src/client.ts"));
    }
  });

  it("differs when a stored closure list is keyed where the snapshot exists", async () => {
    const a = await keysOf(main);
    // Review B1 scenario 2: a snapshot committed in one worktree only.
    writeFile(other, "test/__snapshots__/math.test.ts.snap", "// snapshot\n");
    try {
      const b = await keysOf(other, a.closures);
      expect(b.keys.get(id(math))).not.toBe(a.keys.get(id(math)));
      expect(b.keys.get(id(api))).toBe(a.keys.get(id(api)));
    } finally {
      rmSync(join(other, "test/__snapshots__/math.test.ts.snap"));
    }
  });
});
