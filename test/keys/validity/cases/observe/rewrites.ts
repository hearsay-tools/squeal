import type { Case } from "../../case.js";

/*
 * Row 023-47: a run that reads a tracked file and then rewrites it. The
 * file stays out of `paths`, as every path the run wrote, and is named in
 * `rewritten`, which the core keys as a read when git tracks the file
 * (`inputsOfReads`). Before, it was dropped, and such a run was kept at the
 * key from before it, which two commits can share. Review 0.1.598 B1: a
 * file replaced with a directory is named too.
 */

export const OBSERVED_REWRITES: readonly Case[] = [
  {
    kind: "observe",
    name: "a tracked file read and then rewritten",
    why: "023-47: observedInputs names a file the run read and wrote as `rewritten`, so the core can key it as a read and the run is not kept at its key from before the run",
    input: {
      files: {
        "data/a.txt": "1\n",
        "src/value.txt": "2\n",
        "test/rewrites.test.js": "// the test file the script works for\n",
      },
      testFile: "test/rewrites.test.js",
      script: [
        'const fs = require("node:fs");',
        'fs.readFileSync("src/value.txt");',
        'if (fs.readFileSync("data/a.txt", "utf8") === "1\\n") fs.writeFileSync("data/a.txt", "2\\n");',
      ].join("\n"),
    },
  },
  {
    kind: "observe",
    name: "a tracked file read, removed and replaced with a directory",
    why: "review 0.1.598 B1: observedInputs names a file the run read and wrote as `rewritten` whatever stands at its path after the run, so a file the run replaced with a directory is keyed too",
    input: {
      files: {
        "data/a.txt": "1\n",
        "test/replaces.test.js": "// the test file the script works for\n",
      },
      testFile: "test/replaces.test.js",
      script: [
        'const fs = require("node:fs");',
        'fs.readFileSync("data/a.txt");',
        'fs.rmSync("data/a.txt");',
        'fs.mkdirSync("data/a.txt");',
      ].join("\n"),
    },
  },
];
