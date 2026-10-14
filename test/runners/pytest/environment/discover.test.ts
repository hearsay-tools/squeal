import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PytestProject } from "../../../../src/core/types/index.js";
import { discoverEnvironment } from "../../../../src/runners/pytest/environment/discover.js";
import { link, tempDir, venv, write } from "./tree.js";

/*
 * Spec 007 D2: "Discovery, never walking above the worktree root: the
 * project's `python` if set; else `<cwd>/.venv`; else `.pdm-python` when it
 * points inside the worktree; else no environment. `VIRTUAL_ENV`,
 * `CONDA_PREFIX`, `python` on `PATH` and parent directories are never
 * consulted."
 */

const project = (extra: Partial<PytestProject> = {}): PytestProject => ({
  name: "app",
  args: [],
  env: {},
  include: ["tests/test_*.py"],
  ...extra,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("discoverEnvironment (spec 007 D2)", () => {
  it("finds <cwd>/.venv", () => {
    const root = tempDir();
    const env = venv(root, "services/app/.venv");
    expect(discoverEnvironment(root, project({ cwd: "services/app" }))).toEqual({
      kind: "found",
      source: "venv",
      env,
      python: join(env, "bin", "python"),
    });
  });

  it("prefers a declared environment directory over .venv", () => {
    const root = tempDir();
    venv(root, ".venv");
    const env = venv(root, "envs/py313");
    expect(discoverEnvironment(root, project({ python: "envs/py313" }))).toMatchObject({
      kind: "found",
      source: "declared",
      env,
      python: join(env, "bin", "python"),
    });
  });

  it("takes a declared interpreter path, its environment two levels up", () => {
    const root = tempDir();
    const env = venv(root, "envs/a");
    const found = discoverEnvironment(root, project({ python: "envs/a/bin/python" }));
    expect(found).toMatchObject({ source: "declared", env, python: join(env, "bin", "python") });
  });

  it("takes an absolute declared environment outside the worktree", () => {
    const outside = tempDir();
    const env = venv(outside, "poetry-env");
    const root = tempDir();
    expect(discoverEnvironment(root, project({ python: env }))).toMatchObject({
      source: "declared",
      env,
    });
  });

  it("is no environment when the declared path does not exist", () => {
    const root = tempDir();
    write(root, { "poetry.lock": "" });
    expect(discoverEnvironment(root, project({ python: ".venv-missing" }))).toEqual({
      kind: "none",
      looked: [join(root, ".venv-missing")],
      command: "poetry install",
      from: join(root, "poetry.lock"),
    });
  });

  it("takes .pdm-python when it points inside the worktree", () => {
    const root = tempDir();
    const env = venv(root, "pdm-env");
    write(root, { ".pdm-python": `${join(env, "bin", "python")}\n`, "pdm.lock": "" });
    expect(discoverEnvironment(root, project())).toMatchObject({
      kind: "found",
      source: "pdm-python",
      env,
    });
  });

  it("ignores .pdm-python pointing outside the worktree", () => {
    const outside = venv(tempDir(), ".venv");
    const root = tempDir();
    write(root, { ".pdm-python": join(outside, "bin", "python"), "pdm.lock": "" });
    expect(discoverEnvironment(root, project())).toMatchObject({
      kind: "none",
      command: "pdm install",
    });
  });

  it("ignores a .venv without pyvenv.cfg, as one a sync has not written yet", () => {
    const root = tempDir();
    write(root, { ".venv/bin/python": "" });
    expect(discoverEnvironment(root, project())).toMatchObject({ kind: "none" });
  });

  it("never takes the parent checkout's .venv in a nested worktree", () => {
    const main = tempDir();
    venv(main, ".venv");
    write(main, { "uv.lock": "" });
    const worktree = join(main, ".ai/cezar/worktrees/w1");
    write(worktree, { "pyproject.toml": "[project]\nname = 'app'\n" });
    expect(discoverEnvironment(worktree, project())).toEqual({
      kind: "none",
      looked: [join(worktree, ".venv"), join(worktree, ".pdm-python")],
      command: "python -m venv .venv",
      from: null,
    });
  });

  it("finds the lockfile of a workspace member at the worktree root", () => {
    const root = tempDir();
    write(root, { "uv.lock": "", "packages/other/pyproject.toml": "" });
    expect(discoverEnvironment(root, project({ cwd: "packages/other" }))).toMatchObject({
      kind: "none",
      command: "uv sync",
    });
  });

  it("names poetry install from poetry.lock and a new .venv without any lockfile", () => {
    const root = tempDir();
    expect(discoverEnvironment(root, project())).toMatchObject({
      command: "python -m venv .venv",
      from: null,
    });
    write(root, { "poetry.lock": "" });
    expect(discoverEnvironment(root, project())).toMatchObject({ command: "poetry install" });
  });

  it("follows a .venv link out of the worktree; the editable state refuses it", () => {
    const main = tempDir();
    const shared = venv(main, ".venv");
    const root = tempDir();
    link(shared, join(root, ".venv"));
    expect(discoverEnvironment(root, project())).toMatchObject({
      kind: "found",
      source: "venv",
      env: join(root, ".venv"),
    });
  });

  it("changes nothing under a foreign VIRTUAL_ENV, CONDA_PREFIX or PATH", () => {
    const other = venv(tempDir(), ".venv");
    const root = tempDir();
    const withVenv = tempDir();
    venv(withVenv, ".venv");
    const before = [discoverEnvironment(root, project()), discoverEnvironment(withVenv, project())];
    vi.stubEnv("VIRTUAL_ENV", other);
    vi.stubEnv("CONDA_PREFIX", other);
    vi.stubEnv("PATH", `${join(other, "bin")}:${process.env.PATH ?? ""}`);
    const after = [discoverEnvironment(root, project()), discoverEnvironment(withVenv, project())];
    expect(after).toEqual(before);
    expect(after[0]).toMatchObject({ kind: "none" });
  });
});
