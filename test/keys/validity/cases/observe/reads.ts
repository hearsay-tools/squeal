import type { Case } from "../../case.js";

/* The paths a run is observed to read, stat and list, kept for later keys (001-132, 001-134, 001-139). */

const files = {
  "data/config.json": "{}\n",
  "src/value.txt": "1\n",
  "fixtures/a.txt": "a\n",
  "fixtures/deep/b.txt": "b\n",
  "test/reads.test.js": "// the test file the script works for\n",
};

export const OBSERVED_READS: readonly Case[] = [
  {
    kind: "observe",
    name: "a stat, a read and a listing",
    why: "001-132, 001-134: a stat'ed and a read path, and a listed directory as its listing path",
    input: {
      files,
      testFile: "test/reads.test.js",
      script: [
        'const fs = require("node:fs");',
        'fs.statSync("data/config.json");',
        'fs.readFileSync("src/value.txt");',
        'fs.readdirSync("fixtures");',
      ].join("\n"),
    },
  },
  {
    kind: "observe",
    name: "a recursive listing",
    why: "001-139: a recursive listing is kept as a listing among `recursive` too",
    input: {
      files,
      testFile: "test/reads.test.js",
      script: 'require("node:fs").readdirSync("fixtures", { recursive: true });',
    },
  },
];
