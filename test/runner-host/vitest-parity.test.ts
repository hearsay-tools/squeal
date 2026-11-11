import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { describe, expect, it, onTestFinished } from "vitest";
import { coverageProvider } from "../../src/core/code/coverage/runtime.js";
import type { CoverageRun } from "../../src/core/code/coverage/types.js";
import { squealVersion } from "../../src/core/daemon/version.js";
import { createHostedVitest } from "../../src/core/runner-host/vitest-host.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { RunnerAdapter, RunReport } from "../../src/core/types/runner.js";
import { createVitestAdapter, type VitestAdapterOptions } from "../../src/runners/vitest/index.js";
import { SLOW as DAEMON_SLOW, suiteCli } from "../daemon/helpers.js";
import {
  ALL_TEST_FILES,
  type FixtureProject,
  openFixture,
  ref,
  TYPECHECKED,
} from "../runners/vitest/helpers.js";

/*
 * Spec 021 D8 (row 021-11) done-when: the Vitest adapter in a runner host,
 * driven through the proxy, gives the same answers and results as the
 * adapter in this process. Each case runs the same steps on two copies of a
 * fixture, one per adapter, and compares what they return, durations left
 * out. The host is the real `squeal runner-host` of a build of `src`.
 */

// With the observe recorder beside the build, as the plugin bundles ship it.
const built = suiteCli({ observe: true });

type Make = (options: VitestAdapterOptions) => Promise<RunnerAdapter>;
const inProcess: Make = (options) => createVitestAdapter(options);
const hosted: Make = (options) =>
  createHostedVitest(
    { execPath: process.execPath, execArgv: [], cli: built().cli },
    squealVersion(),
    options,
  );

/** `steps` on a fresh copy of `fixture` through each adapter; both results. */
async function both<T>(
  steps: (project: FixtureProject) => Promise<T>,
  fixture = "basic",
  files: Readonly<Record<string, string>> = {},
  options: Omit<VitestAdapterOptions, "root"> = {},
): Promise<{ local: T; remote: T }> {
  const local = await steps(
    await openFixture(fixture, files, (root) => inProcess({ root, ...options })),
  );
  const remote = await steps(
    await openFixture(fixture, files, (root) => hosted({ root, ...options })),
  );
  return { local, remote };
}

/** A report without what differs between two runs of the same files: durations, run ids. */
function steady(report: RunReport): unknown {
  return {
    ...report,
    durationMs: 0,
    results: report.results.map((r) => ({ ...r, durationMs: 0 })),
    fileDurations: report.fileDurations?.map((d) => ({ ...d, durationMs: 0 })),
  };
}

const refs = ALL_TEST_FILES.map((path) => ref(path));

