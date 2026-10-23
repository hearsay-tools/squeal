import type { Case } from "../../case.js";

/*
 * Gitignored paths a predecessor left in the stat cache (row 011-36): one a
 * removed test file's closure named, one nothing names, and declared scratch
 * a saved closure names until the runner's replaces it. Which of them stay
 * watched is no key: every key agrees at both trees.
 */

const FAST = "test/fast.test.ts";
const GONE = "test/gone.test.ts";

export const INHERITED: readonly Case[] = [
  {
    kind: "assemble",
    name: "cached ignored paths after the closures that named them are replaced or removed",
    why: "011-36: bootstrap's ignored extras are judged with revived scratch; no key moves",
    input: {
      files: {
        ".gitignore": "dist/\nout/\n",
        "squeal.config.json": `${JSON.stringify({ inputs: { [FAST]: ["out/**"] } })}\n`,
        "src/app.ts": "export const app = 1;\n",
        [FAST]: "import '../src/app';\n",
        [GONE]: "import '../dist/app.js';\n",
      },
      untracked: {
        "dist/app.js": "1;\n",
        "dist/app.d.ts": "export {};\n",
        "out/data.json": "{}\n",
      },
      cached: ["dist/app.js", "dist/app.d.ts", "out/data.json"],
      environment: {
        project: "",
        runnerName: "validity",
        runnerVersion: "1",
        adapterVersion: "1",
        resolvedConfig: "{}",
        files: [],
      },
      closures: [
        { path: FAST, imports: ["src/app.ts", "out/data.json"] },
        { path: GONE, imports: ["dist/app.js"] },
      ],
      after: { closures: [{ path: FAST, imports: ["src/app.ts"] }], removed: [GONE] },
    },
  },
];
