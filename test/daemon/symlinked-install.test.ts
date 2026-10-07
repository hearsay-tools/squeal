import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { readHeader } from "../../src/core/delivery/index.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { git } from "../hash/git-repo.js";
import {
  childEnv,
  daemonSuite,
  type FixtureRepo,
  ping,
  readNotes,
  SLOW,
  waitFor,
  waitReady,
  withStore,
} from "./helpers.js";

/*
 * Lessons, defect 21 (task 001-111): a worktree whose `node_modules` is a
 * symlink, as worktrees sharing one install have, starts a daemon that stays
 * up. `git check-ignore` refused every batch naming the installed lockfile
 * beyond the link, and the daemon exited at start.
 */
const repoRoot = resolve(import.meta.dirname, "../..");
const LOCKFILE = "node_modules/.package-lock.json";
const MANIFEST = JSON.stringify({ type: "module", devDependencies: { vitest: "*" } });

/** The scheduler fixture under /tmp, its `node_modules` a link to a sibling holding the install. */
function linkedInstallWorktree(): FixtureRepo {
  const dir = realpathSync(mkdtempSync("/tmp/sq-linked-"));
  const main = join(dir, "main");
  cpSync(join(repoRoot, "test/fixtures/scheduler/basic"), main, { recursive: true });
  renameSync(join(main, "_gitignore"), join(main, ".gitignore"));
  writeFileSync(join(main, "package.json"), MANIFEST);
  git(main, ["init", "-q", "-b", "main"]);
  git(main, ["add", "-A"]);
  git(main, ["commit", "-qm", "fixture"]);

  const shared = join(dir, "shared/node_modules");
  mkdirSync(shared, { recursive: true });
  symlinkSync(join(repoRoot, "node_modules/vitest"), join(shared, "vitest"));
  writeFileSync(
    join(shared, ".package-lock.json"),
    JSON.stringify({
      packages: {
        "node_modules/vitest": { link: true, resolved: join(repoRoot, "node_modules/vitest") },
      },
    }),
  );
  symlinkSync("../shared/node_modules", join(main, "node_modules"));

  const worktreeId = worktreeIdFor(main);
  const runtimeDir = realpathSync(mkdtempSync("/tmp/sq-"));
  return {
    root: main,
    commonDir: join(main, ".git"),
    worktreeId,
    runtimeDir,
    socketPath: socketPathFor(worktreeId, { XDG_RUNTIME_DIR: runtimeDir }),
    env: childEnv(runtimeDir),
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
      rmSync(runtimeDir, { recursive: true, force: true });
    },
  };
}

describe(
  "squeal daemon in a worktree whose node_modules is a symlink (D2, defect 21)",
  SLOW,
  () => {
    const suite = daemonSuite();

    it("stays up, reads the installed lockfile through the link, lists and runs the tests", async () => {
      const repo = linkedInstallWorktree();
      suite.cleanup(repo.cleanup);
      const spawned = suite.daemon(repo);
      await waitReady(repo, spawned);

      const header = await waitFor(
        () =>
          withStore(repo, (store) => {
            const read = readHeader(store, repo.worktreeId);
            return read.counts.current >= 5 && read.counts.pending === 0 ? read : null;
          }),
        90_000,
        "baseline",
      );
      // Without the lockfile the worktree would await an install (D5) and list nothing.
      expect(header.awaitingInstall).toBeUndefined();
      expect(header.testFilesListed).toBe(true);
      const lockfileHash = () =>
        withStore(repo, (store) => store.fileHashes.get(repo.worktreeId, LOCKFILE)?.hash ?? null);
      const installed = lockfileHash();
      expect(installed).not.toBe(null);
      expect(readNotes(repo).filter((text) => /check-ignore|symbolic link/.test(text))).toEqual([]);
      expect(spawned.child.exitCode).toBe(null);
      expect((await ping(repo.socketPath, 2_000))?.phase).toBe("ready");

      // A path beyond the link is an extra file (D2): a reinstall through it is seen.
      appendFileSync(join(repo.root, LOCKFILE), "\n");
      await waitFor(() => lockfileHash() !== installed, 30_000, "the lockfile rehashed");
    });
  },
);
