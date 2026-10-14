import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadUserConfig,
  repositoryRootOf,
  resolveCapacity,
} from "../../src/core/daemon/user-config.js";
import { resolveCommonDir } from "../../src/core/fs/git-layout.js";

/*
 * Review 001-384, B3: `capacity.projects` names a repository by its main
 * worktree's root, which every worktree of it resolves from Git's layout.
 * The review's probe: a `--separate-git-dir` repository resolved to its
 * metadata directory, so the entry naming its root was never matched.
 * An ordinary repository's worktrees are `user-config.test.ts`'s. Real
 * repositories in a temporary directory, with git's user and system
 * config shut out.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "squeal-repository-root-")));
  dirs.push(dir);
  return dir;
}

function gitIn(dir: string): (cwd: string, args: string[]) => void {
  const env = {
    PATH: process.env.PATH,
    HOME: join(dir, "home"),
    XDG_CONFIG_HOME: join(dir, "config"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
  return (cwd, args) => {
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      cwd,
      env,
      stdio: "pipe",
    });
  };
}

/** What the daemon passes: its realpathed root and git's common dir. */
function rootOf(root: string): string {
  const commonDir = resolveCommonDir(root);
  if (commonDir === null) throw new Error(`${root} has no common dir`);
  return repositoryRootOf(realpathSync(root), realpathSync(commonDir));
}

describe("repositoryRootOf: the main worktree's root from Git's layout (review 001-384, B3)", () => {
  it("names a --separate-git-dir repository by its root, so the entry for that root caps it", () => {
    const dir = tempDir();
    const git = gitIn(dir);
    const root = join(dir, "root");
    const meta = join(dir, "meta");
    git(dir, ["init", "-q", "-b", "main", "--separate-git-dir", meta, root]);
    git(root, ["commit", "-q", "--allow-empty", "-m", "x"]);
    expect(rootOf(root)).toBe(root);
    const env = { HOME: join(dir, "home"), XDG_CONFIG_HOME: join(dir, "config") };
    mkdirSync(join(env.XDG_CONFIG_HOME, "squeal"), { recursive: true });
    const { config } = loadUserConfig({ env, cpus: 8 });
    const capped = {
      ...config,
      capacity: { ...config.capacity, projects: { [root]: { slots: 2 } } },
    };
    expect(resolveCapacity(capped, rootOf(root))).toEqual({ hostSlots: 7, projectSlots: 2 });
    // Git records no main worktree for a linked worktree here: the metadata directory names it.
    git(root, ["worktree", "add", "-q", join(dir, "linked")]);
    expect(rootOf(join(dir, "linked"))).toBe(meta);
  });

  it("names a submodule by its checkout, from the checkout and from a linked worktree of it", () => {
    const dir = tempDir();
    const git = gitIn(dir);
    const sub = join(dir, "sub");
    const app = join(dir, "app");
    for (const repo of [sub, app]) {
      mkdirSync(repo);
      git(repo, ["init", "-q", "-b", "main"]);
      git(repo, ["commit", "-q", "--allow-empty", "-m", "x"]);
    }
    git(app, ["-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "mod"]);
    const checkout = join(app, "mod");
    expect(rootOf(checkout)).toBe(checkout);
    git(checkout, ["worktree", "add", "-q", join(dir, "mod-linked")]);
    expect(rootOf(join(dir, "mod-linked"))).toBe(checkout);
  });

  it("names a bare repository's worktree by the bare directory", () => {
    const dir = tempDir();
    const git = gitIn(dir);
    const bare = join(dir, "repo.git");
    git(dir, ["init", "-q", "--bare", "-b", "main", bare]);
    git(dir, ["--git-dir", bare, "worktree", "add", "-q", "--orphan", join(dir, "wt")]);
    expect(rootOf(join(dir, "wt"))).toBe(bare);
  });
});
