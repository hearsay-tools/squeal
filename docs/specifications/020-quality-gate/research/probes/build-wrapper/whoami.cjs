// Probe preload: names each Node process (pid, parent, argv, whether node:test made it a test child).
const fs = require("node:fs");
const { isMainThread } = require("node:worker_threads");
if (isMainThread && process.env.PROBE_WHO) {
  const row = { pid: process.pid, ppid: process.ppid, argv: process.argv.slice(1), execArgv: process.execArgv,
    testContext: process.env.NODE_TEST_CONTEXT ?? null, v8cov: process.env.NODE_V8_COVERAGE ?? null };
  fs.appendFileSync(process.env.PROBE_WHO, JSON.stringify(row) + "\n");
}
