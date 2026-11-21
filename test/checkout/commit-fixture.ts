import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cacheCheckoutsDir } from "../../src/core/checkout/location.js";
import type { CheckoutMarker } from "../../src/core/checkout/marker.js";
import { leaseProcess } from "../../src/core/daemon/lease-process.js";
import { pidNamespace } from "../../src/core/delivery/harness-process.js";
import type { AbsolutePath } from "../../src/core/types/common.js";

/*
 * Row 023-38: a two-commit git fixture under `$TMPDIR` with a cache root of
 * its own, for the commit worktree's tests. The install is injected: it
 * counts its calls and takes `ms`, so a test sees whether a second caller
 * installs again without running a package manager.
 */

export interface CommitFixture {
  readonly base: AbsolutePath;
  readonly repo: AbsolutePath;
  readonly commonDir: AbsolutePath;
  readonly cacheRoot: AbsolutePath;
  /** The repository's dir under the cache root. */
  readonly dir: AbsolutePath;
  /** HEAD~1 and HEAD, full ids. */
  readonly first: string;
  readonly second: string;
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function commitFixture(): CommitFixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "squeal-commit-wt-")));
  const repo = join(base, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  writeFileSync(join(repo, "a.txt"), "first\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "first");
  const first = git(repo, "rev-parse", "HEAD").trim();
  writeFileSync(join(repo, "a.txt"), "second\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "second");
  const second = git(repo, "rev-parse", "HEAD").trim();
  const commonDir = realpathSync(join(repo, ".git"));
  const cacheRoot = join(base, "cache", "squeal", "checkouts");
  return {
    base,
    repo,
    commonDir,
    cacheRoot,
    dir: cacheCheckoutsDir(cacheRoot, commonDir),
    first,
    second,
  };
}

/** An install that takes `ms` and counts its calls in `calls`. */
export function countingInstall(calls: string[], ms = 0, ok = true) {
  return async (tree: AbsolutePath) => {
    calls.push(tree);
    await new Promise((resolve) => setTimeout(resolve, ms));
    return ok
      ? { ok: true as const, command: "npm ci", ms }
      : { ok: false as const, command: "npm ci", ms, reason: "exit 1", log: "npm error" };
  };
}

/** The lease of a process that has exited. */
export function deadLease(): CheckoutMarker["owner"] {
  const ended = spawnSync(process.execPath, ["-e", ""]);
  return { pid: ended.pid as number, startTime: 1, pidNamespace: pidNamespace() };
}

/** A live child that sleeps, with its lease; `end` kills it and waits for its exit. */
export function liveChild(): { lease: CheckoutMarker["owner"]; end: () => Promise<void> } {
  const child = spawn("sleep", ["60"], { stdio: "ignore" });
  const exited = new Promise<void>((resolve) => child.on("exit", () => resolve()));
  return {
    lease: leaseProcess(child.pid as number),
    end: async () => {
      child.kill("SIGKILL");
      await exited;
    },
  };
}
