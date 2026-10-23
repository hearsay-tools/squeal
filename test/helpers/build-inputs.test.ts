import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bundleOptions } from "../../src/harness/build.js";
import { PI_PLUGIN } from "../../src/harness/pi/build.js";
import {
  observeEnv,
  observeRecorder,
  type RecordedFile,
  takeRecorded,
} from "../../src/runners/observe/index.js";
import { observeBuildInputs, observeMetafile } from "./build-inputs.js";

/*
 * Row 011-141 (011 C12, "Not seen"): `tsc` and esbuild are native binaries, so
 * the recorder sees nothing they read. A nested Vitest runs three fixtures under
 * the real recorder, as Squeal runs a test file: one builds the CLI through
 * `suiteCli`, as the daemon tests do, one the Pi bundles through
 * `buildPiBundles`, and one a project whose compile fails with a diagnostic
 * longer than a file name can be (review 0.1.277 B2). Each fixture's observed
 * paths must hold every worktree file its build compiled, by a list made here:
 * `tsc --listFilesOnly`, and the metafile of the same bundles built in memory.
 */

const ROOT = resolve(import.meta.dirname, "../..");
const TSC = join(ROOT, "node_modules/typescript/bin/tsc");
const VITEST = join(ROOT, "node_modules/vitest/vitest.mjs");
const FIXTURES = "test/fixtures/build-inputs";
const CLI_FIXTURE = join(ROOT, FIXTURES, "cli.fixture.ts");
const BUNDLE_FIXTURE = join(ROOT, FIXTURES, "bundle.fixture.ts");
const FAILED_FIXTURE = join(ROOT, FIXTURES, "failed.fixture.ts");

let scratch: string;
let recorded: Map<string, RecordedFile>;

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-build-inputs-")));
  const out = join(scratch, "observe");
  mkdirSync(out);
  const recorder = observeRecorder(
    new URL("../../src/runners/observe/runtime.ts", import.meta.url),
  );
  if (recorder === null) throw new Error("recorder.cjs not found");
  const config = join(scratch, "vitest.config.mjs");
  writeFileSync(
    config,
    `export default { test: { include: [${JSON.stringify(`${FIXTURES}/*.fixture.ts`)}] } };\n`,
  );
  // Its own settings, so a Squeal observing this file leaves the nested run to them.
  const env = { ...process.env, ...observeEnv(recorder, { out, root: ROOT, skip: [] }, undefined) };
  const run = spawnSync(process.execPath, [VITEST, "run", "--root", ROOT, "--config", config], {
    cwd: ROOT,
    env,
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(`the nested run failed:\n${run.stdout}\n${run.stderr}`);
  recorded = takeRecorded(out);
  // What the nested run read keys this file too.
  for (const file of recorded.values()) observeBuildInputs(file.paths);
}, 300_000);

afterAll(() => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
});

/** What `tsc` compiles for the project `tsconfig`, listed without a check, stat'ed. */
function listedBy(tsconfig: string): string[] {
  const listed = execFileSync(process.execPath, [TSC, "-p", tsconfig, "--listFilesOnly"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return observeBuildInputs(listed.split("\n"));
}

/** The worktree files of `compiled` the recorder did not attribute to `fixture`. */
function unobserved(fixture: string, compiled: readonly string[]): string[] {
  const paths = recorded.get(fixture)?.paths ?? new Set<string>();
  return compiled.filter((path) => !paths.has(join(ROOT, path)));
}

describe("a test that builds keys what its build compiled (011-141)", () => {
  it("records every file tsc compiles for buildCli, by test", () => {
    const compiled = listedBy(join(ROOT, "tsconfig.build.json"));
    expect(compiled).toContain("src/core/scheduler/scheduler.ts");
    expect(compiled.length).toBeGreaterThan(500);
    expect(unobserved(CLI_FIXTURE, compiled)).toEqual([]);
  });

  it("records every file esbuild bundles for a bundle helper, by test", async () => {
    const result = await build({ ...bundleOptions(PI_PLUGIN, join(scratch, "pi")), write: false });
    const bundled = observeMetafile(result.metafile);
    expect(bundled).toContain("src/core/scheduler/scheduler.ts");
    expect(bundled.length).toBeGreaterThan(400);
    expect(unobserved(BUNDLE_FIXTURE, bundled)).toEqual([]);
  });

  it("records what a failed tsc listed, its diagnostic too long for a file name (0.1.277 B2)", () => {
    const compiled = listedBy(join(ROOT, FIXTURES, "broken/tsconfig.json"));
    expect(compiled).toContain("src/core/text.ts");
    expect(unobserved(FAILED_FIXTURE, compiled)).toEqual([]);
  });
});
