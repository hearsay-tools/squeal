import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { acquireDaemonLock } from "../../../../src/core/daemon/lock.js";
import {
  BOOTSTRAP_DEADLINES,
  ensureGitTree,
  localGitState,
} from "../../../../src/core/runner-host/remote/providers/agent37/bootstrap.js";
import {
  fullBundleKey,
  sharedFullBundle,
} from "../../../../src/core/runner-host/remote/providers/agent37/bundle-cache.js";
import type { SshTarget } from "../../../../src/core/runner-host/remote/ssh.js";
import type { AbsolutePath } from "../../../../src/core/types/common.js";
import { fakeSshAt } from "./agent37-api-mock.js";

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-agent37-bcache-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let seq = 0;

/** Creates a git wrapper in `bin` that logs `bundle create` calls and forwards to real git. */
function gitWrapper(dir: string): { bin: string; log: string } {
  const bin = join(dir, "git-bin");
  const log = join(dir, "git-bundle.log");
  mkdirSync(bin, { recursive: true });
  const realGit = execFileSync("which", ["git"]).toString().trim();
  const script = join(bin, "git");
  writeFileSync(
    script,
    [
      "#!/bin/sh",
      `case " $* " in *" bundle create "*) printf '%s\\n' "$*" >> ${JSON.stringify(log)} ;; esac`,
      `exec ${JSON.stringify(realGit)} "$@"`,
      "",
    ].join("\n"),
  );
  chmodSync(script, 0o755);
  return { bin, log };
}

