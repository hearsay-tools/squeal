import type { Case } from "../../case.js";

/*
 * Reads below directories the run made (016 D4, the written-directory
 * bound): `mkdir` of a directory that holds a fixture, and `mkdtemp` of one
 * a process out of the recorder's reach writes into. The core reads
 * `written` to drop a git-ignored path below one.
 */

export const OBSERVED_WRITTEN: readonly Case[] = [
  {
    kind: "observe",
    name: "reads below a directory made by mkdir and one made by mkdtemp",
    why: "016 D4, the case that stands for RECORDER_VERSION 4: the recorder records mkdtemp as a create, and observedInputs names the directories the run wrote, created or removed above a kept path as `written`, which the core's written-directory bound reads, so what is kept changes (the human, 2026-10-25)",
    input: {
      files: {
        "out/data.txt": "1\n",
        "scratch/.keep": "",
        "src/value.txt": "2\n",
        "test/written.test.js": "// the test file the script works for\n",
      },
      testFile: "test/written.test.js",
      script: [
        'const fs = require("node:fs");',
        'const { execFileSync } = require("node:child_process");',
        'fs.mkdirSync("out", { recursive: true });',
        'fs.readFileSync("out/data.txt");',
        'const temp = fs.mkdtempSync("scratch/t-");',
        'execFileSync("cp", ["src/value.txt", temp + "/value.txt"]);',
        'fs.readFileSync(temp + "/value.txt");',
        'process.stdout.write(temp + "\\n");',
      ].join("\n"),
      temporary: true,
    },
  },
];
