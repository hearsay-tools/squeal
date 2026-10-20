import type { Case } from "../../case.js";

/* 12->13 case 6 (011-37 section 4): a slow file whose artifact glob matches no file, inherited (004-81). */

const path = "test/slow/app.test.ts";

export const SLOW_INHERIT: readonly Case[] = [
  {
    kind: "accept",
    name: "a slow file with no artifact, from another worktree",
    why: "12->13 case 6 (004-81): 12 refused it, 13 inherits it over either store",
    input: {
      testFile: { project: "", path },
      runs: [
        {
          worktree: "A",
          report: {
            results: [
              {
                check: { kind: "test", project: "", testPath: path, fullName: "builds" },
                outcome: "pass",
                durationMs: 900,
                location: null,
                errors: [],
              },
            ],
          },
          recordedAt: 1_000,
        },
      ],
      receiver: "B",
      policy: { slow: { include: ["test/slow/**"] }, inputs: { [path]: ["dist/**"] } },
      declared: [],
    },
  },
];
