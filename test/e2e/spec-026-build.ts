import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSync } from "esbuild";
import { expect } from "vitest";
import {
  bundleOptions,
  copyCiRuntime,
  copyCodeGrammar,
  copyCoverageRuntime,
  copyNodeTestRuntime,
  copyObserveRuntime,
  copyPytestRuntime,
} from "../../src/harness/build.js";
import { CLAUDE_CODE_PLUGIN } from "../../src/harness/claude-code/build.js";
import type { BuildOptions, BuiltCli } from "../daemon/helpers.js";
import { liveRunDirectory, testBuildDir } from "../daemon/strays.js";
import { TEST_VERSION } from "../fixed-version.js";
import { observeMetafile, sharedBuild } from "../helpers/build-inputs.js";

/*
 * Spec 026 row 026-16: the Claude Code plugin's `dist/` as its build makes
 * it (the bundled `cli/squeal.mjs`, the node:test, pytest, observe, CI and
 * coverage runtimes and the code counter's grammar), built from this
 * worktree's `src` into the run's test cache, never into
 * `plugins/claude-code/dist`. Synchronous, so `daemonSuite` takes it as
 * its build; under the test cache, so the global teardown and
 * `runnerHosts` find the processes it starts.
 *
 * Row 010-36: the bundles are built once per run and linked into each test
 * file's own directory (`sharedBuild`), every call stat'ing what esbuild
 * bundled; the runtimes and the grammar are copied per call, so the test's
 * own reads still key it by them. `_options` is `buildCli`'s, which
 * `daemonSuite` passes; the plugin's `dist/` ships the recorder anyway.
 */
export function buildPluginDist(
  _options: BuildOptions = {},
  runDir = liveRunDirectory(),
): BuiltCli {
  const dir = testBuildDir(expect.getState().testPath, runDir ?? undefined);
  const outdir = join(dir, "dist");
  const options = (out: string) => bundleOptions(CLAUDE_CODE_PLUGIN, out, TEST_VERSION);
  sharedBuild(
    {
      runDir,
      name: "plugin-dist",
      recipe: JSON.stringify(options("<outdir>")),
      build: (out) => observeMetafile(buildSync({ ...options(out), metafile: true }).metafile),
    },
    outdir,
  );
  copyNodeTestRuntime(outdir);
  copyObserveRuntime(outdir);
  copyCiRuntime(outdir);
  copyCoverageRuntime(outdir);
  copyPytestRuntime(outdir);
  copyCodeGrammar(outdir);
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
  return {
    cli: join(outdir, "cli/squeal.mjs"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
