import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CliIo, main } from "../../src/cli/main.js";
import type { EnsureDaemonOptions } from "../../src/core/daemon/ensure.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import type { AbsolutePath } from "../../src/core/types/index.js";
import type { HookDeps, HookResult } from "../../src/harness/claude-code/index.js";
import { git, tempDir } from "../hash/git-repo.js";
import type { FakeRepo } from "../status/helpers.js";

/*
 * Tasks 011-08 and 011-254: the fixtures of the stopped mark's hook tests.
 */

/**
 * A real git repository with one commit and a linked worktree, as
 * `squealRepo` lays out; `cleanups` removes it.
 */
export function gitRepo(cleanups: (() => void)[]): FakeRepo {
  const dir = tempDir("squeal-stopped-");
  cleanups.push(dir.cleanup);
  const main = join(realpathSync(dir.path), "main");
  mkdirSync(main);
  git(main, ["init", "-q"]);
  writeFileSync(join(main, "a.txt"), "a\n");
  git(main, ["add", "a.txt"]);
  commit(main, "a");
  return {
    commonDir: join(main, ".git"),
    main,
    mainId: worktreeIdFor(main as AbsolutePath),
    addWorktree(name) {
      const root = join(realpathSync(dir.path), name);
      git(main, ["worktree", "add", "-q", root]);
      return { root, id: worktreeIdFor(root as AbsolutePath) };
    },
  };
}

/** `git commit` in `root` with a fixed author. */
export function commit(root: string, message: string): void {
  git(root, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", message]);
}

/**
 * Hook deps whose `ensureDaemon` records each call and answers `spawned`, or
 * `alive` for the daemon a fixture records alive: a hook's spawn writes a
 * spawn mark, which a daemon that serves would have removed at its
 * registration (row 011-251).
 */
export function recording(answer: "spawned" | "alive" = "spawned") {
  const calls: (EnsureDaemonOptions & { root: string })[] = [];
  const deps: HookDeps = {
    env: {},
    cli: "/plugin/dist/cli/squeal.mjs",
    ensureDaemon: async (root, options) => {
      calls.push({ root, ...options });
      return answer;
    },
  };
  return { calls, deps };
}

/** What a Claude Code hook delivered as context; `""` for nothing. */
export const text = (out: HookResult): string =>
  out.stdout === ""
    ? ""
    : (JSON.parse(out.stdout) as { hookSpecificOutput: { additionalContext: string } })
        .hookSpecificOutput.additionalContext;

/** `squeal <argv>` in `cwd`, as an agent's shell runs it outside a harness session. */
export async function cli(argv: string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (out) => {
      stdout += out;
    },
    stderr: (out) => {
      stderr += out;
    },
    cwd,
    env: {},
  };
  const code = await main(argv, io);
  return { code, stdout, stderr };
}
