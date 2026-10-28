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

/** The `use_venv = false` refusal's head for project "app" (task 007-59). */
const pep582Head = (toml: string, missing: string) =>
  `pytest project "app": ${toml} sets \`python.use_venv = false\`. Squeal does not support PEP 582 (\`__pypackages__\`), and ${missing}, so Squeal runs none of its tests and inherits none of their results.`;

/** The stand-in and its effects (review 0.1.376 B1, PDM 2.29.4 probes). */
const pep582Steps = (where: string) =>
  `run \`PDM_VENV_IN_PROJECT=true pdm venv create\`, then \`PDM_USE_VENV=true pdm use --venv in-project\`, then \`PDM_USE_VENV=true pdm install\`, in ${where}. They create \`.venv\` there, whatever PDM's \`venv.in_project\` says, install into it and leave \`pdm.toml\` unchanged. \`pdm use\` rewrites \`.pdm-python\` to name that \`.venv\` and, by default, writes \`.python-version\`. A later plain \`pdm run\` there still imports from \`__pypackages__\`; \`PDM_USE_VENV=true pdm run\` uses the \`.venv\`.`;

/** The refusal when discovery found nothing. */
const pep582Note = (toml: string, where: string) =>
  `${pep582Head(toml, "no supported Python environment was found")} To get one today, ${pep582Steps(where)} Squeal then checks that environment as usual before it runs tests or inherits results.`;

/** The refusal when the declared `python` is missing (review 0.1.376 B2). */
const pep582DeclaredNote = (toml: string, declared: string, where: string) =>
  `${pep582Head(toml, `the project's \`python\` in squeal.config.json, ${declared}, does not exist`)} Create that environment, or set \`python\` to \`.venv/bin/python\` once ${where} has a \`.venv\`: the PDM commands alone are not enough while \`python\` names the missing path. To create the \`.venv\`, ${pep582Steps(where)} Squeal then checks the environment \`python\` names as usual before it runs tests or inherits results.`;

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

  /*
   * Task 007-59 (007-57 Recommendation 1, Q7): the refusal names the stand-in
   * that works today. Review 0.1.376 B1: it must make `<cwd>/.venv` with
   * PDM's `venv.in_project = false` too, and with `__pypackages__` or a
   * `.pdm-python` outside a venv, so `PDM_VENV_IN_PROJECT=true pdm venv
   * create` makes it and `pdm use --venv in-project` selects it.
   */
  it.each([
    ["dotted", "python.use_venv = false\n"],
    ["table", "[python]\nuse_venv = false # PEP 582\n"],
    ["venv.in_project = false", "python.use_venv = false\n[venv]\nin_project = false\n"],
  ])("explains unsupported PEP 582 from explicit local PDM metadata: %s", (_, metadata) => {
    const root = tempDir();
    const external = tempDir();
    write(external, { "bin/python": "" });
    write(root, {
      "services/app/pdm.toml": metadata,
      "services/app/pdm.lock": "",
      "services/app/.pdm-python": join(external, "bin/python"),
      "services/app/__pypackages__/3.13/lib/pytest/__init__.py": "",
    });
    expect(environmentState(root, project({ cwd: "services/app" }))).toEqual({
      state: "none",
      command: null,
      note: pep582Note("services/app/pdm.toml", "services/app"),
    });
  });

  it("names only the overridden PDM commands, `pdm venv create` first", () => {
    const root = tempDir();
    write(root, { "pdm.toml": "python.use_venv = false\n" });
    const state = environmentState(root, project());
    expect(state).toMatchObject({ state: "none", command: null });
    if (state.state !== "none") throw new Error("Expected no admitted environment");
    // `pdm use -f` could select a venv on `PATH`; plain `pdm install` fills `__pypackages__`.
    expect([...state.note.matchAll(/`([^`]*\bpdm [^`]*)`/g)].map((m) => m[1])).toEqual([
      "PDM_VENV_IN_PROJECT=true pdm venv create",
      "PDM_USE_VENV=true pdm use --venv in-project",
      "PDM_USE_VENV=true pdm install",
      "pdm use",
      "pdm run",
      "PDM_USE_VENV=true pdm run",
    ]);
    expect(state.note).toContain(", in the worktree root. They create `.venv` there");
  });

  /*
   * Review 0.1.376 B2: discovery stops at a missing declared `python`, even
   * beside a `.venv`, so the note says that path must change or exist.
   */
  it.each([
    ["without", false],
    ["beside", true],
  ])("names a missing declared python %s a .venv", (_, withVenv) => {
    const root = tempDir();
    write(root, { "services/app/pdm.toml": "python.use_venv = false\n" });
    if (withVenv) venv(root, "services/app/.venv", {});
    const state = environmentState(
      root,
      project({ cwd: "services/app", python: "envs/test/bin/python" }),
    );
    expect(state).toEqual({
      state: "none",
      command: null,
      note: pep582DeclaredNote(
        "services/app/pdm.toml",
        "services/app/envs/test/bin/python",
        "services/app",
      ),
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
