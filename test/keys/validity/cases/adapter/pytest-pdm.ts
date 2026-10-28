import type { Case, PytestInput, PytestPython } from "../../case.js";

const lines = (...text: string[]) => `${text.join("\n")}\n`;
const TEST = lines("def test_pass():", "    assert True");

const pytest = (name: string, why: string, input: Omit<PytestInput, "python">): Case[] =>
  (["3.10", "3.13"] as const satisfies readonly PytestPython[]).map((python) => ({
    kind: "adapter:pytest",
    name: `${name}, Python ${python}`,
    why,
    input: { ...input, python },
  }));

/** Dependency directories at several depths, beside ordinary project paths. */
const FILES: Readonly<Record<string, string>> = {
  "pyproject.toml": lines("[tool.pytest.ini_options]", 'norecursedirs = ["build", "deps-only"]'),
  "tests/test_project.py": TEST,
  "__pypackages__extra/test_project.py": TEST,
  "vendor/tests/test_project.py": TEST,
  "__pypackages__/3.13/lib/selected/tests/test_dependency.py": TEST,
  "__pypackages__/3.13/lib/other/tests/test_dependency.py": TEST,
  "vendor/__pypackages__/3.10/lib/selected/tests/test_dependency.py": TEST,
  "vendor/__pypackages__/3.10/lib/other/tests/test_dependency.py": TEST,
  "vendor/deep/__pypackages__/other/tests/test_dependency.py": TEST,
  "build/deep/test_hidden.py": TEST,
  "build/__pypackages__/3.13/lib/selected/tests/test_hidden.py": TEST,
  "deps-only/__pypackages__/3.13/lib/tests/test_hidden.py": TEST,
};

const PDM_SETTINGS: readonly { readonly name: string; readonly text?: string }[] = [
  { name: "explicit dotted false", text: lines("python.use_venv = false") },
  { name: "explicit table false", text: lines("[python]", "use_venv = false") },
  { name: "malformed metadata", text: lines("[python", "use_venv = false") },
  { name: "ordinary metadata", text: lines("[project]", 'name = "app"') },
  { name: "enabled virtual environments", text: lines("[python]", "use_venv = true") },
  { name: "a string false", text: lines("[python]", 'use_venv = "false"') },
  { name: "a non-table python value", text: lines("python = false") },
  { name: "no local PDM setting" },
];

export const PYTEST_PDM: readonly Case[] = [
  ...pytest(
    "broad discovery prunes root and nested PDM dependencies beside ordinary paths",
    "007 D3 and 011 C3/C14: dependency tests leave the listing and affected sets, while a similarly named ordinary directory stays discoverable; norecursedirs notes traverse project subdirectories without searching dependency trees",
    {
      files: FILES,
      project: { include: ["**/test_*.py"] },
      affected: [
        "tests/test_project.py",
        "__pypackages__extra/test_project.py",
        "__pypackages__/3.13/lib/selected/tests/test_dependency.py",
        "vendor/deep/__pypackages__/other/tests/test_dependency.py",
      ],
      runs: [{ files: ["tests/test_project.py"] }],
    },
  ),
  ...pytest(
    "literal PDM roots opt in only their matching files and explicit excludes win",
    "007 D3 and 011 C3/C14: literal include ancestors and descendants admit the selected dependency tests, a wildcard before __pypackages__ grants no opt-in, and a broad include cannot leak adjacent dependency tests into the listing",
    {
      files: FILES,
      project: {
        include: [
          "**/test_*.py",
          "./__pypackages__/3.13/lib/selected/**/test_*.py",
          "vendor/__pypackages__/3.10/lib/selected/**/test_*.py",
          "vendor/*/__pypackages__/**/test_*.py",
        ],
        exclude: ["vendor/__pypackages__/3.10/lib/selected/**"],
      },
      affected: [
        "__pypackages__/3.13/lib/selected/tests/test_dependency.py",
        "__pypackages__/3.13/lib/other/tests/test_dependency.py",
        "vendor/__pypackages__/3.10/lib/selected/tests/test_dependency.py",
        "vendor/deep/__pypackages__/other/tests/test_dependency.py",
      ],
      runs: [
        {
          files: [
            "tests/test_project.py",
            "__pypackages__/3.13/lib/selected/tests/test_dependency.py",
          ],
        },
      ],
    },
  ),
  ...pytest(
    "a rooted PDM include remains subject to norecursedirs traversal",
    "007 D3 and 011 C3/C14: a skipped directory's note searches only walkable dependency subtrees, even when a literal include opts in below that skipped directory; no skipped file runs",
    {
      files: FILES,
      project: {
        include: ["**/test_*.py", "build/__pypackages__/3.13/lib/selected/**/test_*.py"],
      },
      runs: [{ files: ["tests/test_project.py"] }],
    },
  ),
  ...PDM_SETTINGS.flatMap(({ name, text }) =>
    pytest(
      `no Python environment with ${name}`,
      "007 D2 and 011 C3/C14: only a parsed local boolean python.use_venv = false proves unsupported PEP 582 use; every no-environment state runs and stores nothing, and its guidance is wording",
      {
        files: {
          "pyproject.toml": lines("[tool.pytest.ini_options]", 'testpaths = ["tests"]'),
          "pdm.lock": "",
          ...(text === undefined ? {} : { "pdm.toml": text }),
          "tests/test_project.py": TEST,
        },
        project: { python: "missing/.venv", include: ["tests/test_project.py"] },
        runs: [{ files: ["tests/test_project.py"] }],
      },
    ),
  ),
];
