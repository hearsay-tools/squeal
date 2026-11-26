// Throwaway probe (spec 028 research). A streaming Jest reporter: one JSON line
// per event, appended synchronously, so each line is on disk before the next
// test file starts. Output: $REPORT_OUT (a file).
const fs = require('fs');
const out = process.env.REPORT_OUT;
const emit = (o) => fs.appendFileSync(out, JSON.stringify({ at: Date.now(), pid: process.pid, ...o }) + '\n');
class SquealReporter {
  constructor(globalConfig, options) {
    this.coverageProvider = globalConfig.coverageProvider;
  }
  onRunStart(results, options) { emit({ e: 'runStart', files: results.numTotalTestSuites }); }
  onTestFileStart(test) { emit({ e: 'fileStart', file: test.path }); }
  onTestCaseResult(test, r) {
    emit({ e: 'case', file: test.path, ancestorTitles: r.ancestorTitles, title: r.title, fullName: r.fullName, status: r.status, location: r.location ?? null });
  }
  onTestFileResult(test, result) {
    emit({
      e: 'fileResult',
      file: test.path,
      testExecError: result.testExecError ? { message: result.testExecError.message.split('\n')[0], code: result.testExecError.code ?? null } : null,
      failureMessage: result.failureMessage ? result.failureMessage.split('\n').find((l) => l.includes('●')) : null,
      numFailing: result.numFailingTests, numPassing: result.numPassingTests, numPending: result.numPendingTests, numTodo: result.numTodoTests,
      snapshot: { added: result.snapshot.added, unmatched: result.snapshot.unmatched, unchecked: result.snapshot.unchecked, fileDeleted: result.snapshot.fileDeleted, uncheckedKeys: result.snapshot.uncheckedKeys },
      console: (result.console ?? []).map((c) => `${c.type}: ${c.message}`),
      openHandles: result.openHandles?.length ?? 0,
      v8Coverage: result.v8Coverage ? result.v8Coverage.length : null,
      v8Sample: result.v8Coverage ? result.v8Coverage.map((c) => ({ url: c.result.url.split('/').slice(-2).join('/'), functions: c.result.functions.length, transformed: Boolean(c.codeTransformResult), keys: Object.keys(c).join(',') })) : null,
      coverage: result.coverage ? Object.keys(result.coverage).length : null,
      perf: result.perfStats,
      cases: result.testResults.map((r) => ({ ancestorTitles: r.ancestorTitles, title: r.title, fullName: r.fullName, status: r.status, failing: r.failureMessages.length, invocations: r.invocations ?? null })),
    });
  }
  onRunComplete(contexts, results) {
    const map = results.coverageMap;
    emit({ e: 'runComplete', coverageMapFiles: map ? map.files().length : null, success: results.success, numRuntimeErrorTestSuites: results.numRuntimeErrorTestSuites, openHandles: results.openHandles?.length ?? 0 });
  }
  getLastError() {}
}
module.exports = SquealReporter;
