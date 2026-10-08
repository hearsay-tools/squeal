import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterEach } from "vitest";
import { requestDaemon } from "../../src/core/daemon/client.js";
import { ensureDaemon } from "../../src/core/daemon/ensure.js";
import { squealVersion } from "../../src/core/daemon/version.js";
import type { EnsureDaemonResult } from "../../src/core/types/index.js";
import { type HookDeps, runHook } from "../../src/harness/claude-code/index.js";
import { recorded } from "../harness/helpers.js";
import {
  type DaemonSuite,
  delay,
  diagnose,
  type FixtureRepo,
  ping,
  type SpawnedProcess,
  spawnCli,
  stopProcess,
  waitFor,
} from "./helpers.js";

/*
 * Daemons of other versions and the hooks that step them down (lessons,
 * defect 26; task 001-130), for `step-down` and `handover`. Hooks run in
 * this process at the sources' version (`package.json`); released bundles
 * come from the commits that built them.
 */

const repoRoot = resolve(import.meta.dirname, "../..");

/** Registers its own `afterEach`: stops the daemons it started and the detached ones in `sockets`. */
export function stepDownKit(suite: DaemonSuite) {
  const spawned: SpawnedProcess[] = [];
  /** Sockets of detached daemons a hook spawned, stopped over their socket. */
  const sockets: string[] = [];
  afterEach(async () => {
    for (const socketPath of sockets.splice(0)) await stopDetached(socketPath);
    for (const process of spawned.splice(0)) await stopProcess(process);
  });

  /** Under `node_modules/.cache`, so a CLI there resolves `vitest` and `chokidar`. */
  function cacheDir(): string {
    const dir = join(repoRoot, "node_modules/.cache/squeal-test", randomUUID());
    mkdirSync(dir, { recursive: true });
    suite.cleanup(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
  }

  return {
    HOOKS: squealVersion(),
    /** False in a clone without the commit, such as a shallow one. */
    hasCommit(commit: string): boolean {
      try {
        execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], {
          cwd: repoRoot,
          stdio: "ignore",
        });
        return true;
      } catch {
        return false;
      }
    },
    /** The suite's build with `package.json` at `version`, so its daemon reports that version. */
    buildAt(version: string): string {
      const dir = cacheDir();
      cpSync(dirname(dirname(suite.cli)), join(dir, "dist"), { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "squeal", version }));
      return join(dir, "dist/cli/index.js");
    },
    /** The Claude Code plugin's CLI bundle as released at `commit`. */
    releasedCli(commit: string): string {
      return join(releasedDist(commit), "cli/squeal.mjs");
    },
    /** The Claude Code plugin's `dist` as released at `commit`: its hook bundles and CLI. */
    releasedDist,
    start(cli: string, repo: FixtureRepo, args: readonly string[] = []): SpawnedProcess {
      const process = spawnCli(cli, ["daemon", repo.root, ...args], {
        cwd: repo.root,
        env: repo.env,
      });
      spawned.push(process);
      return process;
    },
    sockets,
    /**
     * Hook dependencies with the real `ensureDaemon`, spawning the suite's
     * current CLI in the fixture's environment, each result recorded.
     */
    hookDeps(repo: FixtureRepo, ensured: EnsureDaemonResult[]): HookDeps {
      return {
        env: repo.env,
        harnessProcess: () => null,
        ensureDaemon: async (root, options) => {
          // The spawn inherits `process.env`: the fixture's, not this test runner's.
          const saved = process.env;
          process.env = repo.env;
          try {
            const result = await ensureDaemon(root, { ...options, cli: suite.cli, env: repo.env });
            ensured.push(result);
            return result;
          } finally {
            process.env = saved;
          }
        },
      };
    },
    /** Runs hook `name` of this process for `sessionId`; how long it took. */
    async hook(name: string, repo: FixtureRepo, deps: HookDeps, sessionId = "s1"): Promise<number> {
      const at = performance.now();
      await runHook(name as never, recorded(name, repo.root, { session_id: sessionId }), deps);
      return performance.now() - at;
    },
    async exitWithin(process: SpawnedProcess, ms: number, repo: FixtureRepo) {
      const exit = await Promise.race([process.exited, delay(ms).then(() => null)]);
      if (exit === null)
        throw new Error(`still running after ${ms} ms\n${diagnose(repo, process)}`);
      return exit;
    },
  };

  function releasedDist(commit: string): string {
    const dir = cacheDir();
    const archive = execFileSync("git", ["archive", commit, "plugins/claude-code/dist"], {
      cwd: repoRoot,
      maxBuffer: 64 * 1024 * 1024,
    });
    execFileSync("tar", ["-x", "-C", dir], { input: archive });
    return join(dir, "plugins/claude-code/dist");
  }
}

async function stopDetached(socketPath: string): Promise<void> {
  const answer = await ping(socketPath, 500);
  if (answer === null) return;
  await requestDaemon(socketPath, { type: "stop" }, 1_000).catch(() => null);
  await waitFor(() => !alive(answer.pid), 60_000, "the spawned daemon gone").catch(() =>
    process.kill(answer.pid, "SIGKILL"),
  );
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
