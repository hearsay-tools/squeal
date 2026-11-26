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
 */
const fs = require("node:fs");

const LOADED = Symbol.for("squeal.jestLoaded");

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

function loadedOf(testFilePath) {
  const map = globalThis[LOADED];
  if (!(map instanceof Map)) return [];
  const paths = map.get(testFilePath);
  map.delete(testFilePath);
  return paths === undefined ? [] : [...paths].sort();
}

class SquealReporter {
  constructor() {
    this.events = process.env.SQUEAL_JEST_EVENTS || null;
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
      loaded: loadedOf(result.testFilePath ?? test.path),
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
