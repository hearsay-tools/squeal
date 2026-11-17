import { mkdirSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { proofCommand } from "../../src/cli/proof.js";
import type { AbsolutePath } from "../../src/core/types/common.js";

/*
 * Row 023-08: `squeal proof <file> --base <commit> --json` in a process of
 * its own, for `proof-killed.test.ts` to SIGKILL. Arguments: the worktree,
 * the named test file, the base and the cache root. As
 * `status-at-cli-child.ts`, it does not import the fixture module (it
 * registers Vitest hooks); the install is the fixtures' link.
 */

const REPO = resolve(import.meta.dirname, "../..");
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const [root, file, base, cacheRoot] = process.argv.slice(2) as [
  AbsolutePath,
  string,
  string,
  AbsolutePath,
];
process.exitCode = await proofCommand(
  { files: [file], base, case: null, timeoutSeconds: 600, json: true },
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
