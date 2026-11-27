"use strict";
/*
 * Spec 028 D5.1 (row 028-03): Squeal's Jest reporter. Jest loads it from
 * `--reporters=<this file>` in the batch process, so it uses Node's
 * built-ins only. Each event is one JSON line appended synchronously to
 * `SQUEAL_JEST_EVENTS`, so a file's `fileResult` line is on disk before the
 * next file starts and outlives a killed batch (spec 016 Kit K8). Without
 * that variable it writes nothing.
 *
 * `loaded` in a `fileResult` line is what `observe-runtime.cjs` recorded
 * for that test file in `globalThis[Symbol.for("squeal.jestLoaded")]`, a
 * `Map` of test path to a `Set` of absolute paths; the entry is taken, so
 * the map does not grow over a batch. `[]` without the runtime observer.
 * `reads`, from `Symbol.for("squeal.jestReads")` alike, is what Jest's
 * transform and resolver read with success for the file (row 028-08).
 *
 * Spec 028 D5.3 (row 028-06b): with `SQUEAL_JEST_COVERAGE_DIR` set (a batch
 * run with `--coverage --coverageProvider=v8`), each file's
 * `result.v8Coverage` is written to `<n>.json` as `{ result }`, V8 scripts
 * by file URL with Jest 29's module wrapper as `startOffset`, and what
 * Jest's transform ran of each, `{ code, map, sha1 }` by absolute path, to
 * `<n>.sources.json`; the `fileResult` line then names both
 * (`coverageFile`, `transformSources`). The entries are taken from the
 * result, so Jest's own coverage reporter maps nothing.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");

const LOADED = Symbol.for("squeal.jestLoaded");
const READS = Symbol.for("squeal.jestReads");

/** `value` as JSON, or `null` when it cannot be written (a cycle, a BigInt). */
function safe(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

/** What a failure's error carries that Squeal reads; never the whole object, which may hold cycles. */
function detail(error) {
  if (typeof error !== "object" || error === null) return { message: String(error) };
  const code = error.code;
  return {
    name: typeof error.name === "string" ? error.name : null,
    message: typeof error.message === "string" ? error.message : null,
    stack: typeof error.stack === "string" ? error.stack : null,
    code: typeof code === "string" || typeof code === "number" ? String(code) : null,
    matcher: typeof error.matcherResult === "object" && error.matcherResult !== null,
  };
}

/** A case of `onTestCaseResult` or of a file's `testResults`. */
function testCase(result) {
  return {
    title: result.title,
    ancestorTitles: result.ancestorTitles,
    fullName: result.fullName,
    status: result.status,
    duration: typeof result.duration === "number" ? result.duration : null,
    location: result.location ?? null,
    failureMessages: result.failureMessages ?? [],
    failureDetails: (result.failureDetails ?? []).map(detail),
  };
}

/** The sorted paths `observe-runtime.cjs` kept for the file under `key`; the entry is taken. */
function taken(key, testFilePath) {
  const map = globalThis[key];
  if (!(map instanceof Map)) return [];
  const paths = map.get(testFilePath);
  map.delete(testFilePath);
  return paths === undefined ? [] : [...paths].sort();
}

/** The source map Jest's transform wrote; `null` without one, or one that does not read. */
function readMap(sourceMapPath) {
  if (typeof sourceMapPath !== "string") return null;
  try {
    return JSON.parse(fs.readFileSync(sourceMapPath, "utf8"));
  } catch {
    return null;
  }
}

/** The V8 payload and the transforms of one file's `v8Coverage` entries. */
function coverageOf(entries) {
  const result = [];
  const sources = {};
  for (const entry of entries) {
    const script = entry === null || typeof entry !== "object" ? null : entry.result;
    if (script === null || typeof script !== "object" || typeof script.url !== "string") continue;
    const transform = entry.codeTransformResult;
    // Jest 29 runs a module in a wrapper before its code; Jest 30 compiles a function.
    const wrapper =
      transform !== undefined && transform !== null && typeof transform.wrapperLength === "number"
        ? transform.wrapperLength
        : 0;
    const url = script.url.startsWith("file:") ? script.url : pathToFileURL(script.url).href;
    result.push({
      url,
      functions: script.functions,
      ...(wrapper > 0 ? { startOffset: wrapper } : {}),
    });
    if (transform === undefined || transform === null || typeof transform.code !== "string") {
      continue;
    }
    const file = script.url.startsWith("file:") ? fileURLToPath(script.url) : script.url;
    sources[file] = {
      code: transform.code,
      map: readMap(transform.sourceMapPath),
      sha1:
        typeof transform.originalCode === "string"
          ? crypto.createHash("sha1").update(transform.originalCode, "utf8").digest("hex")
          : null,
    };
  }
  return { result, sources };
}

class SquealReporter {
  constructor() {
    this.events = process.env.SQUEAL_JEST_EVENTS || null;
    this.coverageDir = process.env.SQUEAL_JEST_COVERAGE_DIR || null;
    this.covered = 0;
  }

  /**
   * Writes the file's coverage and returns the fields its `fileResult`
   * names; `{}` without coverage or when a file cannot be written (the
   * run's log folder was removed: nothing makes it again).
   */
  coverage(result) {
    const entries = result.v8Coverage;
    if (this.coverageDir === null || entries === undefined) return {};
    result.v8Coverage = undefined;
    if (!Array.isArray(entries) || entries.length === 0) return {};
    const { result: scripts, sources } = coverageOf(entries);
    const index = this.covered++;
    const coverageFile = path.join(this.coverageDir, `${index}.json`);
    const transformSources = path.join(this.coverageDir, `${index}.sources.json`);
    try {
      fs.writeFileSync(transformSources, JSON.stringify(sources));
      fs.writeFileSync(coverageFile, JSON.stringify({ result: scripts }));
    } catch {
      return {};
    }
    return { coverageFile, transformSources };
  }

  write(record) {
    if (this.events === null) return;
    fs.appendFileSync(this.events, `${JSON.stringify(record)}\n`);
  }

  onTestFileStart(test) {
    this.write({ type: "fileStart", testFilePath: test.path });
  }

  onTestCaseResult(test, result) {
    this.write({ type: "case", testFilePath: test.path, ...testCase(result) });
  }

  onTestFileResult(test, result) {
    const stats = result.perfStats ?? {};
    const snapshot = result.snapshot ?? {};
    const error = result.testExecError;
    this.write({
      type: "fileResult",
      testFilePath: result.testFilePath ?? test.path,
      durationMs:
        typeof stats.end === "number" && typeof stats.start === "number"
          ? stats.end - stats.start
          : (stats.runtime ?? null),
      testResults: (result.testResults ?? []).map(testCase),
      testExecError: error === undefined || error === null ? null : detail(error),
      failureMessage: result.failureMessage ?? null,
      snapshot: {
        added: snapshot.added ?? 0,
        fileDeleted: snapshot.fileDeleted ?? false,
        matched: snapshot.matched ?? 0,
        unchecked: snapshot.unchecked ?? 0,
        uncheckedKeys: safe(snapshot.uncheckedKeys) ?? [],
        unmatched: snapshot.unmatched ?? 0,
        updated: snapshot.updated ?? 0,
      },
      loaded: taken(LOADED, result.testFilePath ?? test.path),
      reads: taken(READS, result.testFilePath ?? test.path),
      ...this.coverage(result),
    });
  }

  onRunComplete(_contexts, results) {
    this.write({
      type: "runComplete",
      success: results.success === true,
      numFailedTestSuites: results.numFailedTestSuites,
      numPassedTestSuites: results.numPassedTestSuites,
    });
  }

  getLastError() {
    return undefined;
  }
}

module.exports = SquealReporter;
