import type { Case } from "../../case.js";

/*
 * Closures with declared inputs, slow and fast (011-37 section 4, the 12->13
 * cases; 004-81 took gitignored artifacts out of closures).
 */

const SLOW = "test/slow/app.test.ts";
const FAST = "test/fast.test.ts";

const config = (inputs: Record<string, string[]>, slow: string[] = ["test/slow/**"]) =>
  `${JSON.stringify({ slow: { include: slow }, inputs })}\n`;

const files = (inputs: Record<string, string[]>, slow?: string[]) => ({
  ".gitignore": "dist/\nout/\n",
  "squeal.config.json": config(inputs, slow),
  "src/app.ts": "export const app = 1;\n",
  "fixtures/data.json": "{}\n",
  [SLOW]: "import '../../src/app';\n",
  [FAST]: "import '../src/app';\n",
});

const closures = [
  { path: SLOW, imports: ["src/app.ts"] },
  { path: FAST, imports: ["src/app.ts"] },
];

export const DECLARED: readonly Case[] = [
  {
    kind: "assemble",
    name: "a slow file's gitignored artifact that exists",
    why: "12->13 case 1 (004-81): the artifact leaves the closure, so its key moves",
    input: {
      files: files({ [SLOW]: ["dist/**"] }),
      untracked: { "dist/app.js": "1;\n" },
      closures,
    },
  },
  {
    kind: "assemble",
    name: "a slow file's artifact glob that matches no file",
    why: "12->13 case 2: nothing to leave the closure, so the key stays",
    input: { files: files({ [SLOW]: ["dist/**"] }), closures },
  },
  {
    kind: "assemble",
    name: "a slow file's tracked declared input",
    why: "12->13 case 3: a tracked input stays in the closure",
    input: { files: files({ [SLOW]: ["fixtures/**"] }), closures },
  },
  {
    kind: "assemble",
    name: "a fast file's gitignored declared input",
    why: "12->13 case 4: only a slow file's artifact left the closure",
    input: {
      files: files({ [FAST]: ["out/**"] }),
      untracked: { "out/data.json": "{}\n" },
      closures,
    },
  },
  {
    kind: "assemble",
    name: "a fast file with no inputs",
    why: "12->13 case 5: a closure of imports alone",
    input: { files: files({}, []), closures },
  },
];