describe("Agent37 full bundle cache and single-thread packing", () => {
  it("packs once with pack.threads=1 when two worktrees on different branches bootstrap the same commit concurrently", async () => {
    const dir = join(scratch, `s${++seq}`);
    const main = join(dir, "main");
    const wt2 = join(dir, "wt2");
    mkdirSync(main, { recursive: true });
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", main, "-c", "user.name=t", "-c", "user.email=t@t", ...args])
        .toString()
        .trim();
    git("init", "-q");
    writeFileSync(join(main, "a.ts"), "export const a = 1;\n");
    git("add", ".");
    git("commit", "-q", "-m", "first");
    git("tag", "v1");
    git("worktree", "add", "-q", "-b", "branch-two", wt2, "HEAD");

    const ssh1 = fakeSshAt(join(dir, "ssh1"));
    const ssh2 = fakeSshAt(join(dir, "ssh2"));
    const wrap = gitWrapper(dir);
    const oldPath = process.env.PATH ?? "";
    process.env.PATH = `${wrap.bin}:${oldPath}`;
    try {
      const t1: SshTarget = {
        destination: "node@box1",
        env: { ...process.env, PATH: `${ssh1.bin}:${wrap.bin}:${oldPath}` },
      };
      const t2: SshTarget = {
        destination: "node@box2",
        env: { ...process.env, PATH: `${ssh2.bin}:${wrap.bin}:${oldPath}` },
      };
      const [r1, r2] = await Promise.all([
        ensureGitTree(t1, "cache/t1", main, BOOTSTRAP_DEADLINES),
        ensureGitTree(t2, "cache/t2", wt2, BOOTSTRAP_DEADLINES),
      ]);
      expect(r1.kind).toBe("sent");
      expect(r2.kind).toBe("sent");

      // Only one `git bundle create` ran across both worktrees, and it pinned pack.threads=1.
      const calls = readFileSync(wrap.log, "utf8").trim().split("\n").filter(Boolean);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain("-c pack.threads=1 bundle create");

      // Both remote trees received the exact commit, tags, and their own branch name.
      const head = git("rev-parse", "HEAD");
      expect(
        execFileSync("git", ["-C", join(ssh1.home, "cache/t1/root"), "rev-parse", "HEAD"])
          .toString()
          .trim(),
      ).toBe(head);
      expect(
        execFileSync("git", ["-C", join(ssh2.home, "cache/t2/root"), "rev-parse", "HEAD"])
          .toString()
          .trim(),
      ).toBe(head);
      expect(
        execFileSync("git", [
          "-C",
          join(ssh2.home, "cache/t2/root"),
          "symbolic-ref",
          "--short",
          "HEAD",
        ])
          .toString()
          .trim(),
      ).toBe("branch-two");
    } finally {
      process.env.PATH = oldPath;
    }

    // Pruning keeps at most 2 cached bundles after subsequent commits.
    const cacheDir = join(main, ".git/squeal/remote-bundles");
    expect(existsSync(cacheDir)).toBe(true);
    for (let i = 2; i <= 4; i++) {
      writeFileSync(join(main, "a.ts"), `export const a = ${i};\n`);
      git("add", "a.ts");
      git("commit", "-q", "-m", `c${i}`);
      const freshSsh = fakeSshAt(join(dir, `ssh-p${i}`));
      const target: SshTarget = {
        destination: `node@p${i}`,
        env: { ...process.env, PATH: `${freshSsh.bin}:${oldPath}` },
      };
      await ensureGitTree(target, `cache/p${i}`, main, BOOTSTRAP_DEADLINES);
    }
    const kept = readdirSync(cacheDir).filter((name) => name.endsWith(".bundle"));
    expect(kept.length).toBeLessThanOrEqual(2);
  });

  it("keys full bundles by commit and tags, independent of branch name", () => {
    const a = fullBundleKey({
      head: "a".repeat(40),
      key: `head ${"a".repeat(40)}\nref refs/heads/one\ntag ${"b".repeat(40)} refs/tags/v1`,
      refs: `head ${"a".repeat(40)}\nref refs/heads/one\ntag ${"b".repeat(40)} refs/tags/v1`,
    });
    const b = fullBundleKey({
      head: "a".repeat(40),
      key: `head ${"a".repeat(40)}\nref refs/heads/two\ntag ${"b".repeat(40)} refs/tags/v1`,
      refs: `head ${"a".repeat(40)}\nref refs/heads/two\ntag ${"b".repeat(40)} refs/tags/v1`,
    });
    const c = fullBundleKey({
      head: "a".repeat(40),
      key: `head ${"a".repeat(40)}\nref refs/heads/one\ntag ${"c".repeat(40)} refs/tags/v1`,
      refs: `head ${"a".repeat(40)}\nref refs/heads/one\ntag ${"c".repeat(40)} refs/tags/v1`,
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  // Review 0.1.630 B4: cross-device fallback copies into caller ownership so pruning never deletes it.
  it("keeps the caller's bundle alive across cache pruning even on a cross-device callerDir", async () => {
    const dir = join(scratch, `b4-${++seq}`);
    const repo = join(dir, "repo");
    mkdirSync(repo, { recursive: true });
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args])
        .toString()
        .trim();
    git("init", "-q");
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
    git("add", ".");
    git("commit", "-q", "-m", "c1");
    const state1 = await localGitState(repo);
    if (state1 === null) throw new Error("expected state1");

    // Prefer /dev/shm when it sits on a separate filesystem from tmpdir() to exercise real EXDEV.
    const crossBase =
      existsSync("/dev/shm") && statSync("/dev/shm").dev !== statSync(dir).dev ? "/dev/shm" : dir;
    const caller1 = mkdtempSync(join(crossBase, "squeal-b4-caller-"));
    try {
      const bundle1 = await sharedFullBundle(repo, state1, caller1, 30_000);
      expect(bundle1).toBe(join(caller1, "full.bundle"));

      // Two more commits evict state1's cached bundle from .git/squeal/remote-bundles.
      for (const n of [2, 3]) {
        writeFileSync(join(repo, "a.ts"), `export const a = ${n};\n`);
        git("add", ".");
        git("commit", "-q", "-m", `c${n}`);
        const st = await localGitState(repo);
        if (st === null) throw new Error("expected state");
        const callerN = join(dir, `caller-${n}`);
        mkdirSync(callerN, { recursive: true });
        await sharedFullBundle(repo, st, callerN, 30_000);
      }

      // Caller 1's returned bundle path is still readable and valid.
      expect(existsSync(bundle1)).toBe(true);
      const heads = execFileSync("git", ["bundle", "list-heads", bundle1]).toString();
      expect(heads).toContain(`${state1.head} HEAD`);
    } finally {
      rmSync(caller1, { recursive: true, force: true });
    }
  });

  // Review 0.1.630 B5: an existing read-only cache directory falls back cleanly to a private bundle.
  it("falls back to a private bundle when the existing cache directory is read-only", async () => {
    const dir = join(scratch, `b5-${++seq}`);
    const repo = join(dir, "repo");
    const caller1 = join(dir, "caller1");
    const caller2 = join(dir, "caller2");
    mkdirSync(repo, { recursive: true });
    mkdirSync(caller1, { recursive: true });
    mkdirSync(caller2, { recursive: true });
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args])
        .toString()
        .trim();
    git("init", "-q");
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
    git("add", ".");
    git("commit", "-q", "-m", "c1");
    const state = await localGitState(repo);
    if (state === null) throw new Error("expected state");

    // Prime the cache, then make the existing cache directory read-only (0555).
    await sharedFullBundle(repo, state, caller1, 30_000);
    const cacheDir = join(repo, ".git/squeal/remote-bundles");
    chmodSync(cacheDir, 0o555);
    try {
      const bundle = await sharedFullBundle(repo, state, caller2, 30_000);
      expect(bundle).toBe(join(caller2, "full.bundle"));
      expect(existsSync(bundle)).toBe(true);
      const heads = execFileSync("git", ["bundle", "list-heads", bundle]).toString();
      expect(heads).toContain(`${state.head} HEAD`);
    } finally {
      chmodSync(cacheDir, 0o755);
    }
  });

  // Review 0.1.630 B6: a moved HEAD or tag never poisons another worktree's cached bundle key.
  it("does not poison a cache key when HEAD moves to an unrelated commit before packing", async () => {
    const dir = join(scratch, `b6-${++seq}`);
    const wt1 = join(dir, "wt1");
    const wt2 = join(dir, "wt2");
    const empty = join(dir, "empty");
    const caller1 = join(dir, "caller1");
    const caller2 = join(dir, "caller2");
    for (const d of [wt1, empty, caller1, caller2]) mkdirSync(d, { recursive: true });
    const gitAt = (cwd: string, ...args: string[]) =>
      execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args])
        .toString()
        .trim();
    gitAt(wt1, "init", "-q");
    writeFileSync(join(wt1, "a.ts"), "export const a = 1;\n");
    gitAt(wt1, "add", ".");
    gitAt(wt1, "commit", "-q", "-m", "commit-A");
    gitAt(wt1, "tag", "-a", "v1", "-m", "annotated v1");
    const stateA = await localGitState(wt1);
    if (stateA === null) throw new Error("expected stateA");
    gitAt(wt1, "worktree", "add", "-q", "-b", "keep-a", wt2, "HEAD");

    // Move wt1 to an unrelated orphan commit B while holding stale stateA.
    gitAt(wt1, "checkout", "-q", "--orphan", "orphan-b");
    gitAt(wt1, "rm", "-rfq", ".");
    writeFileSync(join(wt1, "b.ts"), "export const b = 2;\n");
    gitAt(wt1, "add", ".");
    gitAt(wt1, "commit", "-q", "-m", "commit-B");

    await sharedFullBundle(wt1, stateA, caller1, 30_000);

    // Worktree 2 is still at stateA; its call must produce a bundle containing commit A.
    const freshStateA = await localGitState(wt2);
    if (freshStateA === null) throw new Error("expected freshStateA");
    const bundleA = await sharedFullBundle(wt2, freshStateA, caller2, 30_000);
    gitAt(empty, "init", "-q");
    gitAt(empty, "bundle", "unbundle", bundleA);
    expect(gitAt(empty, "cat-file", "-t", stateA.head)).toBe("commit");
  });

  // Review 0.1.630 B7: aborting right as the lock is released must never leak the repository lock.
  it("releases the repository lock when aborted while waiting for it", async () => {
    const dir = join(scratch, `b7-${++seq}`);
    const repo = join(dir, "repo");
    const caller = join(dir, "caller");
    mkdirSync(repo, { recursive: true });
    mkdirSync(caller, { recursive: true });
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args])
        .toString()
        .trim();
    git("init", "-q");
    writeFileSync(join(repo, "a.ts"), "export const a = 1;\n");
    git("add", ".");
    git("commit", "-q", "-m", "c1");
    const state = await localGitState(repo);
    if (state === null) throw new Error("expected state");

    const cacheDir = join(repo, ".git/squeal/remote-bundles");
    mkdirSync(cacheDir, { recursive: true });
    const lockPath = join(cacheDir, "bundle.lock.sqlite") as AbsolutePath;
    const held = acquireDaemonLock(lockPath);
    if (held === null) throw new Error("could not acquire test lock");

    const controller = new AbortController();
    const timer = setTimeout(() => {
      held.release();
      controller.abort();
    }, 30);

    try {
      await expect(
        sharedFullBundle(repo, state, caller, 5_000, controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      clearTimeout(timer);
    }

    // Lock must be immediately free after the aborted call rejects.
    const reacquired = acquireDaemonLock(lockPath);
    expect(reacquired).not.toBeNull();
    reacquired?.release();
  });
});
