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

  it("is none with the command and where Squeal looked", () => {
    const root = tempDir();
    write(root, { "services/app/uv.lock": "" });
    expect(environmentState(root, project({ cwd: "services/app" }))).toEqual({
      state: "none",
      command: "uv sync",
      note: 'pytest project "app": no Python environment (looked at services/app/.venv, services/app/.pdm-python); run `uv sync` in services/app to create one. Its checks stay unknown until then.',
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
