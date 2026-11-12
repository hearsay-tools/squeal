import { realpathSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { daemonScratch } from "../../src/core/daemon/scratch.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import type { PingResponse } from "../../src/core/types/daemon.js";
import { git } from "../hash/git-repo.js";
import {
  createFixtureRepo,
  diagnose,
  type FixtureRepo,
  ping,
  readNotes,
  SLOW,
  type SpawnedProcess,
  spawnCli,
  stopProcess,
  suiteCli,
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
 *
 * Row 018-41: a re-clone in place moves the old daemon's store aside with its
 * `.git`, so the old daemon stops by itself at its next heartbeat (row
 * 011-226), within 5 s. The test pauses it until the newcomer answers, so its
 * exit comes after the newcomer bound the socket however slow the start is.
 */

/** The old daemon's stop note when its store moved aside (`storeCondemned`). */
const STORE_MOVED = /^daemon stopped: the store file it opened was moved aside/;

const processes: SpawnedProcess[] = [];
const cleanups: (() => void)[] = [];
// Each stop may wait up to 60 s for a daemon's shutdown (task 001-385).
afterEach(async () => {
  for (const process of processes.splice(0)) await stopProcess(process);
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
}, SLOW.timeout);

function fixture(): FixtureRepo {
  const repo = createFixtureRepo();
  cleanups.push(repo.cleanup);
  return repo;
}

/** Moves `root` aside and `replacement` into its place; returns where `root` went. */
function swap(root: string, replacement: string): string {
  const aside = `${root}.gone`;
  renameSync(root, aside);
  renameSync(replacement, root);
  cleanups.push(() => rmSync(aside, { recursive: true, force: true }));
  return aside;
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

/** Waits for `old` to exit, then checks that `newcomer` still answers on the shared socket. */
async function handedOver(
  repo: FixtureRepo,
  old: SpawnedProcess,
  newcomer: SpawnedProcess,
): Promise<void> {
  expect(await exitWithin(old, 30_000)).toEqual({ code: 0, signal: null });
  const answer = await ping(repo.socketPath, 1_000);
  expect(answer?.pid).toBe(newcomer.child.pid);
  expect(answer?.phase).toBe("ready");
}

describe.runIf(process.platform === "linux")(
  "squeal daemon: a socket handed over at one path (spec 001 D10)",
  SLOW,
  () => {
    const built = suiteCli();

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
      const old = start(built().cli, oldRepo);
      await answering(oldRepo, old);

      const staged = join(b.root, "..", "staged");
      git(b.root, ["worktree", "add", "-q", "--detach", staged]);
      swap(root, realpathSync(staged));
      git(b.root, ["worktree", "repair", root]);
      // The same runtime dir and root, so the same socket path.
      const newRepo: FixtureRepo = { ...oldRepo, commonDir: b.commonDir };
      const newcomer = start(built().cli, newRepo);
      await answering(newRepo, newcomer);

      expect(old.child.exitCode).toBeNull();
      old.child.kill("SIGTERM");
      await handedOver(newRepo, old, newcomer);
    });

    it("keeps the new clone's daemon answering after the old daemon exits, when the repository was cloned again in place", async () => {
      const repo = fixture();
      const source = join(repo.root, "..", "source.git");
      git(repo.root, ["clone", "-q", "--bare", repo.root, source]);
      const old = start(built().cli, repo);
      await answering(repo, old);

      const clone = join(repo.root, "..", "clone");
      git(repo.root, ["clone", "-q", source, clone]);
      old.child.kill("SIGSTOP");
      const aside = swap(repo.root, clone);
      const newcomer = start(built().cli, repo);
      await answering(repo, newcomer);
      expect(old.child.exitCode).toBeNull();

      // Resumed, the old daemon's overdue heartbeat finds its store gone from its path.
      old.child.kill("SIGCONT");
      await handedOver(repo, old, newcomer);
      const notes = readNotes({ commonDir: join(aside, ".git"), worktreeId: repo.worktreeId });
      expect(notes.filter((text) => text.startsWith("daemon stopped:"))).toEqual([
        expect.stringMatching(STORE_MOVED),
      ]);
    });
  },
);
