import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AbsolutePath, PytestProject, TestFileRef } from "../../../src/core/types/index.js";
import { createPytestAdapter } from "../../../src/runners/pytest/adapter.js";
import { fnmatchEx, listTestFiles } from "../../../src/runners/pytest/adapter-files.js";
import { requireSynced, type Synced, syncFixture } from "../../helpers/pytest-env.js";

/*
 * Spec 007 D3, task 007-35 (`lessons.md` defect 1): `testFiles()` walks what
 * `include` and pytest's `norecursedirs` allow. A `build` or `venv`
 * directory is listed when `norecursedirs = []`, and skipped under pytest's
 * default list with one note naming it; the environment directory, `.git`,
 * `__pycache__` and any virtual environment are never listed.
 */

const PROJECT: PytestProject = { name: "p", args: [], env: {}, include: ["**/test_*.py"] };
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tree(files: Record<string, string>): AbsolutePath {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "squeal-pytest-files-")));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root as AbsolutePath;
}

const TESTS = {
  "tests/test_a.py": "",
  "tests/build/test_x.py": "",
  "tests/venv/test_y.py": "",
  ".venv/pyvenv.cfg": "",
  ".venv/lib/test_env.py": "",
  ".git/test_git.py": "",
  "tests/__pycache__/test_cache.py": "",
};

function list(root: AbsolutePath, project: PytestProject = PROJECT) {
  const notes: string[] = [];
  return { files: listTestFiles(root, project, (text) => notes.push(text)), notes };
}

describe("listTestFiles (spec 007 D3, task 007-35)", () => {
  it("lists build and venv directories when norecursedirs is empty", () => {
    const root = tree({
      ...TESTS,
      "pyproject.toml": "[tool.pytest.ini_options]\nnorecursedirs = []\n",
    });
    expect(list(root)).toEqual({
      files: ["tests/build/test_x.py", "tests/test_a.py", "tests/venv/test_y.py"],
      notes: [],
    });
  });

  it("skips them under pytest's default list and names them in one note", () => {
    const root = tree({
      ...TESTS,
      "pyproject.toml": "[tool.pytest.ini_options]\naddopts = '-q'\n",
    });
    const { files, notes } = list(root);
    expect(files).toEqual(["tests/test_a.py"]);
    expect(notes).toEqual([
      "its norecursedirs skips 2 directories holding test files, which neither pytest nor Squeal runs until norecursedirs allows them: tests/build, tests/venv",
    ]);
  });

  it("never lists the environment directory, even without its pyvenv.cfg", () => {
    const root = tree({
      ".venv/test_env.py": "",
      "tests/test_a.py": "",
      "pytest.ini": "[pytest]\nnorecursedirs =\n",
    });
    expect(list(root).files).toEqual(["tests/test_a.py"]);
  });

  it("skips any virtual environment, as pytest does, and names none in the note", () => {
    const root = tree({
      "tests/test_a.py": "",
      "tests/envs/py/pyvenv.cfg": "",
      "tests/envs/py/test_site.py": "",
      ".tox/py/lib/test_tox.py": "",
    });
    expect(list(root)).toEqual({ files: ["tests/test_a.py"], notes: [] });
  });

  it("honours an ini norecursedirs and notes only directories holding python_files", () => {
    const root = tree({
      "tests/test_a.py": "",
      "tests/build/test_x.py": "",
      "tests/skipme/check_one.py": "",
      "tests/skipme/deep/check_two.py": "",
      "tests/skipthis/helper.py": "",
      "setup.cfg": "[tool:pytest]\nnorecursedirs = skip*\npython_files = check_*.py\n",
    });
    const { files, notes } = list(root, { ...PROJECT, include: ["tests/**/*.py"] });
    expect(files).toEqual(["tests/build/test_x.py", "tests/test_a.py"]);
    expect(notes).toEqual([
      expect.stringMatching(/skips 1 directory holding test files, .*: tests\/skipme$/),
    ]);
  });

  it("notes nothing for a skipped directory whose test files the globs exclude", () => {
    const root = tree({ "tests/test_a.py": "", "tests/build/test_x.py": "" });
    expect(list(root, { ...PROJECT, exclude: ["**/build/**"] })).toEqual({
      files: ["tests/test_a.py"],
      notes: [],
    });
  });
});

