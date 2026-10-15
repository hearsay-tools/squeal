import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PytestProject } from "../../../../src/core/types/index.js";
import { environmentState, syncNote } from "../../../../src/runners/pytest/environment/states.js";
import { editable, link, tempDir, venv, write } from "./tree.js";

/*
 * Spec 007 D2: "States, each with every check of the project `unknown`,
 * nothing stored, and one note": no environment, editable outside the
 * worktree, sync in progress.
 */

const project = (extra: Partial<PytestProject> = {}): PytestProject => ({
  name: "app",
  args: [],
  env: {},
  include: ["tests/test_*.py"],
  ...extra,
});

describe("environmentState (spec 007 D2)", () => {
  it("is ready with editables inside the worktree, the root's own included", () => {
    const root = tempDir();
    venv(root, ".venv", {
      "app-0.1.0.dist-info/direct_url.json": editable(root),
      "other-0.1.0.dist-info/direct_url.json": editable(join(root, "packages/other")),
      "pytest-9.1.1.dist-info/METADATA": "Name: pytest\n",
      "wheel-0.1.dist-info/direct_url.json": JSON.stringify({
        url: "https://example.test/wheel-0.1.whl",
        archive_info: {},
      }),
    });
    expect(environmentState(root, project())).toMatchObject({
      state: "ready",
      discovery: { source: "venv", env: join(root, ".venv") },
    });
  });

  /*
   * Task 007-39, lessons.md defect 9: "chosen from the lockfile present", and
   * "create `.venv`" without one. Task 007-44 (open question 1): every case
   * says what is lost now and what installing buys.
   */
  const lost =
    'pytest project "app": no Python environment (looked at services/app/.venv, services/app/.pdm-python), so Squeal runs none of its tests and inherits none of their results.';
  const buys =
    "Squeal then inherits the results other worktrees recorded for the same code and environment, and runs the rest.";
  it.each([
    [
      "uv.lock",
      { "services/app/uv.lock": "" },
      "uv sync",
      `Run \`uv sync\` in services/app to create one`,
    ],
    [
      "poetry.lock",
      { "services/app/poetry.lock": "", "services/app/requirements.txt": "" },
      "poetry install",
      `Run \`poetry install\` in services/app to create one`,
    ],
    [
      "requirements files",
      {
        "services/app/requirements.txt": "",
        "services/app/requirements-dev.txt": "",
        "services/app/notes.txt": "",
      },
      "python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt -r requirements.txt",
      `Run \`python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt -r requirements.txt\` in services/app to create one`,
    ],
    [
      "no lockfile",
      { "services/app/pyproject.toml": "" },
      "python -m venv .venv",
      `No lockfile or requirements file names an install, so create \`.venv\` in services/app with the project's own install (\`python -m venv .venv\`, then its documented \`pip install\` into \`.venv/bin/pip\`)`,
    ],
  ])(
    "is none with the command from %s, what is lost and what installing buys",
    (_, files, command, text) => {
      const root = tempDir();
      write(root, files);
      expect(environmentState(root, project({ cwd: "services/app" }))).toEqual({
        state: "none",
        command,
        note: `${lost} ${text}: ${buys}`,
      });
    },
  );

  it("names the declared environment, not .venv, without a lockfile", () => {
    const root = tempDir();
    expect(environmentState(root, project({ python: "envs/test/bin/python" }))).toMatchObject({
      command: "python -m venv envs/test",
      note: expect.stringContaining("create `envs/test` in the worktree root"),
    });
  });

  it("refuses .venv -> ../main/.venv whose editable points at main", () => {
    const parent = tempDir();
    const main = join(parent, "main");
    venv(main, ".venv", { "app-0.1.0.dist-info/direct_url.json": editable(main) });
    const root = join(parent, "w1");
    link(join(main, ".venv"), join(root, ".venv"));
    expect(environmentState(root, project())).toEqual({
      state: "editable-outside",
      editables: [{ distribution: "app", path: main }],
      note: `pytest project "app": the environment .venv installs "app" from ${main} editable, outside this worktree, so tests would import another worktree's code. Nothing runs until this worktree has its own environment (run \`uv sync\` or your project's install in the worktree root).`,
    });
  });

  it("refuses an editable outside even in the worktree's own environment", () => {
    const other = tempDir();
    const root = tempDir();
    venv(root, ".venv", {
      "app-0.1.0.dist-info/direct_url.json": editable(root),
      "lib_b-2.0.dist-info/direct_url.json": editable(join(other, "lib-b")),
    });
    expect(environmentState(root, project())).toMatchObject({
      state: "editable-outside",
      editables: [{ distribution: "lib_b", path: join(other, "lib-b") }],
    });
  });

  it("refuses an in-tree editable path that is a symlink to another tree (review 007-16 B3)", () => {
    const other = tempDir();
    const root = tempDir();
    write(other, { "src/app/__init__.py": "" });
    link(join(other, "src"), join(root, "src"));
    venv(root, ".venv", { "app-0.1.0.dist-info/direct_url.json": editable(join(root, "src")) });
    expect(environmentState(root, project())).toMatchObject({
      state: "editable-outside",
      editables: [{ distribution: "app", path: join(other, "src") }],
    });
  });

  it("is ready when the worktree root itself is reached through a symlink", () => {
    const parent = tempDir();
    const real = join(parent, "real");
    write(real, { "src/app/__init__.py": "", "packages/b/x.py": "" });
    const root = join(parent, "via");
    link(real, root);
    venv(real, ".venv", {
      "app-0.1.0.dist-info/direct_url.json": editable(join(root, "src")),
      "b-0.1.0.dist-info/direct_url.json": editable(join(real, "packages/b")),
    });
    expect(environmentState(root, project())).toMatchObject({ state: "ready" });
  });

  it("reads a non-editable or torn direct_url.json as nothing", () => {
    const root = tempDir();
    venv(root, ".venv", {
      "a-1.dist-info/direct_url.json": JSON.stringify({
        url: "file:///elsewhere/a",
        dir_info: {},
      }),
      "b-1.dist-info/direct_url.json": '{"url": "file:///elsewhere/b", "dir_',
    });
    expect(environmentState(root, project())).toMatchObject({ state: "ready" });
  });
});

describe("syncNote (spec 007 D2)", () => {
  it("is null for equal fingerprints and a note naming the project otherwise", () => {
    expect(syncNote(project(), "a", "a")).toBeNull();
    expect(syncNote(project(), "a", "b")).toMatch(
      /^pytest project "app": the Python environment changed during the run/,
    );
  });
});
