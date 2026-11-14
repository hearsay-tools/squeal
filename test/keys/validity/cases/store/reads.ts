import type { Case } from "../../case.js";

/*
 * Row 011-321 (review 0.1.453-r2 N1): what a run read beyond its keys, then
 * changed or touched during it, as the daemon's record checks it
 * (`observedMoves`, row 011-319) and decides each file on it
 * (`recordOutcome`, `runEnd`, `decisionOf`).
 */

const grew = (path: string, read: string) => ({ path, growth: { growth: [read] } });

export const STORE_READS: readonly Case[] = [
  {
    kind: "store",
    name: "observed reads that changed or were touched during the run",
    why: "001-132, 001-168, 011-319: a read whose bytes changed leaves its file unstable; a touched read withholds its file, which runs once more; a read that held still joins the key it is stored at",
    input: {
      files: [
        grew("test/changed.test.ts", "data/changed.txt"),
        grew("test/touched.test.ts", "data/touched.txt"),
        grew("test/still.test.ts", "data/still.txt"),
      ],
      completed: ["test/changed.test.ts", "test/touched.test.ts", "test/still.test.ts"],
      reads: { changed: ["data/changed.txt"], touched: ["data/touched.txt"] },
    },
  },
];
