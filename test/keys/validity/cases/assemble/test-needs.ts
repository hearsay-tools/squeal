import type { Case } from "../../case.js";

/*
 * Spec 021 D19 (row 021-23): `requires.commands` and `remote.needsRepository`
 * decide where a test file runs and what status says, never what a key is,
 * so a repository that sets them keys as one that does not. The last
 * release reads both as unknown keys; this tree checks them. The cases reach
 * each rule of the two leaves: good entries, a command given as a path, one
 * that starts with "-", one with a space, a glob that does not compile, and
 * a value that is not a list of strings.
 *
 * Spec 026 D13 (rows 026-35, 026-36): `remote.setup` prepares each remote
 * machine and the object form of `requires.commands` keeps some files here;
 * neither is in a key, so a repository that sets them keys as the last
 * release, which reads `remote.setup` as an unknown key, and an object as a
 * wrong value for `requires.commands`, does.
 */

const TEST = "test/app.test.ts";
const GIT = "test/git.test.ts";

const SETUP = ".squeal/remote-setup.sh";

const files = (requires: unknown, remote: unknown) => ({
  "squeal.config.json": `${JSON.stringify({ requires, remote })}\n`,
  [SETUP]: "#!/bin/sh\napt-get install -y google-chrome-stable\n",
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

const SETUP_WHY =
  "026-35: remote.setup prepares the remote machine and is in no key, so the keys equal the last release's, which reads it as an unknown key";

const setups: readonly [string, unknown][] = [
  ["a script", { setup: SETUP }],
  ["a path that leaves the repository", { setup: "../setup.sh" }],
];

export const TEST_NEEDS: readonly Case[] = [
  ...values.map(
    ([what, requires, remote]): Case => ({
      kind: "assemble",
      name: `a repository whose requires.commands and remote.needsRepository hold ${what}`,
      why: WHY,
      input: { files: files(requires, remote), closures },
    }),
  ),
  ...setups.map(
    ([what, remote]): Case => ({
      kind: "assemble",
      name: `a repository whose remote.setup is ${what}`,
      why: SETUP_WHY,
      input: { files: files({ commands: ["git"] }, remote), closures },
    }),
  ),
];
