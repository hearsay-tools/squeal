import type { Case } from "../../case.js";

/*
 * Spec 021 D19 (row 021-23): `requires.commands` and `remote.needsRepository`
 * decide where a test file runs and what status says, never what a key is,
 * so a repository that sets them keys as one that does not. The last
 * release reads both as unknown keys; this tree checks them. The cases reach
 * each rule of the two leaves: good entries, a command given as a path, one
 * that starts with "-", one with a space, a glob that does not compile, and
 * a value that is not a list of strings.
 */

const TEST = "test/app.test.ts";
const GIT = "test/git.test.ts";

const files = (requires: unknown, remote: unknown) => ({
  "squeal.config.json": `${JSON.stringify({ requires, remote })}\n`,
  "src/app.ts": "export const app = 1;\n",
  [TEST]: "import '../src/app';\n",
  [GIT]: "import '../src/app';\n",
});

const closures = [
  { path: TEST, imports: ["src/app.ts"] },
  { path: GIT, imports: ["src/app.ts"] },
];

const WHY =
  "021-23: where a file runs and what status says are in no key, so the keys equal the last release's, which reads requires and remote.needsRepository as unknown keys";

const values: readonly [string, unknown, unknown][] = [
  [
    "command names and test-file globs",
    { commands: ["git", "python3"] },
    { allowed: true, needsRepository: [GIT, "test/git/**"] },
  ],
  [
    "a path, an option, a space and a glob that does not compile among them",
    { commands: ["git", "/usr/bin/python3", "-v", "two words"] },
    { needsRepository: [GIT, "!test/app.test.ts"] },
  ],
  ["values that are not lists of strings", { commands: "git" }, { needsRepository: [1] }],
];

export const TEST_NEEDS: readonly Case[] = values.map(([what, requires, remote]) => ({
  kind: "assemble",
  name: `a repository whose requires.commands and remote.needsRepository hold ${what}`,
  why: WHY,
  input: { files: files(requires, remote), closures },
}));
