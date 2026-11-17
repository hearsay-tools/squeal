import { writeFileSync } from "node:fs";
import { daemonAdapters } from "../../src/cli/code-gate-stored.js";
import { keysAtCommit } from "../../src/core/commit/at-keys.js";
import { squealVersion } from "../../src/core/daemon/version.js";
import type { AbsolutePath } from "../../src/core/types/common.js";

/*
 * Row 023-16: a run of `keysAtCommit` that stops inside its checkout's
 * install, for `at-keys-killed.test.ts` to SIGKILL. Arguments: the
 * worktree, the commit, the cache root, the file it writes when the
 * checkout exists, and the test file to key.
 */

const [root, commit, cacheRoot, made, path] = process.argv.slice(2) as [
  AbsolutePath,
  string,
  AbsolutePath,
  string,
  string,
];
await keysAtCommit({
  root,
  commit,
  cacheRoot,
  files: [{ project: "", path }],
  adapters: daemonAdapters,
  squealVersion: squealVersion(),
  env: process.env,
  install: async (tree) => {
    writeFileSync(made, tree);
    return new Promise(() => {});
  },
});
