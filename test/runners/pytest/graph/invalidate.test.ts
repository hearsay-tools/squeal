import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPytestGraph, type PytestGraph } from "../../../../src/runners/pytest/graph/index.js";
import { changed, closures, copyFixture, holding, testFilesOf } from "./helpers.js";

/**
 * Spec 007 D5 and the graph tests of its Testing list, on a copy of the
 * small fixture without an environment: a new module that shadows another,
 * a new `_fast` module behind `try/except ImportError` and a new
 * `__init__.py` re-key exactly the test files whose closure named the path
 * as a candidate; a conftest edit is `direct` for its directory.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function small(): Promise<{ root: string; graph: PytestGraph; testFiles: string[] }> {
  const { root, cleanup } = copyFixture("small");
  cleanups.push(cleanup);
  const testFiles = testFilesOf(root);
  const graph = await createPytestGraph({ root, cwd: root, env: null, testFiles });
  return { root, graph, testFiles };
}

describe("pytest graph: re-keying through candidates (D5)", () => {
  const IMPORT_APP = [
    "outcomes/test_collection_error.py",
    "outcomes/test_pass.py",
    "tests/test_entry_plugin.py",
    "tests/test_resources.py",
    "tests/unit/test_core.py",
  ];
  it.each([
    ["a rootdir module shadowing a package", "app.py", "X = 1\n", IMPORT_APP],
    [
      "a new _fast module behind try/except ImportError",
      "src/app/fast_impl.py",
      "X = 1\n",
      ["tests/unit/test_core.py"],
    ],
    [
      "a new __init__.py turning a namespace into a package",
      "packages/other/src/acme/__init__.py",
      "",
      ["tests/unit/test_core.py"],
    ],
  ])(
    "%s re-keys exactly the files whose candidates name it",
    async (_, path, content, importers) => {
      const { root, graph, testFiles } = await small();
      const before = closures(graph, testFiles);
      const named = holding(before, path);
      expect(named).toEqual(importers);

      writeFileSync(join(root, path), content);
      graph.invalidate([{ path, kind: "add" }]);
      const after = closures(graph, testFiles);
      // Every other file keeps its closure and so its key; a named file's key
      // changes because the path now exists (and its closure may change with it).
      for (const file of testFiles.filter((f) => !named.includes(f))) {
        expect(after.get(file), file).toEqual(before.get(file));
      }
      expect(changed(before, after).every((f) => named.includes(f))).toBe(true);
      expect(holding(after, path)).toEqual(named);
      expect(graph.affected([path]).direct.length + graph.affected([path]).transitive.length).toBe(
        named.length,
      );
    },
  );

  it("re-resolves a shadowing module: the rootdir app.py replaces src/app in every closure", async () => {
    const { root, graph } = await small();
    expect(graph.closure("tests/test_entry_plugin.py").paths).toContain("src/app/version.py");
    writeFileSync(join(root, "app.py"), "VERSION = 1\n");
    graph.invalidate([{ path: "app.py", kind: "add" }]);
    const paths = graph.closure("tests/test_entry_plugin.py").paths;
    expect(paths).toContain("app.py");
    expect(paths).not.toContain("src/app/version.py");
  });

  it("re-parses a content edit and follows a new import", async () => {
    const { root, graph } = await small();
    expect(graph.closure("tests/test_entry_plugin.py").paths).not.toContain("src/app/lazy.py");
    writeFileSync(join(root, "tests/plugins/extra.py"), "from app import lazy\n");
    graph.invalidate([{ path: "tests/plugins/extra.py", kind: "change" }]);
    expect(graph.closure("tests/test_entry_plugin.py").paths).toContain("src/app/lazy.py");
  });
});

describe("pytest graph: affected (D5)", () => {
  it("makes a conftest's directory and below direct", async () => {
    const { graph, testFiles } = await small();
    const affected = graph.affected(["tests/unit/conftest.py"]);
    expect(affected).toEqual({ direct: ["tests/unit/test_core.py"], transitive: [] });
    const root = graph.affected(["tests/conftest.py"]);
    expect(root.direct).toEqual(testFiles.filter((f) => f.startsWith("tests/")));
  });

  it("splits one-hop importers from transitive holders", async () => {
    const { graph } = await small();
    // test_core imports app.core directly; the root conftest's plugin and version reach others.
    const core = graph.affected(["src/app/core.py"]);
    expect(core.direct).toEqual(["tests/unit/test_core.py"]);
    const version = graph.affected(["src/app/version.py"]);
    expect(version.direct).toEqual([]);
    expect(version.transitive).toEqual(
      expect.arrayContaining(["tests/test_entry_plugin.py", "tests/unit/test_core.py"]),
    );
    expect(graph.affected(["tests/test_resources.py"]).direct).toEqual(["tests/test_resources.py"]);
  });

  it("counts a file whose run started a process that imported a changed path as its direct importer (007-55)", async () => {
    const { graph } = await small();
    graph.recordObserved("tests/test_resources.py", ["src/app/lazy.py"]);
    graph.recordSpawned("tests/test_resources.py", ["src/app/lazy.py", "src/app/version.py"]);
    // An observed path alone is transitive; the file whose child imported it is direct.
    expect(graph.affected(["src/app/lazy.py"])).toEqual({
      direct: ["tests/test_resources.py"],
      transitive: ["tests/unit/test_core.py"],
    });
    const version = graph.affected(["src/app/version.py"]);
    expect(version.direct).toEqual(["tests/test_resources.py"]);
    expect(version.transitive).toContain("tests/unit/test_core.py");
  });

  it("schedules a file whose last run loaded a changed path outside its closure", async () => {
    const { graph } = await small();
    graph.recordObserved("tests/test_resources.py", ["src/app/data/values.json"]);
    expect(graph.affected(["src/app/data/values.json"]).transitive).toEqual([
      "tests/test_resources.py",
    ]);
  });
});

describe("pytest graph: without an environment (D4 as amended)", () => {
  it("does not let a tests/typing/ directory capture the stdlib typing", async () => {
    const { root, cleanup } = copyFixture("layouts");
    cleanups.push(cleanup);
    writeFileSync(join(root, "tests/test_typed.py"), "import typing\nfrom typing import Any\n");
    const testFiles = testFilesOf(root);
    const plain = closures(
      await createPytestGraph({ root, cwd: root, env: null, testFiles }),
      testFiles,
    );
    mkdirSync(join(root, "tests/typing"));
    writeFileSync(join(root, "tests/typing/test_hints.py"), "def test_x():\n    pass\n");
    const graph = await createPytestGraph({ root, cwd: root, env: null, testFiles });
    expect(graph.closure("tests/test_typed.py").paths).toEqual(plain.get("tests/test_typed.py"));
    expect(graph.closure("tests/test_typed.py").paths).not.toContain("tests/typing/Any.py");
  });

  it("names a layout it does not read", async () => {
    const { root, cleanup } = copyFixture("layouts");
    cleanups.push(cleanup);
    writeFileSync(join(root, "packages/sflat/setup.py"), "from setuptools import setup\nsetup()\n");
    const graph = await createPytestGraph({ root, cwd: root, env: null, testFiles: [] });
    expect(graph.notes()).toEqual([
      "pytest: packages/sflat: setup.py present; its code is not read, resolved with an environment only",
    ]);
  });
});

describe("pytest graph: plugin closures for the environment hash (D2)", () => {
  it("resolves a pytest11 plugin module and its imports inside the worktree", async () => {
    const { graph } = await small();
    const plugin = graph.pluginClosure(["other.plugin"]);
    expect(plugin.complete).toBe(true);
    expect(plugin.paths).toEqual(
      expect.arrayContaining([
        "packages/other/src/other/__init__.py",
        "packages/other/src/other/calc.py",
        "packages/other/src/other/plugin.py",
      ]),
    );
    expect(plugin.paths).not.toContain("tests/conftest.py");
  });
});
