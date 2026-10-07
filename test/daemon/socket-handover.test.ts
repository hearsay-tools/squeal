import { realpathSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { daemonScratch } from "../../src/core/daemon/scratch.js";
import { worktreeIdFor } from "../../src/core/store/index.js";
import type { PingResponse } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import {
  type BuiltCli,
  buildCli,
  createFixtureRepo,
  diagnose,
  type FixtureRepo,
  ping,
  SLOW,
  type SpawnedProcess,
  spawnCli,
  stopProcess,
  waitFor,
} from "./helpers.js";
import { exitWithin } from "./scratch-helpers.js";

/*
 * Board row 001-77, found by 001-65: a socket path is keyed by the root path
 * alone, so when another repository's worktree takes a path, or a repository
 * is cloned again in place, the newcomer's daemon binds where the old one
 * still listens. The old daemon's exit must leave the newcomer answering
 * (spec 001 D10). The scenarios are those of `scratch-identity.test.ts`, with
 * both daemons in one runtime dir so their sockets meet.
 */

const processes: SpawnedProcess[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const process of processes.splice(0)) await stopProcess(process);
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function fixture(): FixtureRepo {
  const repo = createFixtureRepo();
  cleanups.push(repo.cleanup);
  return repo;
}

/** Moves `root` aside and `replacement` into its place. */
function swap(root: string, replacement: string): void {
  const aside = `${root}.gone`;
  renameSync(root, aside);
  renameSync(replacement, root);
  cleanups.push(() => rmSync(aside, { recursive: true, force: true }));
}

function start(cli: string, repo: FixtureRepo): SpawnedProcess {
  const tempDir = daemonScratch(repo.commonDir, repo.root).tempDir;
  cleanups.push(() => rmSync(tempDir, { recursive: true, force: true }));
  const spawned = spawnCli(cli, ["daemon", repo.root], { cwd: "/", env: repo.env });
  processes.push(spawned);
  return spawned;
}

/** Waits until `spawned` itself answers ready on `repo`'s socket. */
function answering(repo: FixtureRepo, spawned: SpawnedProcess): Promise<PingResponse> {
  return waitFor(
    async () => {
      const answer = await ping(repo.socketPath, 500);
      return answer?.pid === spawned.child.pid && answer?.phase === "ready" ? answer : null;
    },
    60_000,
    `daemon ${spawned.child.pid} ready`,
  ).catch((error: Error) => {
    throw new Error(`${error.message}\n${diagnose(repo, spawned)}`);
  });
}

/** Stops `old`, then checks that `newcomer` still answers on the shared socket. */
async function handOver(
  repo: FixtureRepo,
  old: SpawnedProcess,
  newcomer: SpawnedProcess,
): Promise<void> {
  expect(old.child.exitCode).toBeNull();
  old.child.kill("SIGTERM");
  expect(await exitWithin(old, 30_000)).toEqual({ code: 0, signal: null });
  const answer = await ping(repo.socketPath, 1_000);
  expect(answer?.pid).toBe(newcomer.child.pid);
  expect(answer?.phase).toBe("ready");
}

describe.runIf(process.platform === "linux")(
  "squeal daemon: a socket handed over at one path (spec 001 D10)",
  SLOW,
  () => {
    let built: BuiltCli;
    beforeAll(() => {
      built = buildCli();
    });
    afterAll(() => built.cleanup());

    it("keeps the newcomer answering after the old daemon exits, when another repository's worktree took the path", async () => {
      const a = fixture();
      const b = fixture();
      const path = join(a.root, "..", "shared");
      git(a.root, ["worktree", "add", "-q", "--detach", path]);
      const root = realpathSync(path);
      const oldRepo: FixtureRepo = {
        ...a,
        root,
        worktreeId: worktreeIdFor(root),
        socketPath: join(a.runtimeDir, `squeal-${worktreeIdFor(root)}.sock`),
      };
      const old = start(built.cli, oldRepo);
      await answering(oldRepo, old);

      const staged = join(b.root, "..", "staged");
      git(b.root, ["worktree", "add", "-q", "--detach", staged]);
      swap(root, realpathSync(staged));
      git(b.root, ["worktree", "repair", root]);
      // The same runtime dir and root, so the same socket path.
      const newRepo: FixtureRepo = { ...oldRepo, commonDir: b.commonDir };
      const newcomer = start(built.cli, newRepo);
      await answering(newRepo, newcomer);

      await handOver(newRepo, old, newcomer);
    });

    it("keeps the new clone's daemon answering after the old daemon exits, when the repository was cloned again in place", async () => {
      const repo = fixture();
      const source = join(repo.root, "..", "source.git");
      git(repo.root, ["clone", "-q", "--bare", repo.root, source]);
      const old = start(built.cli, repo);
      await answering(repo, old);

      const clone = join(repo.root, "..", "clone");
      git(repo.root, ["clone", "-q", source, clone]);
      swap(repo.root, clone);
      const newcomer = start(built.cli, repo);
      await answering(repo, newcomer);

      await handOver(repo, old, newcomer);
    });
  },
);
