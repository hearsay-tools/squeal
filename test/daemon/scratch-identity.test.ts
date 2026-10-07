import { existsSync, mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { daemonScratch } from "../../src/core/daemon/scratch.js";
import { worktreeIdFor } from "../../src/core/store/index.js";
import { git } from "../hash/git-repo.js";
import {
  type BuiltCli,
  buildCli,
  createFixtureRepo,
  type FixtureRepo,
  SLOW,
  type SpawnedProcess,
  spawnCli,
  stopProcess,
  waitFor,
  waitReady,
  withStore,
} from "./helpers.js";
import { exitWithin, resultOf, TMP_TEST } from "./scratch-helpers.js";

/*
 * Review wave 7.7, B1, and research `daemon-under-harnesses.md` on a re-clone
 * in place: a daemon's temp directory is keyed by its repository's stored id
 * and its root, so a daemon whose root path another repository, or a fresh
 * clone, took over while it still runs never empties or removes the newcomer's.
 * The path changes hands by two renames, so the old daemon cannot exit first.
 */

const processes: SpawnedProcess[] = [];
const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const process of processes.splice(0)) await stopProcess(process);
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

const FILES = { "test/tmp.test.ts": TMP_TEST };

function fixture(): FixtureRepo {
  const repo = createFixtureRepo({ files: FILES });
  cleanups.push(repo.cleanup);
  return repo;
}

/** `repo`'s view of a worktree at `root`, with its own runtime dir so the two daemons' sockets never meet. */
function at(repo: FixtureRepo, root: string): FixtureRepo {
  const worktreeId = worktreeIdFor(root);
  return {
    ...repo,
    root,
    worktreeId,
    socketPath: join(repo.runtimeDir, `squeal-${worktreeId}.sock`),
  };
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
  const spawned = spawnCli(cli, ["daemon", repo.root], { cwd: "/", env: repo.env });
  processes.push(spawned);
  return spawned;
}

describe.runIf(process.platform === "linux")(
  "squeal daemon: a temp directory no other repository's daemon touches (spec 001 D10)",
  SLOW,
  () => {
    let built: BuiltCli;
    beforeAll(() => {
      built = buildCli();
    });
    afterAll(() => built.cleanup());

    it("keeps both temp directories when another repository's worktree takes the path, and the newcomer's tests still pass after the old daemon exits", async () => {
      const a = fixture();
      const b = fixture();
      const path = join(a.root, "..", "shared");
      git(a.root, ["worktree", "add", "-q", "--detach", path]);
      const root = realpathSync(path);
      const oldRepo = at(a, root);
      const old = start(built.cli, oldRepo);
      await waitReady(oldRepo, old);
      const oldTemp = daemonScratch(a.commonDir, root).tempDir;
      writeFileSync(join(oldTemp, "old-marker"), "");

      const staged = join(b.root, "..", "staged");
      git(b.root, ["worktree", "add", "-q", "--detach", staged]);
      swap(root, realpathSync(staged));
      git(b.root, ["worktree", "repair", root]);
      const newRepo = at(b, root);
      const newcomer = start(built.cli, newRepo);
      await waitReady(newRepo, newcomer);
      const newTemp = daemonScratch(b.commonDir, root).tempDir;
      cleanups.push(() => rmSync(newTemp, { recursive: true, force: true }));
      const baseline = await resultOf(newRepo, newcomer, "test/tmp.test.ts");

      expect(old.child.exitCode).toBeNull();
      expect(existsSync(join(oldTemp, "old-marker"))).toBe(true);
      writeFileSync(join(newTemp, "new-marker"), "");
      old.child.kill("SIGTERM");
      expect(await exitWithin(old, 30_000)).toEqual({ code: 0, signal: null });
      expect(existsSync(join(newTemp, "new-marker"))).toBe(true);
      expect(existsSync(oldTemp)).toBe(false);

      // Review wave 7.7, B1: the newcomer's `mkdtemp(os.tmpdir())` failed here.
      writeFileSync(join(root, "test/tmp.test.ts"), `${TMP_TEST}// edited\n`);
      const rerun = await waitFor(
        () =>
          withStore(newRepo, (store) =>
            store.knownStates
              .list(newRepo.worktreeId)
              .find(
                (s) =>
                  s.check.kind === "test" &&
                  s.check.testPath === "test/tmp.test.ts" &&
                  s.outcome !== "unknown" &&
                  (s.observedAt ?? 0) > (baseline.observedAt ?? 0),
              ),
          ),
        120_000,
        "a re-run of test/tmp.test.ts",
      );
      expect(rerun.outcome).toBe("pass");
      expect(newTemp).not.toBe(oldTemp);
    });

    it("keeps the new clone's temp directory when the repository is cloned again in place while the old daemon runs", async () => {
      const repo = fixture();
      const source = join(repo.root, "..", "source.git");
      git(repo.root, ["clone", "-q", "--bare", repo.root, source]);
      const old = start(built.cli, repo);
      await waitReady(repo, old);
      const oldTemp = daemonScratch(repo.commonDir, repo.root).tempDir;
      writeFileSync(join(oldTemp, "old-marker"), "");

      const clone = join(repo.root, "..", "clone");
      git(repo.root, ["clone", "-q", source, clone]);
      swap(repo.root, clone);
      const runtimeDir = join(repo.runtimeDir, "new");
      mkdirSync(runtimeDir, { mode: 0o700 });
      const cloned = {
        ...repo,
        env: { ...repo.env, XDG_RUNTIME_DIR: runtimeDir },
        socketPath: join(runtimeDir, `squeal-${repo.worktreeId}.sock`),
      };
      const newcomer = start(built.cli, cloned);
      await waitReady(cloned, newcomer);
      const newTemp = daemonScratch(repo.commonDir, repo.root).tempDir;
      cleanups.push(() => rmSync(newTemp, { recursive: true, force: true }));

      expect(old.child.exitCode).toBeNull();
      expect(existsSync(join(oldTemp, "old-marker"))).toBe(true);
      writeFileSync(join(newTemp, "new-marker"), "");
      old.child.kill("SIGTERM");
      expect(await exitWithin(old, 30_000)).toEqual({ code: 0, signal: null });
      expect(existsSync(join(newTemp, "new-marker"))).toBe(true);
      expect(existsSync(oldTemp)).toBe(false);
      expect(newTemp).not.toBe(oldTemp);
    });
  },
);
