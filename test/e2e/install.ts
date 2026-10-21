import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { REPO_ROOT } from "../../src/harness/claude-code/build.js";
import { findPython, PYTHONS, type PythonVersion, pythonEnv } from "../helpers/pytest-env.js";

/*
 * The fixture repository's own `npm install` of Vitest, done once per machine
 * and copied into every fixture. Kept under /tmp between runs on purpose: it
 * is a cache, keyed by Vitest version, Node major and platform. Concurrent
 * test files race to install; the first rename wins and the others discard
 * their copy. The node:test fixture (spec 003) has its own: tsx beside
 * Vitest, installed in a workspace root with the fixture's package
 * manifests, so its lockfiles and links are the ones npm writes. The pytest
 * fixture (spec 007) takes the Vitest install and needs uv with both
 * Pythons; each worktree's environments are its own `uv sync`.
 */

/** The Vitest the fixture installs: the repository's own, so the npm cache has it offline. */
export const VITEST_VERSION = installedVersion("vitest");
/** The tsx the node:test fixture installs, the repository's own for the same reason. */
const TSX_VERSION = installedVersion("tsx");
/**
 * Vitest's peer Vite, named explicitly: npm 10.9.9 (Node 22.23.3) crashes resolving
 * vitest 5's peer set ("reading 'edgesOut'", arborist `#loadPeerSet`), so
 * the install skips peer resolution (`--legacy-peer-deps`) and installs Vite
 * itself, the repository's own version. Drop both once Node 22's npm resolves
 * it (2026-10-13; Node 24's npm 11 does).
 */
export const VITE_VERSION = installedVersion("vite");
/**
 * Vite's bundler, named for the same reason as Vite: a fresh `--prefer-offline`
 * install takes the newest `rolldown` the cache's packument lists, and drops
 * its native binding without a word when the binding's packument is older
 * (spec 014, `research/shipped-plugin-timeout.md`).
 */
export const ROLLDOWN_VERSION = installedVersion("rolldown");

function installedVersion(name: string): string {
  const manifest = join(REPO_ROOT, "node_modules", name, "package.json");
  return (JSON.parse(readFileSync(manifest, "utf8")) as { version: string }).version;
}

const CACHE_ROOT = "/tmp/squeal-e2e-cache";
const PLATFORM = `node${process.versions.node.split(".")[0]}-${process.platform}-${process.arch}`;
const INSTALL_TIMEOUT_MS = 180_000;

/** Which fixture the install is for: Vitest alone, the node:test workspace, or pytest beside Vitest. */
export type InstallKind = "vitest" | "node-test" | "pytest";

/** The workspace packages of `test/fixtures/e2e/node-test`, whose manifests npm links. */
const WORKSPACE = join(REPO_ROOT, "test/fixtures/e2e/node-test/packages");
const MANIFESTS = ["demo", "util"].map((name) => join(name, "package.json"));

interface Recipe {
  readonly key: string;
  readonly packages: readonly string[];
  /** The root manifest beyond its name; the workspace manifests are copied beside it. */
  readonly root: object;
}

function recipe(kind: InstallKind): Recipe {
  const vitest = `vitest@${VITEST_VERSION}`;
  const vite = `vite@${VITE_VERSION}`;
  if (kind === "vitest" || kind === "pytest")
    return {
      key: `vitest-${VITEST_VERSION}-vite-${VITE_VERSION}-${PLATFORM}`,
      packages: [vitest, vite],
      root: {},
    };
  const hash = createHash("sha256");
  for (const file of MANIFESTS) hash.update(readFileSync(join(WORKSPACE, file)));
  return {
    key: `node-test-${hash.digest("hex").slice(0, 12)}-vitest-${VITEST_VERSION}-vite-${VITE_VERSION}-tsx-${TSX_VERSION}-${PLATFORM}`,
    packages: [vitest, vite, `tsx@${TSX_VERSION}`],
    root: { workspaces: ["packages/*"] },
  };
}

