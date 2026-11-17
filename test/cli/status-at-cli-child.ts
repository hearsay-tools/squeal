import { mkdirSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { statusAtCommand } from "../../src/cli/status-at.js";
import type { AbsolutePath } from "../../src/core/types/common.js";

/*
 * Row 023-07: `squeal status --at <commit> --run --json` in a process of
 * its own, its report on stdout, for `status-at-run-killed.test.ts` to
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
process.exitCode = await statusAtCommand(
  { commit, paths: [], json: true, run: { allMissing: false, timeoutSeconds: 600 } },
  {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    cwd: root,
    relaunch: [process.execPath, "--import", TSX, join(REPO, "src/cli/index.ts")],
  },
  {
    cacheRoot,
    install: async (tree) => {
      mkdirSync(join(tree, "node_modules"), { recursive: true });
      symlinkSync(join(REPO, "node_modules/vitest"), join(tree, "node_modules/vitest"));
      return { ok: true, command: "link", ms: 0 };
    },
  },
);
