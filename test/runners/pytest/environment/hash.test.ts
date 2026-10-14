import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PytestProject } from "../../../../src/core/types/index.js";
import {
  type PytestEnvironment,
  readEnvironment,
} from "../../../../src/runners/pytest/environment/index.js";
import { editable, fakePython, SITE, tempDir, venv, write } from "./tree.js";

/*
 * Spec 007 D2: the environment hash of a pytest project: the interpreter,
 * `pyvenv.cfg`, the site-packages entry names, every `.pth` and
 * `direct_url.json`, the pytest config file, `args` and `env`, the
 * allow-listed variables. "The lockfile is not in it: a lock edit changes
 * nothing until a sync."
 */

const PROJECT: PytestProject = { name: "app", args: [], env: {}, include: ["tests/test_*.py"] };
const BASE = { PATH: "/usr/bin" };

/** A worktree with a uv-synced-looking `.venv`: the app editable from its own `src`. */
function worktree(python: string, dir = tempDir()): string {
  mkdirSync(join(dir, "src"), { recursive: true });
  write(dir, {
    "uv.lock": "version = 1\n",
    "pyproject.toml": "[project]\nname = 'app'\n\n[tool.pytest.ini_options]\naddopts = '-q'\n",
  });
  venv(
    dir,
    ".venv",
    {
      "_editable_impl_app.pth": `${join(dir, "src")}\n`,
      "app-0.1.0.dist-info/direct_url.json": editable(dir),
      "pytest-9.1.1.dist-info/entry_points.txt":
        "[console_scripts]\npytest = pytest:console_main\n",
      "pytest_mock-3.16.0.dist-info/entry_points.txt": "[pytest11]\npytest_mock = pytest_mock\n",
    },
    python,
  );
  return dir;
}

async function ready(
  root: string,
  project = PROJECT,
  source: NodeJS.ProcessEnv = BASE,
): Promise<Extract<PytestEnvironment, { state: "ready" }>> {
  const env = await readEnvironment(root, project, source);
  if (env.state !== "ready") throw new Error(`not ready: ${JSON.stringify(env)}`);
  return env;
}

describe("the pytest environment hash (spec 007 D2)", () => {
  it("is the same for two worktrees with their own synced environments", async () => {
    const python = fakePython(tempDir(), "3.13.14");
    const a = await ready(worktree(python));
    const b = await ready(worktree(python));
    expect(b.hash).toBe(a.hash);
    expect(b.fingerprint).not.toBe(a.fingerprint);
  });

  it("stays when only the lockfile changes, moves when a .dist-info appears", async () => {
    const root = worktree(fakePython(tempDir(), "3.13.14"));
    const before = await ready(root);
    write(root, { "uv.lock": "version = 1\nrevision = 3\n" });
    expect((await ready(root)).hash).toBe(before.hash);
    write(root, { [`.venv/${SITE}/exceptiongroup-1.3.0.dist-info/METADATA`]: "" });
    const after = await ready(root);
    expect(after.hash).not.toBe(before.hash);
    expect(after.fingerprint).not.toBe(before.fingerprint);
  });

  it("stays and keeps the fingerprint when a first import writes site-packages' __pycache__", async () => {
    const root = worktree(fakePython(tempDir(), "3.13.14"));
    const before = await ready(root);
    write(root, { [`.venv/${SITE}/__pycache__/_virtualenv.cpython-313.pyc`]: "" });
    const after = await ready(root);
    expect([after.hash, after.fingerprint]).toEqual([before.hash, before.fingerprint]);
  });

  it.each([
    ["a .pth line", (root: string) => write(root, { [`.venv/${SITE}/extra.pth`]: "/opt\n" })],
    [
      "a direct_url.json",
      (root: string) =>
        write(root, {
          [`.venv/${SITE}/app-0.1.0.dist-info/direct_url.json`]: editable(join(root, "src")),
        }),
    ],
    ["pyvenv.cfg", (root: string) => write(root, { ".venv/pyvenv.cfg": "home = /usr/bin\n" })],
    ["the pytest config", (root: string) => write(root, { "pytest.ini": "[pytest]\n" })],
    [
      "a removed .dist-info",
      (root: string) =>
        rmSync(join(root, `.venv/${SITE}/pytest_mock-3.16.0.dist-info`), { recursive: true }),
    ],
  ])("moves with %s", async (_, change) => {
    const root = worktree(fakePython(tempDir(), "3.13.14"));
    const before = await ready(root);
    change(root);
    expect((await ready(root)).hash).not.toBe(before.hash);
  });

  it("differs between 3.10 and 3.13 interpreters", async () => {
    const dir = tempDir();
    const py310 = await ready(worktree(fakePython(dir, "3.10.20")));
    const py313 = await ready(worktree(fakePython(dir, "3.13.14")));
    expect(py310.hash).not.toBe(py313.hash);
  });

  it("moves with args, env and PYTEST_ADDOPTS; not with a foreign VIRTUAL_ENV", async () => {
    const root = worktree(fakePython(tempDir(), "3.13.14"));
    const base = (await ready(root)).hash;
    expect((await ready(root, { ...PROJECT, args: ["--ds=settings"] })).hash).not.toBe(base);
    expect((await ready(root, { ...PROJECT, env: { TZ: "UTC" } })).hash).not.toBe(base);
    expect(
      (await ready(root, PROJECT, { ...BASE, PYTEST_ADDOPTS: "-p no:pytest_mock" })).hash,
    ).not.toBe(base);
    expect((await ready(root, PROJECT, { ...BASE, PYTEST_ADDOPTS: "" })).hash).not.toBe(base);
    const other = venv(tempDir(), ".venv");
    const foreign = { ...BASE, VIRTUAL_ENV: other, CONDA_PREFIX: other, PYTHONHOME: "/opt/py" };
    expect((await ready(root, PROJECT, foreign)).hash).toBe(base);
  });

  it("gives the run an environment of the worktree's own .venv", async () => {
    const root = worktree(fakePython(tempDir(), "3.13.14"));
    const other = venv(tempDir(), ".venv");
    const source = {
      PATH: `${join(other, "bin")}:/usr/bin`,
      VIRTUAL_ENV: other,
      CONDA_PREFIX: "/opt/conda",
      PYTHONHOME: "/opt/py",
      HOME: "/home/someone",
    };
    const env = await ready(root, { ...PROJECT, env: { TZ: "UTC" } }, source);
    expect(env.runEnv).toEqual({
      PATH: `${join(root, ".venv", "bin")}:/usr/bin`,
      VIRTUAL_ENV: join(root, ".venv"),
      HOME: "/home/someone",
      TZ: "UTC",
    });
  });

  it("carries D4's inputs: import roots, the config file and the pytest11 plugins", async () => {
    const root = worktree(fakePython(tempDir(), "3.13.14"));
    const env = await ready(root);
    expect(env.roots.pthPaths).toEqual([join(root, "src")]);
    expect(env.config).toMatchObject({ path: join(root, "pyproject.toml"), holds: "pytest" });
    expect(env.plugins).toEqual([
      { distribution: "pytest_mock", name: "pytest_mock", module: "pytest_mock" },
    ]);
  });

  it("is broken with a note when the interpreter does not answer", async () => {
    const root = tempDir();
    venv(root, ".venv");
    expect(await readEnvironment(root, PROJECT, BASE)).toEqual({
      state: "broken",
      note: expect.stringMatching(
        /^pytest project "app": cannot run .+\/\.venv\/bin\/python: .+ Its checks stay unknown until the environment's interpreter runs\.$/,
      ),
    });
  });
});
