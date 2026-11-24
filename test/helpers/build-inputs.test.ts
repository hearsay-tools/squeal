import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bundleOptions } from "../../src/harness/build.js";
import { PI_PLUGIN } from "../../src/harness/pi/build.js";
import { type RecordedFile, takeRecorded } from "../../src/runners/observe/read.js";
import { observeEnv, observeRecorder } from "../../src/runners/observe/runtime.js";
import {
  observeBuildInputs,
  observeMetafile,
  type SharedBuild,
  sharedBuild,
  TSRS,
  TSRS_ARGS,
} from "./build-inputs.js";

/*
 * Row 011-141 (011 C12, "Not seen"): the compiler and esbuild are native
 * binaries, so the recorder sees nothing they read. A nested Vitest runs three fixtures under
 * the real recorder, as Squeal runs a test file: one builds the CLI through
 * `suiteCli`, as the daemon tests do, one the Pi bundles through
 * `buildPiBundles`, and one a project whose compile fails with a diagnostic
 * longer than a file name can be (review 0.1.277 B2). Each fixture's observed
 * paths must hold every worktree file its build compiled, by a list made here:
 * tsrs `--listFilesOnly` in fast mode (spec 010 D13), and the metafile of the
 * same bundles built in memory. Row 010-36: a second nested run builds the
 * CLI fixture again under the same run directory, so its build is linked
 * from the first's, and must observe the same files.
 */

const ROOT = resolve(import.meta.dirname, "../..");
const VITEST = join(ROOT, "node_modules/vitest/vitest.mjs");
const FIXTURES = "test/fixtures/build-inputs";
const CLI_FIXTURE = join(ROOT, FIXTURES, "cli.fixture.ts");
const BUNDLE_FIXTURE = join(ROOT, FIXTURES, "bundle.fixture.ts");
const FAILED_FIXTURE = join(ROOT, FIXTURES, "failed.fixture.ts");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let scratch: string;
let recorded: Map<string, RecordedFile>;
/** What the second run's CLI fixture read, its build linked from the first's (row 010-36). */
let recordedHit: Map<string, RecordedFile>;
/** The run directory both nested runs build under, as the global setup provides one. */
let runDir: string;

/** Runs the nested Vitest on `include` under the recorder; returns what each file read. */
function nestedRun(name: string, include: string): Map<string, RecordedFile> {
  const out = join(scratch, `observe-${name}`);
  mkdirSync(out);
  const recorder = observeRecorder(
    new URL("../../src/runners/observe/runtime.ts", import.meta.url),
  );
  if (recorder === null) throw new Error("recorder.cjs not found");
  const config = join(scratch, `vitest-${name}.config.mjs`);
  const test = { include: [include], provide: { squealTestRun: runDir } };
  writeFileSync(config, `export default ${JSON.stringify({ test })};\n`);
  // Its own settings, so a Squeal observing this file leaves the nested run to them.
  const env = { ...process.env, ...observeEnv(recorder, { out, root: ROOT, skip: [] }, undefined) };
  const run = spawnSync(process.execPath, [VITEST, "run", "--root", ROOT, "--config", config], {
    cwd: ROOT,
    env,
    encoding: "utf8",
  });
  if (run.status !== 0) throw new Error(`the nested run failed:\n${run.stdout}\n${run.stderr}`);
  const found = takeRecorded(out);
  // What the nested run read keys this file too.
  for (const file of found.values()) observeBuildInputs(file.paths);
  return found;
}

beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-build-inputs-")));
  runDir = join(scratch, "run");
  mkdirSync(runDir);
  recorded = nestedRun("first", `${FIXTURES}/*.fixture.ts`);
  recordedHit = nestedRun("hit", `${FIXTURES}/cli.fixture.ts`);
}, 300_000);

afterAll(() => {
  if (scratch !== undefined) rmSync(scratch, { recursive: true, force: true });
});

/** What tsrs compiles for the project `tsconfig`, listed without a check, stat'ed. */
function listedBy(tsconfig: string): string[] {
  const listed = execFileSync(
    process.execPath,
    [TSRS, ...TSRS_ARGS, "-p", tsconfig, "--listFilesOnly"],
    { cwd: ROOT, encoding: "utf8" },
  );
  return observeBuildInputs(listed.split("\n"));
}

/** The worktree files of `compiled` the recorder did not attribute to `fixture`. */
function unobserved(
  fixture: string,
  compiled: readonly string[],
  run: Map<string, RecordedFile> = recorded,
): string[] {
  const paths = run.get(fixture)?.paths ?? new Set<string>();
  return compiled.filter((path) => !paths.has(join(ROOT, path)));
}

