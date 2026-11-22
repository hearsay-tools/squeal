import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { proofCommand } from "../../src/cli/proof.js";
import type { ProofArgs } from "../../src/cli/proof-args.js";
import { realDaemons } from "../../src/cli/status-at-daemons.js";
import { installCommitWorktree } from "../../src/core/checkout/commit-setup.js";
import { COMMIT_WORKTREES } from "../../src/core/daemon/commit-mode.js";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import type { AbsolutePath } from "../../src/core/types/common.js";

/*
 * Row 023-08: `squeal proof <file> --base <commit> --json` in a process of
 * its own, for `proof-killed.test.ts` to SIGKILL. Arguments: the worktree,
 * the named test file, the base, the cache root and (row 023-11) more of
 * its arguments as JSON. As
 * `status-at-cli-child.ts`, it does not import the fixture module (it
 * registers Vitest hooks); the install is the fixtures' link.
 */

const REPO = resolve(import.meta.dirname, "../..");
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;
const [root, file, base, cacheRoot, more] = process.argv.slice(2) as [
  AbsolutePath,
  string,
  string,
  AbsolutePath,
  string | undefined,
];
// Row 023-11: more of `ProofArgs` (conditions, case, repeat), as JSON.
const extra = more === undefined ? {} : (JSON.parse(more) as Partial<ProofArgs>);
// The fixtures' link install, for the red side's checkout and the commit daemon's worktree.
const link = async (tree: AbsolutePath) => {
  mkdirSync(join(tree, "node_modules"), { recursive: true });
  symlinkSync(join(REPO, "node_modules/vitest"), join(tree, "node_modules/vitest"));
  return { ok: true as const, command: "link", ms: 0 };
};
// Row 023-42 (D7.6): the green side's commit daemon, in this process, as
// `inProcessCommitDaemons` starts one (that module registers Vitest hooks); it dies with it.
const runtime = realpathSync(mkdtempSync(join(tmpdir(), "sq-proof-child-")));
const daemonEnv: NodeJS.ProcessEnv = {
  XDG_RUNTIME_DIR: runtime,
  XDG_CONFIG_HOME: join(runtime, "config"),
};
for (const [name, value] of Object.entries(process.env))
  if (!/^(VITEST|GIT_|XDG_RUNTIME_DIR$|XDG_CONFIG_HOME$)/.test(name) && name !== "NODE_OPTIONS")
    daemonEnv[name] ??= value;
const daemons = realDaemons({
  start: async (tree) => {
    const daemon = await startDaemon({
      root: tree,
      env: daemonEnv,
      commitWorktrees: {
        ...COMMIT_WORKTREES,
        install: (at: AbsolutePath) => installCommitWorktree(at, { install: link }),
      },
    });
    if ("reason" in daemon) return daemon.message;
    let exited = false;
    void daemon.exited.then(() => {
      exited = true;
    });
    return { lives: async () => !exited };
  },
});
process.exitCode = await proofCommand(
  { files: [file], base, case: null, timeoutSeconds: 600, json: true, ...extra },
  {
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    cwd: root,
    relaunch: [process.execPath, "--import", TSX, join(REPO, "src/cli/index.ts")],
  },
  { cacheRoot, install: link, daemons },
);
