import type { Case } from "../../case.js";

/*
 * What another worktree of the same store observed, read back by this one
 * (016 D4, rows 007-52 and 007-56): observed paths and direct marks of a
 * test file, and start-up paths of a module-load project, one entry
 * malformed.
 */

const TEST = "test/a.test.ts";

const FILES = {
  "squeal.config.json": `${JSON.stringify({ observe: { runtimeInputs: true } })}\n`,
  "src/app.ts": "export const app = 1;\n",
  "src/loaded.ts": "export const loaded = 1;\n",
  "setup/early.ts": "export {};\n",
  [TEST]: "import '../src/app';\n",
};

const ENVIRONMENT = {
  project: "",
  runnerName: "validity",
  runnerVersion: "1",
  adapterVersion: "1",
  resolvedConfig: "{}",
  files: [],
  observedLoads: true,
} as const;

export const ELSEWHERE: readonly Case[] = [
  {
    kind: "assemble",
    name: "observed paths and direct marks another worktree stored, read back",
    why: "016 D4 (O9, row 007-56): what another worktree's run of a module-load project observed joins this worktree's closure once it reads it back, at both trees alike; the direct marks it stored key nothing",
    input: {
      files: FILES,
      environment: ENVIRONMENT,
      closures: [{ path: TEST, imports: ["src/app.ts"] }],
      elsewhere: {
        observed: [
          { path: TEST, paths: ["src/loaded.ts"], direct: ["src/app.ts", "src/loaded.ts"] },
        ],
      },
    },
  },
  {
    kind: "assemble",
    name: "start-up paths another worktree stored, read back",
    why: "016 D4 (007 review wave 2.5, R1): a module-load project's start-up paths another worktree's run loaded join this worktree's environment once it reads them back; a tree before D4 keeps none in the core, so the keys differ",
    input: {
      files: FILES,
      environment: ENVIRONMENT,
      closures: [{ path: TEST, imports: ["src/app.ts"] }],
      elsewhere: { observed: [], startup: ["setup/early.ts"] },
    },
  },
  {
    kind: "assemble",
    name: "a malformed start-up entry another worktree left, read back",
    why: "016 D4: a start-up entry that does not parse, as a broken write would leave it, reads as no paths, so the environment keys as before at both trees",
    input: {
      files: FILES,
      environment: ENVIRONMENT,
      closures: [{ path: TEST, imports: ["src/app.ts"] }],
      elsewhere: { observed: [], malformed: true },
    },
  },
];
