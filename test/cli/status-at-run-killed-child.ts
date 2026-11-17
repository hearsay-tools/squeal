import { mkdirSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { statusAtCommand } from "../../src/cli/status-at.js";
import type { AbsolutePath } from "../../src/core/types/common.js";

/*
 * Row 023-07: a `squeal status --at <commit> --run` for
 * `status-at-run-killed.test.ts` to SIGKILL while its gate runs a test that
 * holds. Arguments: the worktree, the commit and the cache root. The
 * checkout's install is the fixtures' link to this repository's Vitest
 * (`at-keys-fixture.ts`, which registers Vitest hooks and so is not
 * imported here).
 */

const VITEST = join(resolve(import.meta.dirname, "../.."), "node_modules/vitest");
const [root, commit, cacheRoot] = process.argv.slice(2) as [AbsolutePath, string, AbsolutePath];
await statusAtCommand(
  { commit, paths: [], json: true, run: { allMissing: false, timeoutSeconds: 600 } },
  { stdout: () => {}, stderr: () => {}, cwd: root },
  {
    cacheRoot,
    install: async (tree) => {
      mkdirSync(join(tree, "node_modules"), { recursive: true });
      symlinkSync(VITEST, join(tree, "node_modules/vitest"));
      return { ok: true, command: "link", ms: 0 };
    },
  },
);
