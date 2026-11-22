import type { Case } from "../../case.js";

/*
 * Row 023-47: a run names a file it read and wrote (`rewritten`). The core
 * keys it as a read only when git tracks it (`trackedRewrites`); this one
 * is the run's untracked scratch, so it keys nothing, and the keys are the
 * release's, which reads no `rewritten`.
 */

const TEST = "test/a.test.ts";

export const REWRITTEN_SCRATCH: readonly Case[] = [
  {
    kind: "assemble",
    name: "an untracked file the run read and wrote",
    why: "023-47: inputsOfReads asks git which rewritten files it tracks; an untracked one stays out, so no key moves",
    input: {
      files: { "data/x.txt": "x\n", [TEST]: "// a\n" },
      untracked: { "out.txt": "o\n" },
      environment: {
        project: "",
        runnerName: "validity",
        runnerVersion: "1",
        adapterVersion: "1",
        resolvedConfig: "{}",
        files: [],
      },
      closures: [{ path: TEST, imports: [] }],
      runtime: {
        freshObserved: [{ path: TEST, paths: ["data/x.txt"], rewritten: ["out.txt"] }],
      },
    },
  },
];