describe("a test that builds keys what its build compiled (011-141)", () => {
  it("records every file tsrs compiles for buildCli, by test", () => {
    const compiled = listedBy(join(ROOT, "tsconfig.build.json"));
    expect(compiled).toContain("src/core/scheduler/scheduler.ts");
    expect(compiled.length).toBeGreaterThan(500);
    expect(unobserved(CLI_FIXTURE, compiled)).toEqual([]);
  });

  it("records every file tsrs compiled for a build linked from the run's one (row 010-36)", () => {
    const compiled = listedBy(join(ROOT, "tsconfig.build.json"));
    const kept = readdirSync(join(runDir, "_shared-cli")).filter((entry) => UUID.test(entry));
    expect(kept).toHaveLength(1);
    expect(unobserved(CLI_FIXTURE, compiled, recordedHit)).toEqual([]);
  });

  it("records every file esbuild bundles for a bundle helper, by test", async () => {
    const result = await build({ ...bundleOptions(PI_PLUGIN, join(scratch, "pi")), write: false });
    const bundled = observeMetafile(result.metafile);
    expect(bundled).toContain("src/core/scheduler/scheduler.ts");
    expect(bundled.length).toBeGreaterThan(400);
    expect(unobserved(BUNDLE_FIXTURE, bundled)).toEqual([]);
  });

  it("records what a failed tsrs listed, its diagnostic too long for a file name (0.1.277 B2)", () => {
    const compiled = listedBy(join(ROOT, FIXTURES, "broken/tsconfig.json"));
    expect(compiled).toContain("src/core/text.ts");
    expect(unobserved(FAILED_FIXTURE, compiled)).toEqual([]);
  });
});

describe("sharedBuild builds once per run and links each target (row 010-36)", () => {
  let root: string;
  let run: string;
  let builds: string[];

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "squeal-shared-build-")));
    run = join(root, "run");
    writeFileSync(join(root, "a.ts"), "one\n");
    // Older than any build, as a file edited before the run is.
    utimesSync(join(root, "a.ts"), 0, 0);
    builds = [];
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** A build of `a.ts` into `cli/index.js`; `during` runs inside it. */
  function spec(extra: Partial<SharedBuild> = {}, during = () => {}): SharedBuild {
    return {
      runDir: run,
      name: "cli",
      recipe: "r1",
      build: (outdir) => {
        builds.push(outdir);
        mkdirSync(join(outdir, "cli"), { recursive: true });
        writeFileSync(join(outdir, "cli/index.js"), readFileSync(join(root, "a.ts")));
        during();
        return observeBuildInputs(["a.ts"], root);
      },
      ...extra,
    };
  }

  const built = (target: string) => readFileSync(join(target, "cli/index.js"), "utf8");
  const inode = (target: string) => statSync(join(target, "cli/index.js")).ino;

  it("builds the first call's and links it into the next, each target its own directory", () => {
    sharedBuild(spec(), join(root, "t1"), root);
    sharedBuild(spec(), join(root, "t2"), root);
    expect(builds).toHaveLength(1);
    expect(built(join(root, "t2"))).toBe("one\n");
    expect(inode(join(root, "t2"))).toBe(inode(join(root, "t1")));
  });

  it("builds again once an input or the recipe changed, and keeps the builds it replaced", () => {
    sharedBuild(spec(), join(root, "t1"), root);
    writeFileSync(join(root, "a.ts"), "two\n");
    utimesSync(join(root, "a.ts"), 0, 0);
    sharedBuild(spec(), join(root, "t2"), root);
    sharedBuild(spec({ recipe: "r2" }), join(root, "t3"), root);
    expect(builds).toHaveLength(3);
    expect([built(join(root, "t1")), built(join(root, "t2"))]).toEqual(["one\n", "two\n"]);
    // The latest build and the one before it; the first went.
    const kept = readdirSync(join(run, "_shared-cli")).filter((entry) => UUID.test(entry));
    expect(kept).toHaveLength(2);
  });

  it("serves a build whose input changed while it ran to its own call alone", () => {
    const touch = () => writeFileSync(join(root, "a.ts"), "one\n");
    sharedBuild(spec({}, touch), join(root, "t1"), root);
    sharedBuild(spec(), join(root, "t2"), root);
    expect(builds).toHaveLength(2);
  });

  it("builds into each target without a run directory", () => {
    sharedBuild(spec({ runDir: null }), join(root, "t1"), root);
    sharedBuild(spec({ runDir: null }), join(root, "t2"), root);
    expect(builds).toEqual([join(root, "t1"), join(root, "t2")]);
    expect(existsSync(run)).toBe(false);
  });

  it("releases its lock when a build fails, so the next call builds", () => {
    const failing = spec({
      build: () => {
        throw new Error("compile failed");
      },
    });
    expect(() => sharedBuild(failing, join(root, "t1"), root)).toThrow("compile failed");
    sharedBuild(spec(), join(root, "t2"), root);
    expect(builds).toHaveLength(1);
    expect(readdirSync(join(run, "_shared-cli"))).not.toContain("lock");
  });

  it("takes over a lock whose process is gone", async () => {
    const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await new Promise((done) => child.on("exit", done));
    mkdirSync(join(run, "_shared-cli"), { recursive: true });
    writeFileSync(join(run, "_shared-cli/lock"), String(child.pid));
    sharedBuild(spec(), join(root, "t1"), root);
    expect(builds).toHaveLength(1);
  });
});
