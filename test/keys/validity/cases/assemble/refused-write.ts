import type { Case } from "../../case.js";

/*
 * Row 021-08 (spec 021 D2, repair R2): a busy store refuses the first write
 * of a closure's untracked paths, and they are tracked again. A tree before
 * 021-08 forgot the refused call's paths, so it never hashed them; the
 * candidate hashes, writes and re-keys them on the call after. A path with
 * no file keys as absent either way, so both trees key the file alike.
 */

const TEST = "test/a.test.ts";

export const REFUSED_WRITES: readonly Case[] = [
  {
    kind: "assemble",
    name: "a closure path with no file whose first tracking write a busy store refused",
    why: "021-08 (spec 021 D2): a refused stat-cache write leaves the paths to track again, and the file keys with the missing path as absent, as the last release keys it",
    input: {
      files: { "src/a.ts": "export const a = 1;\n", [TEST]: "import '../src/a';\n" },
      closures: [{ path: TEST, imports: ["src/a.ts", "src/missing.ts"] }],
      refusedWrite: true,
    },
  },
];