describe("the Vitest adapter through a runner host", DAEMON_SLOW, () => {
  it("lists, keys and describes the same", async () => {
    const { local, remote } = await both(async ({ adapter }) => ({
      name: adapter.name,
      adapterVersion: adapter.adapterVersion,
      focuses: adapter.focuses,
      testFiles: await adapter.testFiles(),
      omitted: adapter.omittedTestFiles?.(),
      environment: await adapter.environment(),
      globalSetups: await adapter.globalSetups?.(),
      closures: await Promise.all(refs.map((f) => adapter.closure(f))),
      checks: await Promise.all(refs.map((f) => adapter.enumerate(f))),
      tierWidth: adapter.tierWidth?.(ref("test/math.test.ts"), 64),
      slowWidth: adapter.slowWidth?.(refs),
    }));
    expect(remote).toEqual(local);
    expect(local.testFiles.map((f) => f.path)).toEqual(ALL_TEST_FILES);
  });

  it("runs every file with the same results, file ends and observed inputs", async () => {
    const { local, remote } = await both(
      async (project) => {
        const ended: TestFileRef[] = [];
        const report = await project.adapter.run(
          refs,
          project.runOptions({ fileEnded: (f) => ended.push(f) }),
        );
        return { report: steady(report), ended: ended.map((f) => f.path).sort() };
      },
      "basic",
      {},
      { observe: () => true },
    );
    expect(remote).toEqual(local);
    expect((local.report as RunReport).end).toBe("completed");
  });

  it("hands over the same coverage payloads, sources by path", async () => {
    const provider = coverageProvider();
    if (provider === null) throw new Error("no coverage provider beside the sources");
    const tempDir = mkdtempSync(join(tmpdir(), "sq-host-coverage-"));
    onTestFinished(() => rmSync(tempDir, { recursive: true, force: true }));
    const runs: CoverageRun[] = [];
    const { local, remote } = await both(
      async (project) => {
        runs.length = 0;
        const report = await project.adapter.run(refs, project.runOptions());
        await expect.poll(() => runs.length).toBe(1);
        return {
          report: steady(report),
          // In the order the workers ended, which varies: sorted by test file.
          covered: runs
            .flatMap((run) =>
              run.files.map((file) => ({
                testFile: file.testFile,
                payload: existsSync(file.payload),
                sources: [...file.sources]
                  .map(([path, source]) => [relative(project.root, path), source.path, source.sha1])
                  .sort(),
              })),
            )
            .sort((a, b) => a.testFile.path.localeCompare(b.testFile.path)),
        };
      },
      "basic",
      {},
      {
        coverage: {
          enabled: () => true,
          provider,
          tempDir,
          collected: (run) => runs.push(run),
        },
      },
    );
    expect(remote).toEqual(local);
    expect(local.covered.length).toBeGreaterThan(0);
    expect(local.covered.every((file) => file.payload && file.sources.length > 0)).toBe(true);
  });

  it("finds the same affected files after an edit, and runs a failing edit the same", async () => {
    const { local, remote } = await both(async (project) => {
      const { adapter } = project;
      await adapter.testFiles();
      project.write("src/math.ts", "export const add = (a: number, b: number) => a - b;\n");
      const invalidated = await adapter.invalidate([{ path: "src/math.ts", kind: "change" }]);
      const affected = await adapter.affected(["src/math.ts"]);
      const report = await adapter.run(
        [...affected.direct, ...affected.transitive],
        project.runOptions(),
      );
      return { invalidated, affected, report: steady(report) };
    });
    expect(remote).toEqual(local);
    expect((local.report as RunReport).results.some((r) => r.outcome === "fail")).toBe(true);
  });

  it("leaves out the same typecheck files", async () => {
    const { local, remote } = await both(
      async ({ adapter }) => ({
        files: await adapter.testFiles(),
        omitted: adapter.omittedTestFiles?.(),
      }),
      "basic",
      TYPECHECKED,
    );
    expect(remote).toEqual(local);
    expect(local.omitted).toBe(1);
  });

  it("fails to start with the same text on a broken config", async () => {
    const broken = { "vitest.config.ts": "export default {\n" };
    // One after the other: the in-process start moves this process into its copy, which a
    // host started meanwhile would inherit as its working directory.
    const errors: string[] = [];
    for (const make of [inProcess, hosted]) {
      errors.push(
        await (async () => {
          let at = "";
          try {
            await openFixture("basic", broken, async (root) => {
              at = root;
              if (make === hosted) return make({ root });
              // Vite names the config from the working directory: the daemon's in-process calls
              // run in the root (`inRootWhileRunning`), as a host does.
              const back = process.cwd();
              process.chdir(root);
              try {
                return await make({ root });
              } finally {
                process.chdir(back);
              }
            });
            return "started";
          } catch (error) {
            // Vite colours each character of its frame, as the note strips it; each copy's
            // directory has a name of its own.
            const text = stripVTControlCharacters(
              error instanceof Error ? error.message : String(error),
            );
            return text.replaceAll(at, "<root>").replaceAll(basename(at), "<copy>");
          }
        })(),
      );
    }
    expect(errors[1]).toBe(errors[0]);
    expect(errors[0]).not.toBe("started");
  });
});
