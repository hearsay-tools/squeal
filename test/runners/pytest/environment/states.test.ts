import { chmodSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PytestProject } from "../../../../src/core/types/policy.js";
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
      "pdm.lock",
      { "services/app/pdm.lock": "" },
      "pdm install",
      `Run \`pdm install\` in services/app to create one`,
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

  it.each(["python.use_venv = false\n", "[python]\nuse_venv = false # PEP 582\n"])(
    "explains unsupported PEP 582 from explicit local PDM metadata: %s",
    (metadata) => {
      const root = tempDir();
      const external = tempDir();
      write(external, { "bin/python": "" });
      write(root, {
        "services/app/pdm.toml": metadata,
        "services/app/pdm.lock": "",
        "services/app/.pdm-python": join(external, "bin/python"),
        "services/app/__pypackages__/3.13/lib/pytest/__init__.py": "",
      });
      const state = environmentState(root, project({ cwd: "services/app" }));
      expect(state).toMatchObject({ state: "none", command: null });
      if (state.state !== "none") throw new Error("Expected no admitted environment");
      expect(state.note).toContain("services/app/pdm.toml");
      expect(state.note).toContain("python.use_venv = false");
      expect(state.note).toContain("Squeal does not support PEP 582 (`__pypackages__`)");
      expect(state.note).toContain("runs none of its tests and inherits none of their results");
      expect(state.note).toContain("project-approved local virtual environment");
      expect(state.note).not.toMatch(
        /pdm install|dependencies.*(?:absent|not installed)|to create one/i,
      );
    },
  );

  it("uses explicit PDM metadata without a lockfile or local packages", () => {
    const root = tempDir();
    write(root, { "pdm.toml": "python.use_venv = false\n" });
    expect(environmentState(root, project())).toMatchObject({
      state: "none",
      command: null,
      note: expect.stringContaining("Squeal does not support PEP 582 (`__pypackages__`)"),
    });
  });

  it.each([
    ["enabled", "python.use_venv = true\n"],
    ["unset", "[python]\n"],
    ["malformed", "python.use_venv = false\n[broken\n"],
    ["string", 'python.use_venv = "false"\n'],
    ["wrong table", "[tool.pdm.python]\nuse_venv = false\n"],
    ["quoted key", '"python.use_venv" = false\n'],
  ])("keeps ordinary guidance for %s PDM metadata", (_, metadata) => {
    const root = tempDir();
    write(root, {
      "pdm.toml": metadata,
      "pdm.lock": "",
      "__pypackages__/3.13/lib/pytest/__init__.py": "",
    });
    expect(environmentState(root, project())).toMatchObject({
      state: "none",
      command: "pdm install",
      note: expect.stringContaining("Run `pdm install` in the worktree root to create one"),
    });
  });

  it("does not infer PEP 582 from packages or another project's PDM metadata", () => {
    const root = tempDir();
    write(root, {
      "pdm.toml": "python.use_venv = false\n",
      "services/app/pdm.lock": "",
      "services/app/__pypackages__/3.13/lib/pytest/__init__.py": "",
    });
    expect(environmentState(root, project({ cwd: "services/app" }))).toMatchObject({
      state: "none",
      command: "pdm install",
      note: expect.stringContaining("Run `pdm install` in services/app to create one"),
    });
  });

  it.each([undefined, "envs/test"])(
    "honors an existing environment despite PDM PEP 582 metadata (python=%s)",
    (python) => {
      const root = tempDir();
      write(root, { "pdm.toml": "python.use_venv = false\n", "pdm.lock": "" });
      const env = venv(root, python ?? ".venv", {
        "pytest/__init__.py": "",
        "pytest-9.1.1.dist-info/METADATA": "Name: pytest\n",
      });
      expect(environmentState(root, project(python === undefined ? {} : { python }))).toMatchObject(
        {
          state: "ready",
          discovery: { env, source: python === undefined ? "venv" : "declared" },
        },
      );
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
    write(main, { ".git/HEAD": "ref: refs/heads/main\n" });
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

/*
 * Spec 027 D3: an outside editable whose directory holds no package code, such
 * as a container build stage's `/pkgs` with only `pyproject.toml`, `uv.lock`
 * and `.venv`, does not block; every outside editable that can import code
 * still does.
 */
describe("environmentState build-stage editables (spec 027 D3)", () => {
  /** A uv build stage: `pkgs` holds metadata and its own `.venv` only. */
  const buildStage = (pkgs: string, extra: Readonly<Record<string, string>> = {}): void =>
    write(pkgs, {
      "pyproject.toml": '[project]\nname = "sb_backend"\n',
      "uv.lock": "version = 1\n",
      ".venv/lib/python3.13/site-packages/django/__init__.py": "",
      ".venv/bin/python": "",
      ...extra,
    });

  /** The worktree's environment, with `sb_backend` editable from `pkgs` through `pth`. */
  const stageEnv = (root: string, pkgs: string, pth: string, files = {}): void => {
    venv(root, ".venv", {
      "sb_backend-0.1.0.dist-info/direct_url.json": editable(pkgs),
      "sb_backend-0.1.0.dist-info/RECORD":
        "_sb_backend.pth,sha256=x,6\nsb_backend-0.1.0.dist-info/RECORD,,\n",
      "_sb_backend.pth": pth,
      ...files,
    });
  };

  it("is ready with a /pkgs-style editable holding no code (done-when a)", () => {
    const pkgs = tempDir();
    const root = tempDir();
    buildStage(pkgs);
    stageEnv(root, pkgs, `${pkgs}\n`);
    expect(environmentState(root, project())).toMatchObject({ state: "ready" });
  });

  it("is ready with an empty setuptools finder installed by the .pth", () => {
    const pkgs = tempDir();
    const root = tempDir();
    buildStage(pkgs);
    const finder = "__editable___sb_backend_0_1_0_finder";
    stageEnv(root, pkgs, `import ${finder}; ${finder}.install()\n`, {
      [`${finder}.py`]: "MAPPING: dict[str, str] = {}\nNAMESPACES: dict[str, list[str]] = {}\n",
    });
    expect(environmentState(root, project())).toMatchObject({ state: "ready" });
  });

  it.each([
    ["a top-level module", { "manage.py": "" }],
    ["a package", { "sb_backend/__init__.py": "" }],
    ["a src-layout package", { "src/sb_backend/__init__.py": "" }],
    ["a compiled extension", { "fast.cpython-313-x86_64-linux-gnu.so": "" }],
  ])("refuses an outside editable holding %s (done-when b)", (_, files) => {
    const pkgs = tempDir();
    const root = tempDir();
    buildStage(pkgs, files);
    stageEnv(root, pkgs, `${pkgs}\n`);
    expect(environmentState(root, project())).toMatchObject({
      state: "editable-outside",
      editables: [{ distribution: "sb_backend", path: pkgs }],
    });
  });

  it.each([
    ["a directory with code", (code: string) => `${code}\n`],
    ["an arbitrary import line", () => "import sys; sys.path.insert(0, '/elsewhere')\n"],
    ["a missing finder", () => "import __editable___x_finder; __editable___x_finder.install()\n"],
  ])("refuses an empty editable whose .pth adds %s", (_, pth) => {
    const pkgs = tempDir();
    const code = tempDir();
    const root = tempDir();
    buildStage(pkgs);
    write(code, { "sb_backend/__init__.py": "" });
    stageEnv(root, pkgs, pth(code));
    expect(environmentState(root, project())).toMatchObject({ state: "editable-outside" });
  });

  it("refuses an empty editable whose finder maps a module", () => {
    const pkgs = tempDir();
    const root = tempDir();
    buildStage(pkgs);
    const finder = "__editable___sb_backend_0_1_0_finder";
    stageEnv(root, pkgs, `import ${finder}; ${finder}.install()\n`, {
      [`${finder}.py`]: `MAPPING = {'sb_backend': '/elsewhere/sb_backend'}\nNAMESPACES = {}\n`,
    });
    expect(environmentState(root, project())).toMatchObject({ state: "editable-outside" });
  });

  it("refuses an empty editable without a RECORD to name its .pth files", () => {
    const pkgs = tempDir();
    const root = tempDir();
    buildStage(pkgs);
    venv(root, ".venv", { "sb_backend-0.1.0.dist-info/direct_url.json": editable(pkgs) });
    expect(environmentState(root, project())).toMatchObject({ state: "editable-outside" });
  });

  it("refuses an empty editable inside a sibling git worktree (done-when c)", () => {
    const parent = tempDir();
    const sibling = join(parent, "w2");
    write(sibling, { ".git": "gitdir: /repo/.git/worktrees/w2\n" });
    const pkgs = join(sibling, "pkgs");
    buildStage(pkgs);
    const root = join(parent, "w1");
    stageEnv(root, pkgs, `${pkgs}\n`);
    expect(environmentState(root, project())).toMatchObject({
      state: "editable-outside",
      editables: [{ distribution: "sb_backend", path: pkgs }],
    });
  });

  it("refuses an in-tree symlink to an outside directory with code (done-when d)", () => {
    const other = tempDir();
    const root = tempDir();
    buildStage(other, { "app/__init__.py": "" });
    link(other, join(root, "pkgs"));
    stageEnv(root, join(root, "pkgs"), `${join(root, "pkgs")}\n`);
    expect(environmentState(root, project())).toMatchObject({
      state: "editable-outside",
      editables: [{ distribution: "sb_backend", path: other }],
    });
  });

  it("refuses a missing outside directory (done-when e)", () => {
    const root = tempDir();
    const pkgs = join(tempDir(), "gone");
    stageEnv(root, pkgs, `${pkgs}\n`);
    expect(environmentState(root, project())).toMatchObject({
      state: "editable-outside",
      editables: [{ distribution: "sb_backend", path: pkgs }],
    });
  });

  it.skipIf(process.getuid?.() === 0)(
    "refuses an unreadable outside directory (done-when e)",
    () => {
      const pkgs = tempDir();
      const root = tempDir();
      buildStage(pkgs);
      stageEnv(root, pkgs, `${pkgs}\n`);
      chmodSync(pkgs, 0o000);
      try {
        expect(environmentState(root, project())).toMatchObject({ state: "editable-outside" });
      } finally {
        chmodSync(pkgs, 0o755);
      }
    },
  );
});

describe("syncNote (spec 007 D2)", () => {
  it("is null for equal fingerprints and a note naming the project otherwise", () => {
    expect(syncNote(project(), "a", "a")).toBeNull();
    expect(syncNote(project(), "a", "b")).toMatch(
      /^pytest project "app": the Python environment changed during the run/,
    );
  });
});
