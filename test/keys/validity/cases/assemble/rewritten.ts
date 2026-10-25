import type { Case } from "../../case.js";

/*
 * Files the stat cache holds, rewritten before the daemon starts (row
 * 011-204): bootstrap's start pass finds each stat moved and hashes it again
 * in `diffCandidates`, a tracked and an untracked file with new bytes and one
 * with the same bytes (a touch). Each key names the bytes on disk, so every
 * key agrees at both trees.
 */

const APP = "test/app.test.ts";
const DATA = "test/data.test.ts";

export const REWRITTEN: readonly Case[] = [
  {
    kind: "assemble",
    name: "cached files rewritten before bootstrap, with new bytes and with the same bytes",
    why: "011-204: the start pass stores the stat taken after its read; no key moves",
    input: {
      files: {
        "src/app.ts": "export const app = 1;\n",
        "src/util.ts": "export const util = 1;\n",
        [APP]: "import '../src/app';\n",
        [DATA]: "import '../src/util';\n",
      },
      untracked: { "fixtures/data.json": "{}\n" },
      cached: ["src/app.ts", "src/util.ts", "fixtures/data.json"],
      rewritten: {
        "src/app.ts": "export const app = 2;\n",
        "src/util.ts": "export const util = 1;\n",
        "fixtures/data.json": '{"n":2}\n',
      },
      closures: [
        { path: APP, imports: ["src/app.ts"] },
        { path: DATA, imports: ["src/util.ts", "fixtures/data.json"] },
      ],
    },
  },
];