describe("a live config edit relists (task 007-42, wave 4 review S1)", () => {
  it("lists, drops and lists a build test as pytest.ini allows, disallows and re-allows it", async () => {
    const root = tree({
      "tests/test_b.py": "",
      "tests/build/test_a.py": "",
      "pytest.ini": "[pytest]\n",
    });
    const project: PytestProject = { ...PROJECT, include: ["tests/**/test_*.py"] };
    // No environment: the listing follows the config before any sync.
    const adapter = await createPytestAdapter(project, { root, source: {} });
    const listed = async () => (await adapter.testFiles()).map((f) => f.path);
    const edit = async (text: string) => {
      writeFileSync(join(root, "pytest.ini"), text);
      await adapter.invalidate([{ path: "pytest.ini", kind: "change" }]);
      return listed();
    };
    try {
      expect(await listed()).toEqual(["tests/test_b.py"]);
      expect(await edit("[pytest]\nnorecursedirs =\n")).toEqual([
        "tests/build/test_a.py",
        "tests/test_b.py",
      ]);
      expect(await edit("[pytest]\nnorecursedirs = build\n")).toEqual(["tests/test_b.py"]);
      expect(await edit("[pytest]\nnorecursedirs = .*\n")).toEqual([
        "tests/build/test_a.py",
        "tests/test_b.py",
      ]);
    } finally {
      await adapter.close();
    }
  });
});

describe("fnmatchEx (pytest's _pytest/pathlib.py)", () => {
  const path = "/w/tests/build/x" as AbsolutePath;
  it.each([
    ["x", true],
    ["?", true],
    ["[xy]", true],
    ["[!x]", false],
    ["build", false],
    ["build/x", true],
    ["tests/*", true],
    ["/w/*/x", true],
    ["s/build/x", false],
    ["{arch}", false],
    ["[x", false],
  ])("%s matches /w/tests/build/x: %s", (pattern, expected) => {
    expect(fnmatchEx(pattern, path)).toBe(expected);
  });
});

describe("the pytest adapter lists what norecursedirs allows (task 007-35)", () => {
  const small = resolve(import.meta.dirname, "../../fixtures/pytest/small");
  const project: PytestProject = { name: "small", args: [], env: {}, include: ["**/test_*.py"] };
  const added = ["tests/build/test_x.py", "tests/venv/test_y.py"];
  const ref = (path: string): TestFileRef => ({ project: "small", path });
  let synced: Synced = { ok: false, reason: "the sync did not run" };
  let scratch = "";
  beforeAll(() => {
    synced = syncFixture(small, "3.13");
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-pytest-norecurse-")));
  }, 300_000);
  afterAll(() => {
    if (synced.ok) synced.env.cleanup();
    if (scratch !== "") rmSync(scratch, { recursive: true, force: true });
  });

  it("notes the skipped directories, then lists and runs them once norecursedirs is empty", {
    timeout: 120_000,
  }, async (ctx) => {
    const fixture = requireSynced(ctx, synced);
    const root = realpathSync(fixture.root) as AbsolutePath;
    for (const path of added) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), "def test_here():\n    assert True\n");
    }
    writeFileSync(join(root, ".venv", "test_env.py"), "def test_env():\n    assert False\n");
    const { PYTHONDONTWRITEBYTECODE: _, ...source } = fixture.env;
    const notes: string[] = [];
    const adapter = await createPytestAdapter(project, {
      root,
      source,
      note: (text) => notes.push(text),
      cacheDir: join(scratch, "cache") as AbsolutePath,
    });
    const listed = async () => (await adapter.testFiles()).map((f) => f.path);
    try {
      const before = await listed();
      expect(before).not.toContain(added[0]);
      expect(before).not.toContain(added[1]);
      expect(notes).toContainEqual(
        expect.stringMatching(
          /^pytest project "small": its norecursedirs skips 2 directories .*: tests\/build, tests\/venv$/,
        ),
      );

      // Task 007-42: one live adapter, the config edited as a change.
      const config = join(root, "pyproject.toml");
      writeFileSync(
        config,
        readFileSync(config, "utf8").replace(
          "[tool.pytest.ini_options]\n",
          "[tool.pytest.ini_options]\nnorecursedirs = []\n",
        ),
      );
      const noted = notes.length;
      await adapter.invalidate([{ path: "pyproject.toml", kind: "change" }]);
      const after = await listed();
      expect(after).toEqual(expect.arrayContaining(added));
      expect(after.filter((f) => f.startsWith(".venv/"))).toEqual([]);
      expect(notes.slice(noted).filter((n) => n.includes("norecursedirs"))).toEqual([]);
      const report = await adapter.run(added.map(ref), {
        runId: "r0",
        logDir: join(scratch, "logs"),
        timeoutMs: 60_000,
      });
      expect(report).toMatchObject({ end: "completed", failure: null, fileErrors: [] });
      expect(report.completedFiles.map((f) => f.path)).toEqual(added);
      expect(report.results.map((r) => [r.check.fullName, r.outcome])).toEqual([
        ["test_here", "pass"],
        ["test_here", "pass"],
      ]);
    } finally {
      await adapter.close();
    }
  });
});
