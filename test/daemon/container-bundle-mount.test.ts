import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  bundleRootFor,
  type ContainerWiring,
  containerPaths,
} from "../../src/core/runner-host/container/index.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { jestRuntimeDir } from "../../src/runners/jest/run/run.js";
import { observeRecorder } from "../../src/runners/observe/runtime.js";
import { pytestRuntimeDir } from "../../src/runners/pytest/run/run.js";

/*
 * Review 0.1.644 B1 (spec 027 D5.1): the daemon mounts the whole Squeal
 * bundle, not the CLI's directory, so the in-container runner host finds
 * Jest's, pytest's and the recorder's runtime files. The installed layout
 * is a copy of the built plugin bundle outside the worktree; a CLI-only
 * or source layout gets no root and no container route.
 */

const DIST = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "plugins",
  "claude-code",
  "dist",
);
const WORKTREE = join(DIST, "..", "..", "..");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): AbsolutePath {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir as AbsolutePath;
}

/** `root` is `dir` or below it. */
function inside(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/"));
}

/** A wiring as the daemon builds it: its bundle directory from `bundleRootFor(cli)`. */
function wiring(bundleDir: string, cli: string, stateDir: AbsolutePath): ContainerWiring {
  return {
    containers: () => ({}),
    worktreeId: "wt",
    bundleDir,
    squealCliPath: cli,
    stateDir,
    logRoot: join(stateDir, "runs") as AbsolutePath,
    commonDir: stateDir,
    version: "0.0.0",
  };
}

describe("container bundle mount (review 0.1.644 B1)", () => {
  it("mounts an installed bundle's root, which holds every runtime the host reads", () => {
    expect(existsSync(join(DIST, "cli", "squeal.mjs"))).toBe(true);
    const plugin = temp("squeal-bundle-mount-");
    expect(inside(WORKTREE, plugin)).toBe(false);
    const dist = join(plugin, "dist");
    cpSync(DIST, dist, { recursive: true });
    const cli = join(dist, "cli", "squeal.mjs");

    const root = bundleRootFor(cli);
    expect(root).toBe(dist);
    if (root === null) return;
    const state = temp("squeal-bundle-mount-state-");
    const paths = containerPaths(wiring(root, cli, state), temp("squeal-bundle-mount-wt-"));
    const mounted = paths.squealBundleDir;
    expect(mounted).toBe(dist);
    expect(inside(mounted, cli)).toBe(true);

    const url = pathToFileURL(cli);
    const jest = jestRuntimeDir(url);
    const pytest = pytestRuntimeDir(url);
    const recorder = observeRecorder(url);
    expect(recorder).not.toBeNull();
    for (const path of [jest, pytest, recorder ?? ""]) expect(inside(mounted, path)).toBe(true);
    expect(existsSync(join(jest, "squeal-reporter.cjs"))).toBe(true);
    expect(existsSync(join(pytest, "squeal_pytest.py"))).toBe(true);
    for (const sibling of ["node-test", "code"]) {
      expect(existsSync(join(mounted, sibling))).toBe(true);
    }
  });

  it("refuses a dist/cli-only copy, whose runtime siblings are missing", () => {
    const dist = join(temp("squeal-bundle-cli-only-"), "dist");
    mkdirSync(dist);
    cpSync(join(DIST, "cli"), join(dist, "cli"), { recursive: true });
    const cli = join(dist, "cli", "squeal.mjs");
    expect(bundleRootFor(cli)).toBeNull();
    // The review's reproduction: the CLI directory alone lacks them.
    expect(() => jestRuntimeDir(pathToFileURL(cli))).toThrow(/jest runtime files not found/);
    expect(observeRecorder(pathToFileURL(cli))).toBeNull();
  });

  it("refuses a source layout and a missing CLI", () => {
    const source = join(WORKTREE, "src", "cli", "main.ts");
    expect(bundleRootFor(source)).toBeNull();
    expect(bundleRootFor(join(temp("squeal-bundle-none-"), "cli", "squeal.mjs"))).toBeNull();
  });

  it("accepts a flat bundle with its runtime directories beside the CLI", () => {
    const flat = temp("squeal-bundle-flat-");
    for (const sibling of ["observe", "jest", "pytest"]) {
      cpSync(join(DIST, sibling), join(flat, sibling), { recursive: true });
    }
    cpSync(join(DIST, "cli", "squeal.mjs"), join(flat, "squeal.mjs"));
    expect(bundleRootFor(join(flat, "squeal.mjs"))).toBe(flat);
  });
});