export type Install =
  | { readonly ok: true; readonly dir: string }
  | { readonly ok: false; readonly reason: string };

const run = promisify(execFile);

const installed = (dir: string, packages: readonly string[]) =>
  packages.every((spec) =>
    existsSync(join(dir, "node_modules", spec.slice(0, spec.lastIndexOf("@")), "package.json")),
  );

async function npmInstall(
  dir: string,
  mode: "--offline" | "--prefer-offline",
  packages: readonly string[],
): Promise<void> {
  await run(
    "npm",
    [
      "install",
      mode,
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
      "--legacy-peer-deps",
      "--fetch-retries=0",
      "--fetch-timeout=20000",
      ...packages,
    ],
    { cwd: dir, timeout: INSTALL_TIMEOUT_MS },
  );
}

const pending = new Map<InstallKind, Promise<Install>>();

/** The cached install of `kind`, made on first use. Never rejects: a failure is a reason to skip. */
export function fixtureInstall(kind: InstallKind = "vitest"): Promise<Install> {
  let made = pending.get(kind);
  if (made === undefined) {
    made = install(recipe(kind)).then((npm) => (kind === "pytest" && npm.ok ? pythons(npm) : npm));
    pending.set(kind, made);
  }
  return made;
}

async function install({ key, packages, root }: Recipe): Promise<Install> {
  if (!VITEST_VERSION.startsWith("5.")) {
    return { ok: false, reason: `the repository's Vitest is ${VITEST_VERSION}, not 5.x` };
  }
  const what = packages.join(" and ");
  const dir = join(CACHE_ROOT, key);
  if (installed(dir, packages)) return { ok: true, dir };
  mkdirSync(CACHE_ROOT, { recursive: true });
  const tmp = mkdtempSync(`${dir}.tmp-`);
  try {
    writeFileSync(
      join(tmp, "package.json"),
      `${JSON.stringify({ name: "squeal-e2e-fixture", private: true, type: "module", ...root })}\n`,
    );
    if ("workspaces" in root) {
      for (const file of MANIFESTS) cpSync(join(WORKSPACE, file), join(tmp, "packages", file));
    }
    const errors: string[] = [];
    for (const mode of ["--offline", "--prefer-offline"] as const) {
      try {
        await npmInstall(tmp, mode, packages);
        break;
      } catch (error) {
        const stderr = (error as { stderr?: string }).stderr?.trim() || String(error);
        errors.push(`npm install ${mode}: ${stderr.split("\n").slice(-3).join(" ")}`);
      }
    }
    if (!installed(tmp, packages)) {
      return { ok: false, reason: `${what} could not be installed: ${errors.join("; ")}` };
    }
    try {
      renameSync(tmp, dir);
    } catch (error) {
      if (!installed(dir, packages)) throw error;
    }
    return { ok: true, dir };
  } catch (error) {
    return { ok: false, reason: `${what} could not be cached: ${String(error)}` };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The pytest fixture's projects, by repository path: each has its own `uv.lock` and `.venv`. */
export const PYTEST_PROJECTS = ["python/billing", "python/small"] as const;

/** `install` when uv has both Pythons the pytest fixture runs on; else why not. */
function pythons(install: Install): Install {
  for (const version of PYTHONS) {
    const found = findPython(version);
    if (!found.ok) return found;
  }
  return install;
}

/**
 * `uv sync --locked` in each pytest project of the worktree `root` on
 * `version`, as a user syncs a fresh worktree: uv's own cache and managed
 * Pythons, never the caller's Python settings (`test/helpers/pytest-env.ts`).
 */
export function uvSync(root: string, version: PythonVersion): void {
  const found = findPython(version);
  if (!found.ok) throw new Error(found.reason);
  for (const project of PYTEST_PROJECTS) {
    execFileSync("uv", ["sync", "--locked", "--python", found.python], {
      cwd: join(root, project),
      env: pythonEnv(),
      stdio: "pipe",
    });
  }
}
