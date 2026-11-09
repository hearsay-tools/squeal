import type { Case } from "../../case.js";

/*
 * Spec 018 D14 (row 018-20): `shared.ref` decides whether a daemon fetches
 * CI's results, never what a key is, so a repository that sets it keys as
 * one that does not. The values reach each rule of the leaf: a valid prefix,
 * a reserved prefix, a value outside refs/, and a component git refuses.
 */

const TEST = "test/app.test.ts";

const files = (ref: unknown) => ({
  "squeal.config.json": `${JSON.stringify({ shared: { ref } })}\n`,
  "src/app.ts": "export const app = 1;\n",
  [TEST]: "import '../src/app';\n",
});

const closures = [{ path: TEST, imports: ["src/app.ts"] }];

const values: readonly [string, unknown][] = [
  ["a valid prefix", "refs/squeal"],
  ["a reserved prefix", "refs/heads/squeal"],
  ["a value outside refs/", "squeal"],
  ["a component git refuses", "refs/sq..ueal"],
];

export const SHARED_REF: readonly Case[] = values.map(([what, ref]) => ({
  kind: "assemble",
  name: `a repository with shared.ref set to ${what}`,
  why: "018-20: shared.ref only decides a fetch, so the keys equal the last release's, which ignores the key",
  input: { files: files(ref), closures },
}));
