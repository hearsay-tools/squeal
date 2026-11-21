// `squeal ci record`'s hook for node:test (spec 018 D22, D24; row 018-47). First in
// `NODE_OPTIONS` of every Node process of the recorded command, ahead of Squeal's node:test
// module recorder (`runtime/recorder.cjs`, loaded as the daemon loads it, unchanged). It
// takes the input evidence (`evidence-hooks.cjs`, shared with Vitest's recording), then
// tells the recorder where the edges of this process go, by D24's rule:
//
// 1. A test file's process: `NODE_TEST_CONTEXT` is set (node:test sets it in each file's
//    process, never in the `node --test` process) and `SQUEAL_CI_NODE_TEST_FILE` is not. The
//    test file is the absolute `argv[1]`. Before any test code runs, this hook sets
//    `SQUEAL_CI_NODE_TEST_FILE` to it and `SQUEAL_CI_NODE_TEST_PROCESS` to this pid, and writes
//    `<graph>/<pid>.json`: the file, the `node --test` process (`ppid`), and the Node probe's
//    raw fields, for a part when that process left no reporter events (D23.5).
// 2. A process a test spawned: `SQUEAL_CI_NODE_TEST_FILE` is inherited, or put back by
//    `children.cjs` into an env of the caller's own. Its edges go to that file's process.
// 3. Any other process (the `node --test` process itself, `npm`, a Vitest process): no edges.
//    So is a test file's process of a `node --test` that a Vitest test started (the settings
//    say `nested`, `children.cjs`): that run is a test's own, not the project's, and its
//    process writes no `<pid>.json`, so it gives no part and no "names no Squeal reporter" line
//    (row 018-54, as row 018-27 for Vitest). Its loads stay in the evidence. So is every
//    process of a command whose own env carries `NODE_TEST_CONTEXT` (the settings say
//    `skipped`, row 018-68): that recording runs inside a node:test test, Node itself skips
//    its every `node --test` ("run() is being called recursively within a test file"), and a
//    process that merely inherited the variable is no test file's process either — it writes
//    no `<pid>.json`, so no empty part and no "names no Squeal reporter" line stands in for a
//    `node --test` that never ran. A real empty run (no matching files) has no
//    `NODE_TEST_CONTEXT` in the command's env, so it keeps its part.
//
// The recorder writes `<SQUEAL_NODE_TEST_GRAPH>-<pid>.ndjson`, so the graph prefix is
// `<graph>/<test file's pid>`; its preload phase ends at the test file's entry, as in the
// daemon's run, and a spawned process inherits (or gets here) `SQUEAL_NODE_TEST_STARTED`, so it
// marks no preload. Without the settings (`SQUEAL_CI_RECORD`, `nodeTest`) it does nothing.
// Dependency-free CommonJS; never the test's failure.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { isInternalThread, isMainThread } = require("node:worker_threads");

const VARIABLE = "SQUEAL_CI_RECORD";
const FILE = "SQUEAL_CI_NODE_TEST_FILE";
const PROCESS = "SQUEAL_CI_NODE_TEST_PROCESS";
const GRAPH = "SQUEAL_NODE_TEST_GRAPH";
const STARTED = "SQUEAL_NODE_TEST_STARTED";

/** The shared hook `name`: beside this file in `dist/ci/`, two folders up in the sources. */
function shared(name) {
  const beside = path.join(__dirname, name);
  return require(
    fs.existsSync(beside) ? beside : path.join(__dirname, "..", "..", "ci-runtime", name),
  );
}

/** The settings' graph directory, whether a Vitest run is above this process, and whether
 * the command's env carries `NODE_TEST_CONTEXT`, or `null`. */
function graphDir() {
  try {
    const settings = JSON.parse(process.env[VARIABLE] ?? "");
    const nodeTest = settings?.nodeTest;
    const graph = nodeTest?.graph;
    if (typeof graph !== "string" || !path.isAbsolute(graph)) return null;
    return { graph, nested: settings.nested === true, skipped: nodeTest.skipped === true };
  } catch {
    return null;
  }
}

/** The fields the daemon's probe hashes into `nodeBuild` (`adapter-environment.ts`), raw. */
const probe = () => ({
  version: process.version,
  build: {
    versions: process.versions,
    config: process.config,
    platform: process.platform,
    arch: process.arch,
  },
});

const found = isInternalThread ? null : graphDir();
if (found !== null) {
  const { graph, nested, skipped } = found;
  try {
    const hooks = shared("evidence-hooks.cjs");
    hooks.installEvidence(hooks.evidenceSettings());
  } catch {}
  try {
    const script = process.argv[1];
    const testFile =
      isMainThread &&
      process.env.NODE_TEST_CONTEXT &&
      !process.env[FILE] &&
      !nested &&
      !skipped &&
      script;
    if (testFile) {
      process.env[FILE] = path.resolve(script);
      process.env[PROCESS] = String(process.pid);
      const info = { file: process.env[FILE], ppid: process.ppid, cwd: process.cwd(), ...probe() };
      fs.writeFileSync(path.join(graph, `${process.pid}.json`), JSON.stringify(info));
    }
    const owner = process.env[PROCESS];
    if (process.env[FILE] && owner && /^\d+$/.test(owner)) {
      const prefix = path.join(graph, owner);
      process.env[GRAPH] = prefix;
      if (!testFile) process.env[STARTED] = prefix;
    }
  } catch {}
}
