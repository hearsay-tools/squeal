import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { seedPytest } from "../../src/cli/pytest-seed.js";
import type { AbsolutePath } from "../../src/core/types/index.js";
import { listTestFiles } from "../../src/runners/pytest/adapter-files.js";

/* Spec 007 D1's setup paragraph: one `pytest` entry per detected project, from files only. */

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A worktree with `files`, every one tracked but `untracked`. */
function worktree(files: Readonly<Record<string, string>>, untracked: readonly string[] = []) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pytest-seed-"))) as AbsolutePath;
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { root, tracked: Object.keys(files).filter((f) => !untracked.includes(f)) };
}

const PYPROJECT = '[project]\nname = "app"\n';

/** A root project with `testpaths` and `python_files`, and a service with its own `pytest.ini`. */
const TWO = {
  "pyproject.toml": `${PYPROJECT}\n[tool.pytest.ini_options]\ntestpaths = ["tests", "it"]\npython_files = "check_*.py"\n`,
  "uv.lock": "",
  "tests/check_a.py": "",
  ".venv/pyvenv.cfg": "home = /usr/bin\n",
  "services/api/pytest.ini": "[pytest]\naddopts = -q --lf\n",
  "services/api/tests/test_b.py": "",
  "docs/pyproject.toml": PYPROJECT,
  "test/fixtures/app/pyproject.toml": PYPROJECT,
  "test/fixtures/app/tests/test_c.py": "",
};

describe("seedPytest (spec 007 D1)", () => {
  it("seeds both projects of a two-project worktree and notes the refused addopts flag", () => {
    const { root, tracked } = worktree(TWO, [".venv/pyvenv.cfg"]);
    const seed = seedPytest(root, tracked, {});
    expect(seed.projects).toEqual([
      {
        name: "pytest",
        include: ["tests/**/check_*.py", "it/**/check_*.py"],
        exclude: ["**/__pypackages__/**"],
      },
      {
        name: "services/api",
        cwd: "services/api",
        include: ["**/test_*.py", "**/*_test.py"],
        exclude: [
          "**/__pypackages__/**",
          "**/.*/**",
          "**/*.egg/**",
          "**/_darcs/**",
          "**/build/**",
          "**/CVS/**",
          "**/dist/**",
          "**/node_modules/**",
          "**/venv/**",
        ],
      },
    ]);
    expect(seed.notes).toEqual([
      'seeded pytest project "pytest" from pyproject.toml',
      'seeded pytest project "services/api" from services/api/pytest.ini',
      'pytest project "services/api": Squeal does not run pytest with --lf (in addopts), which change what runs or wait for input; remove it there, or its checks stay unknown',
      'pytest project "services/api" has no environment yet; `uv sync` in services/api creates one',
    ]);
  });

  it.each([{ testpaths: undefined }, { testpaths: ["tests"] }, { testpaths: ["."] }])(
    "excludes PDM dependencies from seeded discovery with $testpaths",
    ({ testpaths }) => {
      const { root, tracked } = worktree({
        "pyproject.toml": `${PYPROJECT}\n[tool.pytest.ini_options]\nnorecursedirs = []\n${testpaths === undefined ? "" : `testpaths = ${JSON.stringify(testpaths)}\n`}`,
        "tests/test_project.py": "",
        "__pypackages__/3.11/lib/pkg/tests/test_dependency.py": "",
        "tests/nested/__pypackages__/3.11/lib/pkg/tests/test_nested.py": "",
      });
      const [entry] = seedPytest(root, tracked, {}).projects;
      expect(entry).toBeDefined();
      expect(entry?.exclude).toContain("**/__pypackages__/**");
      if (entry) {
        expect(listTestFiles(root, { ...entry, args: [], env: {} })).toEqual([
          "tests/test_project.py",
        ]);
      }
    },
  );

  it("keeps explicitly rooted dependency testpaths available", () => {
    const path = "__pypackages__/3.11/lib/pkg/tests";
    const { root, tracked } = worktree({
      "pytest.ini": `[pytest]\ntestpaths = tests ${path}\n`,
      "tests/test_project.py": "",
      [`${path}/test_dependency.py`]: "",
      "other/__pypackages__/3.11/lib/pkg/tests/test_other.py": "",
    });
    const [entry] = seedPytest(root, tracked, {}).projects;
    expect(entry).toBeDefined();
    if (entry) {
      expect(listTestFiles(root, { ...entry, args: [], env: {} })).toEqual([
        `${path}/test_dependency.py`,
        "tests/test_project.py",
      ]);
    }
  });

  it("notes a refused flag in PYTEST_ADDOPTS for every project", () => {
    const { root, tracked } = worktree(TWO);
    const notes = seedPytest(root, tracked, { PYTEST_ADDOPTS: "--ff -x" }).notes;
    expect(notes.filter((n) => n.includes("--ff (in PYTEST_ADDOPTS)"))).toHaveLength(2);
  });

  it("takes a tests/ directory beside a pyproject.toml, excluding a nested project", () => {
    const { root, tracked } = worktree({
      "pyproject.toml": PYPROJECT,
      "tests/test_a.py": "",
      "poetry.lock": "",
      "libs/core/setup.cfg": "[tool:pytest]\npython_files = t_*.py\n",
      "libs/core/t_x.py": "",
      "libs/core/.venv/pyvenv.cfg": "",
    });
    const seed = seedPytest(root, tracked, {});
    expect(seed.projects.map((p) => [p.name, p.include, p.exclude?.at(-1)])).toEqual([
      ["pytest", ["**/test_*.py", "**/*_test.py"], "libs/core/**"],
      ["libs/core", ["**/t_*.py"], "**/venv/**"],
    ]);
    expect(seed.notes).toContain(
      'seeded pytest project "pytest" from tests/ beside pyproject.toml',
    );
    expect(seed.notes).toContain(
      'pytest project "pytest" has no environment yet; `poetry install` in the root creates one',
    );
  });

  it("seeds nothing from a pyproject.toml without a pytest table or tests/, or under fixtures", () => {
    const { root, tracked } = worktree({
      "pyproject.toml": PYPROJECT,
      "src/app/__init__.py": "",
      "test/fixtures/app/pytest.ini": "[pytest]\n",
      "node_modules/x/pytest.ini": "[pytest]\n",
      "__pypackages__/3.11/lib/pkg/pytest.ini": "[pytest]\n",
      "services/api/__pypackages__/3.11/lib/pkg/pytest.ini": "[pytest]\n",
    });
    expect(seedPytest(root, tracked, {})).toEqual({ projects: [], notes: [] });
  });
});
