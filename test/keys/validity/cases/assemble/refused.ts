import type { Case } from "../../case.js";

/*
 * Row 011-310 (issue #166): an observed path closure assembly cannot take,
 * as a test that fakes win32 stores one (`\home\...`), read from the shared
 * set at start and from a run's record. A tree before 011-310 throws at
 * the closure, so it stored nothing under any key with such a set: the
 * case shows the change, and that no earlier key is found by it.
 */

const TEST = "test/a.test.ts";
const BAD = String.raw`\home\agent\AppData\Local\Hearsay Squawk\cache`;

export const REFUSED_OBSERVED: readonly Case[] = [
  {
    kind: "assemble",
    name: "a stored observed path that is not worktree-relative, left out of the closure",
    why: "011-310 (issue #166): the file keys without the path and its key names it, so it differs from the key over the valid paths and no result stored before the path was observed is current; a tree before 011-310 throws at the closure and stores nothing",
    lastThrows: `expected a worktree-relative path, got "${BAD}"`,
    input: {
      files: {
        "squeal.config.json": `${JSON.stringify({ observe: { runtimeInputs: true } })}\n`,
        "data/x.txt": "x\n",
        [TEST]: "// a\n",
      },
      closures: [{ path: TEST, imports: [] }],
      runtime: { observed: [{ path: TEST, paths: ["data/x.txt", BAD] }] },
    },
  },
];
