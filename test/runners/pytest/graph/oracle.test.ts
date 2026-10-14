import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createPytestGraph } from "../../../../src/runners/pytest/graph/index.js";
import {
  PYTHONS,
  type PythonVersion,
  requireSynced,
  type Synced,
  syncFixture,
} from "../../../helpers/pytest-env.js";
import { closureHash, closures, FIXTURES, isConftest, testFilesOf } from "./helpers.js";

/**
 * Spec 007 Testing, graph tests: the closure of every small-fixture test
 * file equals the one `ast_graph.py` gives through the interpreter's own
 * finders, on 3.10 and 3.13, with the environment and without it (roots
 * derived from `pyproject.toml`); the candidates are a superset of the
 * oracle's (007-04's rule scans past a winner outside the worktree), and
 * equal with and without the environment, so the closure hashes are equal.
 */

interface OracleFile {
  readonly module: string;
  readonly edges: readonly string[];
  readonly candidates: readonly string[];
}

const SLOW = { timeout: 120_000 } as const;
const synced = new Map<PythonVersion, Synced>();
const sync = (version: PythonVersion) => {
  let s = synced.get(version);
  if (s === undefined) {
    s = syncFixture(join(FIXTURES, "small"), version);
    synced.set(version, s);
  }
  return s;
};
afterAll(() => {
  for (const s of synced.values()) if (s.ok) s.env.cleanup();
});

/** The oracle's closure: the file, its conftest chain and `pytest_plugins`, then edges. */
function oracleClosure(root: string, files: Record<string, OracleFile>, testFile: string) {
  const byModule = new Map(Object.entries(files).map(([path, f]) => [f.module, path]));
  const chain: string[] = [];
  for (let dir = dirname(testFile); ; dir = dirname(dir)) {
    const conftest = dir === "." ? "conftest.py" : `${dir}/conftest.py`;
    if (files[conftest]) chain.push(conftest);
    if (dir === ".") break;
  }
  const seen = new Set<string>();
  const candidates = new Set<string>();
  const todo = [testFile, ...chain];
  while (todo.length > 0) {
    const path = todo.pop() as string;
    if (seen.has(path)) continue;
    seen.add(path);
    const file = files[path];
    if (file === undefined) continue;
    todo.push(...file.edges);
    for (const c of file.candidates) candidates.add(c);
    if (isConftest(path) || path === testFile) {
      const source = readFileSync(join(root, path), "utf8");
      const listed = /^pytest_plugins\s*=\s*\[([^\]]*)\]/m.exec(source)?.[1] ?? "";
      for (const name of listed.match(/[\w.]+/g) ?? []) {
        const plugin = byModule.get(name);
        if (plugin !== undefined) todo.push(plugin);
      }
    }
  }
  return { files: [...seen].sort(), candidates: [...candidates].sort() };
}

describe.each(PYTHONS)("pytest graph against the ast_graph.py oracle on Python %s", (version) => {
  it("gives every test file the oracle's closure, with and without .venv", SLOW, async (ctx) => {
    const env = requireSynced(ctx, sync(version));
    const out = join(env.root, "..", "oracle.json");
    execFileSync(
      env.python,
      ["-I", join(FIXTURES, "ast_graph.py"), env.root, out, "--skip-type-checking"],
      { env: env.env, stdio: "ignore" },
    );
    const oracle = JSON.parse(readFileSync(out, "utf8")).files as Record<string, OracleFile>;
    const testFiles = testFilesOf(env.root);
    expect(testFiles.length).toBeGreaterThan(5);

    const synced = await createPytestGraph({
      root: env.root,
      cwd: env.root,
      env: join(env.root, ".venv"),
      testFiles,
    });
    expect(synced.searchPath().source).toBe("environment");
    const withEnv = closures(synced, testFiles);

    const away = join(env.root, "..", "venv-away");
    renameSync(join(env.root, ".venv"), away);
    try {
      const bare = await createPytestGraph({ root: env.root, cwd: env.root, env: null, testFiles });
      expect(bare.searchPath().source).toBe("derived");
      expect(bare.notes()).toEqual([]);
      const withoutEnv = closures(bare, testFiles);
      for (const testFile of testFiles) {
        const paths = withEnv.get(testFile) ?? [];
        const expected = oracleClosure(env.root, oracle, testFile);
        const present = paths.filter((p) => existsSync(join(env.root, p)));
        const absent = paths.filter((p) => !existsSync(join(env.root, p)));
        expect(present, testFile).toEqual(expected.files);
        expect(absent, testFile).toEqual(expect.arrayContaining(expected.candidates));
        expect(withoutEnv.get(testFile), testFile).toEqual(paths);
        expect(closureHash(env.root, withoutEnv.get(testFile) ?? [])).toBe(
          closureHash(env.root, paths),
        );
      }
    } finally {
      renameSync(away, join(env.root, ".venv"));
    }

    // The edge-case file's reasons and exclusions hold in each test file that reaches it.
    const unit = synced.closure("tests/unit/test_core.py");
    expect(unit.paths).toContain("src/app/core.py");
    expect(unit.paths).not.toContain("src/app/typing_only.py");
    expect(unit.complete).toBe(false);
    expect(unit.incomplete).toEqual(["src/app/core.py:35: computed import"]);
  });
});
