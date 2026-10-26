// Spec 015 D8: Squeal's own Vitest coverage provider (`coverage.provider:
// "custom"`), so a project needs no `@vitest/coverage-*` package. Vitest
// loads this file by path in its workers and in the daemon, so it imports
// Node's builtins only; the plugin bundles carry it in `dist/coverage/`.
//
// The worker side takes V8 precise coverage through `node:inspector`, as
// `@vitest/coverage-v8` does. It takes none in a project run with
// `isolate: false`, nor in a worker whose test file the daemon listed in
// `<reportsDirectory>/skip.json` (D8 Fidelity: its closure imports
// `node:inspector`). The main side keeps each worker batch's payload for
// the adapter (`takeBatches`) and writes no report.
//
// Vitest 5 passes the worker side `reportsDirectory` and
// `coverageFilesDirectory`. Vitest 4.1.10 passes neither (row 013-09):
// `reportsDirectory` is then read from the worker's config, and the payload
// goes where Vitest 5 puts it, `<reportsDirectory>/.tmp`.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import inspector from "node:inspector/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The module runner may evaluate this file more than once in a worker
// (015-01's probe: `takeCoverage` found no session), so the session lives
// on the process.
const SESSION = Symbol.for("squeal.coverage.session");

/** The test files of this worker's run (`globalThis.__vitest_worker__`, Vitest 4 and 5). */
function workerFiles() {
  const files = globalThis.__vitest_worker__?.ctx?.files ?? [];
  return files.map((file) => (typeof file === "string" ? file : file.filepath));
}

/** The worker's coverage options (`config.coverage`, Vitest 4 and 5). */
function workerCoverage() {
  return globalThis.__vitest_worker__?.config?.coverage ?? {};
}

/** Where a payload goes when Vitest names no directory (4.1.10). */
function filesDirectory() {
  const { coverageFilesDirectory, reportsDirectory } = workerCoverage();
  if (coverageFilesDirectory !== undefined) return coverageFilesDirectory;
  return reportsDirectory === undefined ? undefined : join(reportsDirectory, ".tmp");
}

/** Whether the daemon asked for no coverage in a run of these files. */
function skipped(reportsDirectory) {
  let skip;
  try {
    skip = new Set(JSON.parse(readFileSync(join(reportsDirectory, "skip.json"), "utf8")));
  } catch {
    return false;
  }
  return workerFiles().some((file) => skip.has(file));
}

/** A script of a file outside `node_modules`: what a record can hold. */
function kept(script) {
  return script.url.startsWith("file://") && !script.url.includes("/node_modules/");
}

export default {
  async startCoverage({ isolate, reportsDirectory = workerCoverage().reportsDirectory } = {}) {
    if (isolate === false || globalThis[SESSION] !== undefined) return;
    if (reportsDirectory === undefined || skipped(reportsDirectory)) return;
    const session = new inspector.Session();
    session.connect();
    await session.post("Profiler.enable");
    await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
    globalThis[SESSION] = session;
  },

  async takeCoverage({ moduleExecutionInfo, coverageFilesDirectory = filesDirectory() } = {}) {
    const session = globalThis[SESSION];
    if (session === undefined || coverageFilesDirectory === undefined) return undefined;
    const { result } = await session.post("Profiler.takePreciseCoverage");
    const scripts = [];
    for (const script of result) {
      if (!kept(script)) continue;
      // The evaluator's wrapper before the module's code (Vitest 4 and 5).
      const info = moduleExecutionInfo?.get(fileURLToPath(script.url));
      scripts.push({ ...script, startOffset: info?.startOffset ?? 0 });
    }
    mkdirSync(coverageFilesDirectory, { recursive: true });
    const file = join(coverageFilesDirectory, `coverage-${randomUUID()}.json`);
    writeFileSync(file, JSON.stringify({ result: scripts }));
    return file;
  },

  async stopCoverage() {
    const session = globalThis[SESSION];
    if (session === undefined) return;
    globalThis[SESSION] = undefined;
    await session.post("Profiler.stopPreciseCoverage");
    await session.post("Profiler.disable");
    session.disconnect();
  },

  getProvider() {
    return {
      name: "squeal",
      options: undefined,
      batches: [],
      initialize(ctx) {
        this.options = { ...ctx.config.coverage, reporter: [] };
      },
      resolveOptions() {
        return this.options;
      },
      clean() {
        this.batches = [];
      },
      onAfterSuiteRun(meta) {
        if (typeof meta.coverage === "string") this.batches.push(meta);
      },
      /** The batches since the last call, for the daemon's adapter. */
      takeBatches() {
        const taken = this.batches;
        this.batches = [];
        return taken;
      },
      generateCoverage() {
        return null;
      },
      reportCoverage() {},
    };
  },
};
