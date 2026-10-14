import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { TestContext } from "vitest";

/**
 * uv environments for the pytest fixtures (spec 007 Testing). A fixture is copied to a
 * temp directory and synced there, so no `.venv`, `__pycache__` or `.pytest_cache`
 * reaches the repository tree. uv keeps its own cache and managed Pythons; it never
 * reads the user's uv config, never uses a system Python and never downloads one. It
 * hardlinks packages from its cache, as on CI's ext4 runners (task 007-28): every
 * environment then shares those inodes, and a sync elsewhere moves their ctime.
 * A copy-on-write filesystem would otherwise clone them, and hide that.
 */

export type PythonVersion = "3.10" | "3.13";

/** The Pythons CI installs; every fixture test runs on each. */
export const PYTHONS: readonly PythonVersion[] = ["3.10", "3.13"];

export interface PytestEnv {
  /** The temp copy of the fixture, with its `.venv`. */
  readonly root: string;
  /** `<root>/.venv/bin/python`. */
  readonly python: string;
  /** The environment for the fixture's children: `pythonEnv()`. */
  readonly env: NodeJS.ProcessEnv;
  cleanup(): void;
}

export type Synced = { ok: true; env: PytestEnv } | { ok: false; reason: string };
export type Found = { ok: true; python: string } | { ok: false; reason: string };

// uv's own cache and Python install directory stay; every other uv or Python setting
// of the caller (a foreign VIRTUAL_ENV, PYTHONPATH, PYTEST_ADDOPTS) is dropped.
const KEPT = new Set(["UV_CACHE_DIR", "UV_PYTHON_INSTALL_DIR"]);
const DROPPED = /^(UV_|PYTHON|PYTEST_|VIRTUAL_ENV|CONDA_)/;

/** The caller's environment without its Python settings, plus uv's isolation. */
export function pythonEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (KEPT.has(key) || !DROPPED.test(key)) env[key] = value;
  }
  return {
    ...env,
    UV_NO_CONFIG: "1",
    UV_PYTHON_PREFERENCE: "only-managed",
    UV_PYTHON_DOWNLOADS: "never",
    UV_LINK_MODE: "hardlink",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
  };
}

function uv(args: readonly string[], cwd?: string): string {
  return execFileSync("uv", args, {
    cwd,
    env: pythonEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function stderrOf(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  return typeof stderr === "string" && stderr.trim() !== "" ? stderr.trim() : String(error);
}

/** uv's managed interpreter for `version`, or why there is none. */
export function findPython(version: PythonVersion): Found {
  try {
    uv(["--version"]);
  } catch (error) {
    return { ok: false, reason: `uv is absent: ${stderrOf(error)}` };
  }
  try {
    return { ok: true, python: uv(["python", "find", version]).trim() };
  } catch (error) {
    return {
      ok: false,
      reason: `Python ${version} is absent from uv's managed Pythons: ${stderrOf(error)}`,
    };
  }
}

/**
 * Copies `fixture` to a temp directory and runs `uv sync --locked --python <version>`
 * there. An absent uv or Python is a result to skip on; a failing sync throws.
 */
export function syncFixture(fixture: string, version: PythonVersion): Synced {
  const found = findPython(version);
  if (!found.ok) return found;
  const root = join(mkdtempSync(join(tmpdir(), `squeal-pytest-${version}-`)), basename(fixture));
  const cleanup = () => rmSync(join(root, ".."), { recursive: true, force: true });
  cpSync(fixture, root, {
    recursive: true,
    filter: (src) => !/(^|\/)(\.venv[^/]*|__pycache__|\.pytest_cache)$/.test(src),
  });
  try {
    uv(["sync", "--locked", "--python", found.python], root);
  } catch (error) {
    cleanup();
    throw new Error(
      `uv sync of ${basename(fixture)} on Python ${version} failed: ${stderrOf(error)}`,
    );
  }
  const python = join(root, ".venv", "bin", "python");
  return { ok: true, env: { root, python, env: pythonEnv(), cleanup } };
}

/**
 * The synced environment, or the test skipped with the reason. On CI an absent uv or
 * Python fails the test instead, so a broken setup cannot hide the suite.
 */
export function requireSynced(ctx: TestContext, synced: Synced): PytestEnv {
  if (synced.ok) return synced.env;
  if (process.env.CI) throw new Error(`pytest fixture unavailable on CI: ${synced.reason}`);
  return ctx.skip(`uv or the Python version is absent: ${synced.reason}`);
}
