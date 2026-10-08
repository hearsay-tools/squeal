import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { join, sep } from "node:path";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { daemonScratch } from "../../src/core/daemon/scratch.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import type { KnownState } from "../../src/core/types/index.js";
import { git } from "../hash/git-repo.js";
import {
  createFixtureRepo,
  diagnose,
  type FixtureRepo,
  type SpawnedProcess,
  waitFor,
  withStore,
} from "./helpers.js";

/*
 * Fixtures and process probes for spec 001 D10 as amended for lessons
 * defect 13: what a daemon holds inside its worktree and the temp directory
 * of whoever started it.
 */

/** Review wave 7.6, B1: passes only when `os.tmpdir()` lies outside every git repository. */
export const TMP_TEST = `import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
it("makes its temp directory outside every repository", () => {
  const dir = mkdtempSync(join(tmpdir(), "x-"));
  expect(() =>
    execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: dir, stdio: "pipe" }),
  ).toThrow(/not a git repository/);
});
`;

export interface LinkedFixture extends FixtureRepo {
  /** The main checkout the linked worktree was added from. */
  readonly mainRoot: string;
}

/** A linked worktree of a fresh fixture, so its common dir lies outside its root. */
export function linkedFixture(
  cleanups: (() => void)[],
  files: Readonly<Record<string, string>>,
): LinkedFixture {
  const repo = createFixtureRepo({ files });
  cleanups.push(repo.cleanup);
  const linkedRoot = join(repo.root, "..", "linked");
  git(repo.root, ["worktree", "add", "-q", "--detach", linkedRoot]);
  const root = realpathSync(linkedRoot);
  const worktreeId = worktreeIdFor(root);
  const tempDir = daemonScratch(repo.commonDir, root).tempDir;
  cleanups.push(() => rmSync(tempDir, { recursive: true, force: true }));
  return {
    ...repo,
    mainRoot: repo.root,
    root,
    worktreeId,
    socketPath: socketPathFor(worktreeId, { XDG_RUNTIME_DIR: repo.runtimeDir }),
  };
}

/** A directory of the test's own standing in for the spawner's `TMPDIR`. */
export function callerTempDir(cleanups: (() => void)[]): string {
  const dir = realpathSync(mkdtempSync("/tmp/sq-caller-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The first known result of a test file, failing with the daemon's notes and stderr. */
export function resultOf(
  repo: FixtureRepo,
  spawned: SpawnedProcess | undefined,
  testPath: string,
): Promise<KnownState> {
  return waitFor(
    () =>
      withStore(repo, (store) =>
        store.knownStates
          .list(repo.worktreeId)
          .find(
            (s) =>
              s.check.kind === "test" && s.check.testPath === testPath && s.outcome !== "unknown",
          ),
      ),
    120_000,
    `a result for ${testPath}`,
  ).catch((error: Error) => {
    const states = withStore(repo, (store) => store.knownStates.list(repo.worktreeId));
    throw new Error(
      `${error.message}: ${JSON.stringify(states.slice(0, 3))} ${diagnose(repo, spawned)}`,
    );
  });
}

/** Waits for the process to exit, `null` after `ms`. */
export function exitWithin(
  spawned: SpawnedProcess,
  ms: number,
): Promise<{ code: number | null; signal: NodeJS.Signals | null } | null> {
  return Promise.race([
    spawned.exited,
    new Promise<null>((done) => setTimeout(() => done(null), ms)),
  ]);
}

/** The process and its descendants. */
export function tree(pid: number): number[] {
  const all = [pid];
  for (let i = 0; i < all.length; i++) {
    const tasks = join("/proc", String(all[i]), "task");
    for (const task of safe(() => readdirSync(tasks), [])) {
      const children = safe(() => readFileSync(join(tasks, task, "children"), "utf8"), "");
      all.push(...children.split(" ").filter(Boolean).map(Number));
    }
  }
  return all;
}

/** Working directory and open files of each process, as `pid path` lines. */
export function heldBy(pids: readonly number[]): { pid: number; path: string }[] {
  const held: { pid: number; path: string }[] = [];
  for (const pid of pids) {
    const proc = join("/proc", String(pid));
    held.push({ pid, path: safe(() => readlinkSync(join(proc, "cwd")), "") });
    for (const fd of safe(() => readdirSync(join(proc, "fd")), [])) {
      held.push({ pid, path: safe(() => readlinkSync(join(proc, "fd", fd)), "") });
    }
  }
  // Sockets, pipes and inotify handles have no path.
  return held.filter(({ path }) => path.startsWith("/"));
}

/** Working directory and open files of `pid` and its descendants, as paths. */
export function held(pid: number): string[] {
  return heldBy(tree(pid)).map(({ path }) => path);
}

export const inside = (path: string, dir: string) => path === dir || path.startsWith(dir + sep);

export function alive(pid: number): boolean {
  return existsSync(`/proc/${pid}`);
}

export function safe<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}
