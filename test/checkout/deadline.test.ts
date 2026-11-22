import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addCheckout } from "../../src/core/checkout/checkout.js";
import { packageStore } from "../../src/core/checkout/location.js";
import type { AbsolutePath } from "../../src/core/types/common.js";

/*
 * Review wave-23-third B1 (spec 023 D7.3: every step of a `status --at`
 * call counts against its one wait): the package store's query and git's
 * worktree steps take a deadline. Each blocks here on a barrier file the
 * test writes at the end (a `pnpm` that waits, a `post-checkout` hook that
 * waits), and the deadline ends it. Without one, each keeps its own
 * timeout (10 s, 120 s).
 */

const dirs: string[] = [];
const releases: string[] = [];
afterEach(() => {
  for (const release of releases.splice(0)) writeFileSync(release, "done");
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "sq-deadline-")));
  dirs.push(dir);
  return dir;
}

/** A shell script that waits until `release` exists, or its folder is gone (the test's cleanup). */
function waiter(path: string, release: string): void {
  const dir = dirname(release);
  writeFileSync(
    path,
    `#!/bin/sh\nwhile [ ! -e "${release}" ] && [ -d "${dir}" ]; do sleep 0.05; done\n`,
  );
  chmodSync(path, 0o755);
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

describe("a call's deadline cuts the checkout's slow steps (review wave-23-third B1)", () => {
  it("ends `pnpm store path` at the deadline, and asks nothing with none left", async () => {
    const dir = scratch();
    const release = join(dir, "release");
    releases.push(release);
    const bin = join(dir, "bin");
    mkdirSync(bin);
    waiter(join(bin, "pnpm"), release);
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path}`;
    try {
      const began = Date.now();
      expect(await packageStore(dir as AbsolutePath, "pnpm install --frozen-lockfile", 500)).toBe(
        null,
      );
      const ms = Date.now() - began;
      expect(ms).toBeGreaterThanOrEqual(400);
      expect(ms).toBeLessThan(5_000);
      const none = Date.now();
      expect(await packageStore(dir as AbsolutePath, "pnpm install --frozen-lockfile", 0)).toBe(
        null,
      );
      expect(Date.now() - none).toBeLessThan(200);
    } finally {
      process.env.PATH = path;
    }
  });

  it("ends git's worktree add at the deadline and leaves no worktree, and starts none past it", async () => {
    const dir = scratch();
    const root = join(dir, "repo");
    mkdirSync(root);
    git(root, "init", "-q", "-b", "main");
    writeFileSync(join(root, "a.txt"), "a\n");
    git(root, "add", "-A");
    git(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "a");
    const commit = git(root, "rev-parse", "HEAD").trim();
    const release = join(dir, "release");
    releases.push(release);
    waiter(join(root, ".git/hooks/post-checkout"), release);
    const checkouts = join(dir, "checkouts");
    mkdirSync(checkouts);
    const common = realpathSync(join(root, ".git")) as AbsolutePath;
    const base = {
      root: root as AbsolutePath,
      commonDir: common,
      dir: checkouts as AbsolutePath,
      commit,
    };

    const began = Date.now();
    await expect(
      addCheckout({ ...base, name: "cut", deadline: Date.now() + 1_000 }),
    ).rejects.toThrow(/timed out/);
    const ms = Date.now() - began;
    expect(ms).toBeLessThan(10_000);
    expect(existsSync(join(checkouts, "cut"))).toBe(false);

    await expect(addCheckout({ ...base, name: "late", deadline: Date.now() - 1 })).rejects.toThrow(
      "the call's wait ended before git worktree prune",
    );
    expect(existsSync(join(checkouts, "late"))).toBe(false);
  });
});
