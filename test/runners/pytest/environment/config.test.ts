import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findPytestConfig } from "../../../../src/runners/pytest/environment/config.js";
import { tempDir, write } from "./tree.js";

/*
 * Spec 007 D1: "with pytest's own precedence at `cwd`: `pytest.ini` (even
 * empty), `pyproject.toml` with `[tool.pytest.ini_options]`, `tox.ini` with
 * `[pytest]`, `setup.cfg` with `[tool:pytest]`; configs never merge."
 * pytest 9.1.1's `locate_config` puts `pytest.toml`, `.pytest.toml` and
 * `.pytest.ini` in that order too, and falls back to the first
 * `pyproject.toml` seen.
 */

const PYPROJECT = "[project]\nname = 'app'\n\n[tool.pytest.ini_options]\naddopts = '-q'\n";

function found(files: Record<string, string>, cwd = "") {
  const root = tempDir();
  write(root, files);
  const config = findPytestConfig(root, join(root, cwd));
  return config === null ? null : { ...config, path: config.path.slice(root.length + 1) };
}

describe("findPytestConfig (spec 007 D1)", () => {
  it("takes an empty pytest.ini over a pyproject.toml with a pytest table", () => {
    expect(found({ "pytest.ini": "", "pyproject.toml": PYPROJECT })).toMatchObject({
      path: "pytest.ini",
      holds: "pytest",
    });
  });

  it.each([
    [{ "pytest.toml": "", "pytest.ini": "" }, "pytest.toml"],
    [{ ".pytest.toml": "", "pytest.ini": "" }, ".pytest.toml"],
    [{ ".pytest.ini": "", "pyproject.toml": PYPROJECT }, ".pytest.ini"],
    [{ "pyproject.toml": PYPROJECT, "tox.ini": "[pytest]\n" }, "pyproject.toml"],
    [{ "tox.ini": "[tox]\n\n[pytest]\naddopts = -q\n", "setup.cfg": "[tool:pytest]\n" }, "tox.ini"],
    [{ "tox.ini": "[tox]\nenvlist = py3\n", "setup.cfg": "[tool:pytest]  # here\n" }, "setup.cfg"],
  ])("follows the precedence in %j", (files, expected) => {
    expect(found(files)?.path).toBe(expected);
  });

  it.each([
    ["[tool.pytest]\nminversion = '9.0'\n", true],
    ["[ tool . pytest . ini_options ]\n", true],
    ["[tool.pytest]\n# nothing yet\n\n[tool.ruff]\nline-length = 100\n", false],
    ["[tool.pytest.ini_options]\n", true],
    ["[tool.ruff]\nline-length = 100\n", false],
  ])("reads pyproject.toml %j as holding pytest: %s", (text, holds) => {
    expect(found({ "pyproject.toml": text, "setup.cfg": "[tool:pytest]\n" })?.path).toBe(
      holds ? "pyproject.toml" : "setup.cfg",
    );
  });

  it("does not take setup.cfg's [pytest] section or an indented header", () => {
    expect(found({ "setup.cfg": "[pytest]\n", "tox.ini": "  [pytest]\n" })).toBeNull();
  });

  it("walks from cwd up to the worktree root; the nearest directory wins", () => {
    const files = { "pytest.ini": "", "services/app/pyproject.toml": PYPROJECT };
    expect(found(files, "services/app")).toEqual({
      path: "services/app/pyproject.toml",
      rootdir: expect.stringMatching(/\/services\/app$/),
      holds: "pytest",
    });
    expect(found({ "pytest.ini": "", "services/app/x.py": "" }, "services/app")?.path).toBe(
      "pytest.ini",
    );
  });

  it("falls back to the nearest pyproject.toml without a pytest table", () => {
    const files = { "pyproject.toml": "[project]\n", "services/app/pyproject.toml": "[project]\n" };
    expect(found(files, "services/app")).toMatchObject({
      path: "services/app/pyproject.toml",
      holds: "fallback",
    });
  });

  it("never looks above the worktree root", () => {
    const parent = tempDir();
    write(parent, { "pytest.ini": "", "worktree/tests/test_a.py": "" });
    const root = join(parent, "worktree");
    expect(findPytestConfig(root, root)).toBeNull();
  });
});
