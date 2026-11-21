import { mkdirSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { commitRun } from "../../src/cli/status-at-commit-run.js";
import { resolveCommit } from "../../src/core/commit/at-keys-checkout.js";
import { resolveCommonDir, worktreeIdFor } from "../../src/core/fs/git-layout.js";
import type { AbsolutePath } from "../../src/core/types/common.js";

/*
 * Row 023-07: the in-call run of `status --at <commit> --run` (row 023-40
 * left it to `commitRun` until row 023-41 removes it) in a process of its
 * own, its commit side as JSON on stdout, for `status-at-run-killed.test.ts` to
 * SIGKILL and for `status-at-run-env.test.ts` to start with the
 * environment a shell gives (review wave-7 B1 and B3). Arguments: the
 * worktree, the commit and the cache root. The checkout's install is the
 * fixtures' link to this repository's Vitest (`at-keys-fixture.ts`, which
 * registers Vitest hooks and so is not imported here); the run's child is
 * this repository's CLI from source through tsx, as the kit's `RELAUNCH`.
 */

const REPO = resolve(import.meta.dirname, "../..");
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const [root, commit, cacheRoot] = process.argv.slice(2) as [AbsolutePath, string, AbsolutePath];
const commonDir = resolveCommonDir(root) as AbsolutePath;
const side = await commitRun({
  root,
  commonDir,
  worktreeId: worktreeIdFor(root),
  commit: await resolveCommit(root, commit),
  given: commit,
  givenPaths: [],
  paths: null,
  run: { allMissing: false, timeoutSeconds: 600 },
  env: { ...process.env },
  relaunch: [process.execPath, "--import", TSX, join(REPO, "src/cli/index.ts")],
  note: (text) => process.stderr.write(`squeal: ${text}\n`),
  forward: (text) => process.stderr.write(text),
  options: {
    cacheRoot,
    install: async (tree) => {
      mkdirSync(join(tree, "node_modules"), { recursive: true });
      symlinkSync(join(REPO, "node_modules/vitest"), join(tree, "node_modules/vitest"));
      return { ok: true, command: "link", ms: 0 };
    },
  },
});
const files = side.at.refs.map((ref) => ({ ...ref, at: side.state(ref) }));
process.stdout.write(
  `${JSON.stringify({ files, run: side.ran?.use() ?? null, failure: side.at.failure })}\n`,
);
