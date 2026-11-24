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
import type { BuiltCli } from "../daemon/helpers.js";
import { testBuildDir } from "../daemon/strays.js";
import { TEST_VERSION } from "../fixed-version.js";

/*
 * Spec 026 row 026-16: the Claude Code plugin's `dist/` as its build makes
 * it (the bundled `cli/squeal.mjs`, the node:test, pytest, observe, CI and
 * coverage runtimes and the code counter's grammar), built from this
 * worktree's `src` into the run's test cache, never into
 * `plugins/claude-code/dist`. Synchronous, so `daemonSuite` takes it as
 * its build; under the test cache, so the global teardown and
 * `runnerHosts` find the processes it starts.
 */
export function buildPluginDist(): BuiltCli {
  const dir = testBuildDir(expect.getState().testPath);
  const outdir = join(dir, "dist");
  buildSync({ ...bundleOptions(CLAUDE_CODE_PLUGIN, outdir, TEST_VERSION), metafile: false });
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
