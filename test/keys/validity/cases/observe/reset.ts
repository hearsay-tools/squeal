import type { Case } from "../../case.js";

/*
 * Spec 028 D7 (row 028-07a): a long-lived process starts each batch with
 * `Symbol.for("squeal.observeReset")`. Here it resets to the folder it
 * already writes to, so every line of the reset runs while the records stay
 * where the last release, which has no reset, writes them: a read before
 * and after it, and a child started after it, give the same observed set.
 */

export const OBSERVED_RESET: readonly Case[] = [
  {
    kind: "observe",
    name: "a read and a child before and after a reset to the same folder",
    why: "028 D7: the recorder's per-batch reset clears what it saw and moves its output and SQUEAL_OBSERVE to the batch's folder; to the same folder, the observed set equals the last release's, so RECORDER_VERSION stays 7",
    input: {
      files: {
        "data/before.txt": "1\n",
        "data/after.txt": "2\n",
        "scripts/child.cjs": 'require("node:fs").readFileSync("data/child.txt");\n',
        "data/child.txt": "3\n",
        "test/reset.test.js": "// the test file the script works for\n",
      },
      testFile: "test/reset.test.js",
      script: [
        'const fs = require("node:fs");',
        'const { spawnSync } = require("node:child_process");',
        'fs.readFileSync("data/before.txt");',
        "const settings = JSON.parse(process.env.SQUEAL_OBSERVE);",
        'globalThis[Symbol.for("squeal.observeReset")]?.(settings.out, settings.skip);',
        'fs.readFileSync("data/before.txt");',
        'fs.readFileSync("data/after.txt");',
        'spawnSync(process.execPath, ["scripts/child.cjs"]);',
      ].join("\n"),
    },
  },
];
