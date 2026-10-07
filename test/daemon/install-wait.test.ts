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
  readNotes,
  SLOW,
  waitFor,
  waitReady,
  withStore,
} from "./helpers.js";

/*
 * Lessons, defect 18, at the daemon's start path (task 001-100): a worktree
 * whose root declares dependencies and has no installed lockfile gets no
 * Vitest instance, no listing and no run; the install starts validation,
 * with Vitest imported from the worktree's own `node_modules`.
 */
const repoRoot = resolve(import.meta.dirname, "../..");
const MANIFEST = JSON.stringify({ type: "module", devDependencies: { vitest: "*" } });

/** The scheduler fixture, committed under /tmp, where `vitest` does not resolve until an install. */
function freshWorktree(): FixtureRepo {
  const dir = realpathSync(mkdtempSync("/tmp/sq-fresh-"));
  const main = join(dir, "main");
  cpSync(join(repoRoot, "test/fixtures/scheduler/basic"), main, { recursive: true });
  renameSync(join(main, "_gitignore"), join(main, ".gitignore"));
  writeFileSync(join(main, "package.json"), MANIFEST);
  git(main, ["init", "-q", "-b", "main"]);
  git(main, ["add", "-A"]);
  git(main, ["commit", "-qm", "fixture"]);
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

describe("squeal daemon in a worktree without installed dependencies (D5, defect 18)", SLOW, () => {
  const suite = daemonSuite();

  it("loads no runner and lists nothing until an install, then runs the baseline", async () => {
    const repo = freshWorktree();
    suite.cleanup(repo.cleanup);
    const spawned = suite.daemon(repo);
    await waitReady(repo, spawned);

    const notes = readNotes(repo);
    expect(notes).toContain(
      "no dependencies are installed in this worktree; Squeal lists and runs no tests until an install",
    );
    // Opening the runner here would have noted that `vitest/node` does not resolve.
    expect(notes.filter((text) => /vitest/i.test(text))).toEqual([]);
    withStore(repo, (store) => {
      expect(readHeader(store, repo.worktreeId)).toMatchObject({
        awaitingInstall: true,
        testFilesListed: false,
      });
      expect(store.testFileKeys.list(repo.worktreeId)).toEqual([]);
    });

    // The install: this repository's Vitest, linked, and the installed lockfile.
    mkdirSync(join(repo.root, "node_modules"));
    symlinkSync(join(repoRoot, "node_modules/vitest"), join(repo.root, "node_modules/vitest"));
    writeFileSync(
      join(repo.root, "node_modules/.package-lock.json"),
      JSON.stringify({
        packages: {
          "node_modules/vitest": { link: true, resolved: join(repoRoot, "node_modules/vitest") },
        },
      }),
    );
    // The agent's next edit is reconciled with it.
    appendFileSync(join(repo.root, "src/math.ts"), "// edited after the install\n");
    const header = await waitFor(
      () =>
        withStore(repo, (store) => {
          const read = readHeader(store, repo.worktreeId);
          return read.counts.current >= 5 && read.counts.pending === 0 ? read : null;
        }),
      90_000,
      "baseline after the install",
    );
    expect(header.awaitingInstall).toBeUndefined();
    expect(header.testFilesListed).toBe(true);
    expect(readNotes(repo).filter((text) => /vitest/i.test(text))).toEqual([]);
  });
});
