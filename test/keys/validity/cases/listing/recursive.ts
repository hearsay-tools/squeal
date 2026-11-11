import type { Case } from "../../case.js";

/*
 * Row 020-20: what a run read beyond its closure, as `observedGrowth` keys
 * it through `inputsOfReads`, the rule the gate's `--parts` shares. A
 * recursive listing of `fixtures` adds the listing of each directory below
 * it that holds a file the watcher sees, an untracked one too (B5, task
 * 001-134); a read through the directory link `linked` adds the link's
 * target (task 001-148); a git-ignored path below a directory the run
 * wrote is the run's own scratch (016 D4). The rule moved, the keys did not.
 */

const TEST = "test/a.test.ts";

export const RECURSIVE_LISTING: readonly Case[] = [
  {
    kind: "assemble",
    name: "a recursive listing, a read through a directory link and the run's scratch",
    why: "020-20: observedGrowth reads its inputs from inputsOfReads, which the gate's --parts calls too; a recursive listing ran in no case before, so its lines needed one; the keys are the release's",
    input: {
      files: {
        ".gitignore": "out/\n",
        "data/x.txt": "x\n",
        "fixtures/one/a.txt": "a\n",
        "fixtures/two/deep/b.txt": "b\n",
        [TEST]: "// a\n",
      },
      untracked: { "fixtures/new/c.txt": "c\n", "out/run.json": "{}\n" },
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
        links: { linked: "data" },
        freshObserved: [
          {
            path: TEST,
            paths: ["linked/x.txt", "out/run.json"],
            directories: ["fixtures"],
            recursive: ["fixtures"],
            written: ["out"],
          },
        ],
      },
    },
  },
];
