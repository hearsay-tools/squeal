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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  BOOTSTRAP_DEADLINES,
  ensureGitTree,
} from "../../../../src/core/runner-host/remote/providers/agent37/bootstrap.js";
import { fullBundleKey } from "../../../../src/core/runner-host/remote/providers/agent37/bundle-cache.js";
import type { SshTarget } from "../../../../src/core/runner-host/remote/ssh.js";
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
});
