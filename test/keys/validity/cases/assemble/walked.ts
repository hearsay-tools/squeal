import type { Case } from "../../case.js";

/*
 * Row 021-28 (spec 021 D21.1): a worktree keeps each runner closure without
 * its `imports`, the import edges the runner walked (015 D11). These cases
 * prove that dropping them moves no key: the last release keeps the closure
 * with its `imports`, this tree drops them, and each test file's closure and
 * key are equal at both trees. One walk is a test file's own; the other two
 * share an entry, as closures of one run do.
 */

const A = "test/a.test.ts";
const B = "test/b.test.ts";

const FILES = {
  "src/app.ts": "import './util';\nexport const app = () => import('./lazy');\n",
  "src/util.ts": "export const util = 1;\n",
  "src/lazy.ts": "export const lazy = 1;\n",
  [A]: "import '../src/app';\n",
  [B]: "import '../src/util';\n",
};

const APP = { path: "src/app.ts", sha1: "a1", static: ["src/util.ts"], dynamic: ["src/lazy.ts"] };
const UTIL = { path: "src/util.ts", sha1: "u1", static: [], dynamic: [] };
const LAZY = { path: "src/lazy.ts", sha1: "l1", static: [], dynamic: [] };

const A_CLOSURE = {
  path: A,
  imports: ["src/app.ts", "src/util.ts", "src/lazy.ts"],
  walk: [{ path: A, sha1: "ta", static: ["src/app.ts"], dynamic: [] }, APP, UTIL, LAZY],
};

export const WALKED: readonly Case[] = [
  {
    kind: "assemble",
    name: "a runner closure with the import edges it walked",
    why: "021-28 (021 D21.1): no key reads a closure's `imports`, so the keys equal the last release's, which kept them",
    input: { files: FILES, closures: [A_CLOSURE] },
  },
  {
    kind: "assemble",
    name: "two runner closures that share a walked entry",
    why: "021-28 (021 D21.1): closures of one run share entries of `imports`; dropping them moves neither file's key",
    input: {
      files: FILES,
      closures: [
        A_CLOSURE,
        {
          path: B,
          imports: ["src/util.ts"],
          walk: [{ path: B, sha1: "tb", static: ["src/util.ts"], dynamic: [] }, UTIL],
        },
      ],
    },
  },
];
