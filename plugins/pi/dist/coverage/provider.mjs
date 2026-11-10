// Spec 015 D8: Squeal's own Vitest coverage provider (`coverage.provider:
// "custom"`), so a project needs no `@vitest/coverage-*` package. Vitest
// loads this file by path in its workers and in the daemon, so it uses
// Node's builtins only; the plugin bundles carry it in `dist/coverage/`.
//
// Row 018-10: Vitest's module runner evaluates this file again in a worker
// after a test file ran, with that file's `vi.mock`s in place, so a static
// import of `node:path` could get `path.win32` and write the payload to a
// relative `\tmp\...` file. It takes each builtin through
// `process.getBuiltinModule` (Node 22.3), which no test's mock reaches.
//
// The worker side takes V8 precise coverage through `node:inspector`, as
// `@vitest/coverage-v8` does. It takes none in a project run with
// `isolate: false`, nor in a worker whose test file the daemon listed in
// `<reportsDirectory>/skip.json` (D8 Fidelity: its closure imports
// `node:inspector`). The main side keeps each worker batch's payload for
// the adapter (`takeBatches`) and writes no report.
//
// Spec 020 D12 (row 020-10a): with the daemon's flag `children` beside `skip.json`
// (`coverage.children`), a worker that takes coverage points `NODE_V8_COVERAGE` at
// `children-<id>` beside the payload it writes next, `coverage-<id>.json`, whose name so
// names it, and at a new one after each payload: the processes and threads each test
// file starts write their coverage there. Node makes the directory when one writes. A
// variable already set (a project's own, or inherited) is left alone, and the file
// `kept` beside the flag tells the adapter.
//
// Vitest 5 passes the worker side `reportsDirectory` and
// `coverageFilesDirectory`. Vitest 4.1.10 passes neither (row 013-09):
// `reportsDirectory` is then read from the worker's config, and the payload
// goes where Vitest 5 puts it, `<reportsDirectory>/.tmp`.
const { randomUUID } = process.getBuiltinModule("node:crypto");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = process.getBuiltinModule("node:fs");
const inspector = process.getBuiltinModule("node:inspector/promises");
const { join } = process.getBuiltinModule("node:path");
const { fileURLToPath } = process.getBuiltinModule("node:url");

// The module runner may evaluate this file more than once in a worker
// (015-01's probe: `takeCoverage` found no session), so the session lives
// on the process.
const SESSION = Symbol.for("squeal.coverage.session");
/** The id of the next payload, whose children's directory the variable names (020 D12). */
const CHILDREN = Symbol.for("squeal.coverage.children");

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

/** Spec 020 D12: the next payload's id, and the variable at its children's directory. */
function pointChildren(directory) {
  const id = randomUUID();
  process.env.NODE_V8_COVERAGE = join(directory, `children-${id}`);
  globalThis[CHILDREN] = id;
}

/** Spec 020 D12: with the daemon's flag, children of this worker's tests write their coverage. */
function startChildren(reportsDirectory) {
  if (!existsSync(join(reportsDirectory, "children"))) return;
  if (process.env.NODE_V8_COVERAGE !== undefined) {
    writeFileSync(join(reportsDirectory, "kept"), "");
    return;
  }
  pointChildren(filesDirectory() ?? join(reportsDirectory, ".tmp"));
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
    startChildren(reportsDirectory);
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
    const children = globalThis[CHILDREN];
    const file = join(coverageFilesDirectory, `coverage-${children ?? randomUUID()}.json`);
    writeFileSync(file, JSON.stringify({ result: scripts }));
    if (children !== undefined) pointChildren(coverageFilesDirectory);
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
