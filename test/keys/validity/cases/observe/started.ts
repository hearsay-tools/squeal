import type { Case } from "../../case.js";

/*
 * What a process the test file started loaded (016 D4, goal 6, row
 * 016-22): its entry point and its imports, marked `direct` beside the read
 * paths. A sync and an async spawn, and a Worker of the test's own
 * process, whose loads mark nothing.
 */

export const OBSERVED_STARTED: readonly Case[] = [
  {
    kind: "observe",
    name: "a child process's imports, and a Worker's",
    why: "016-22: a spawned child's entry point and imports are marked direct, its file read and a Worker's import are not; the marks order an edit's work and key nothing, so the harness lists them as wording and RECORDER_VERSION stays (coordinator, 2026-10-25)",
    input: {
      files: {
        "src/child.cjs":
          'require("./dep.cjs");\nrequire("node:fs").readFileSync("src/data.txt");\n',
        "src/dep.cjs": "",
        "src/data.txt": "1\n",
        "src/worker.cjs": 'require("./thread.cjs");\n',
        "src/thread.cjs": "",
        "test/started.test.js": "// the test file the script works for\n",
      },
      testFile: "test/started.test.js",
      script: [
        'const { execFile, execFileSync } = require("node:child_process");',
        'const { Worker } = require("node:worker_threads");',
        'execFileSync(process.execPath, ["src/child.cjs"]);',
        'execFile(process.execPath, ["src/child.cjs"], () => {});',
        'new Worker(require("node:path").resolve("src/worker.cjs"));',
      ].join("\n"),
    },
  },
];
