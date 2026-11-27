import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  BOOTSTRAP_DEADLINES,
  ensureGitTree,
} from "../../../../src/core/runner-host/remote/providers/agent37/bootstrap.js";
import { gitKeeper } from "../../../../src/core/runner-host/remote/providers/agent37/machine.js";
import type { SshTarget } from "../../../../src/core/runner-host/remote/ssh.js";
import { fakeSshAt } from "./agent37-api-mock.js";

/*
 * Row 026-39 (#303, spec 026 D7.3, D8.4): the remote `.git`'s index is the
 * worktree's staged index. Real Git here and over a fake `ssh` whose
 * "instance" is a directory here: after `git mv` with no commit, Git there
 * lists what Git here lists, and still after the commit; a staged index
 * unchanged since the last sync makes no SSH call.
 */

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-agent37-index-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const TREE = "cache/squeal/trees/t1";
let n = 0;

function setup(files: Readonly<Record<string, string>>) {
  const dir = join(scratch, `s${++n}`);
  const root = join(dir, "worktree");
  const write = (path: string, text: string) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const [path, text] of Object.entries(files)) write(path, text);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("commit", "-q", "-m", "first");
  const ssh = fakeSshAt(dir);
  const target: SshTarget = {
    destination: "node@box",
    env: { ...process.env, PATH: `${ssh.bin}:${process.env.PATH}` },
  };
  const remote = join(ssh.home, TREE, "root");
  const there = (...args: string[]) => execFileSync("git", ["-C", remote, ...args]).toString();
  const keeper = gitKeeper(
    { tree: TREE, root, deadlines: BOOTSTRAP_DEADLINES, log: () => {} },
    null,
  );
  /** Whether Git there lists and stages what Git here does: stages, object names, intent-to-add. */
  const sameIndex = () => {
    expect(there("ls-files", "-s")).toBe(git("ls-files", "-s"));
    expect(there("ls-files", "--cached")).toBe(git("ls-files", "--cached"));
    expect(there("diff", "--cached", "--name-status")).toBe(
      git("diff", "--cached", "--name-status"),
    );
  };
  return { root, write, git, ssh, target, remote, there, keeper, sameIndex };
}

const FILES = { "src/old.ts": "export const old = 1;\n", "src/keep.ts": "export const k = 1;\n" };

describe("the remote index follows the staged index (row 026-39)", () => {
  it("lists the renamed path after git mv, and still after its commit", async () => {
    const s = setup(FILES);
    expect(await s.keeper.sync(s.target)).toBe(true);
    s.sameIndex();
    s.git("mv", "src/old.ts", "src/new.ts");
    // HEAD, its branch and the tags unchanged; the index moved: not current until synced.
    expect(await s.keeper.sync(null)).toBe(false);
    expect(await s.keeper.sync(s.target)).toBe(true);
    s.sameIndex();
    expect(s.there("ls-files", "--cached")).toBe("src/keep.ts\nsrc/new.ts\n");
    s.git("commit", "-q", "-m", "rename");
    expect(await s.keeper.sync(null)).toBe(false);
    expect(await s.keeper.sync(s.target)).toBe(true);
    s.sameIndex();
    expect(s.there("rev-parse", "HEAD")).toBe(s.git("rev-parse", "HEAD"));
  });

  it("makes no SSH call while the staged index is unchanged", async () => {
    const s = setup(FILES);
    s.git("mv", "src/old.ts", "src/new.ts");
    expect(await s.keeper.sync(s.target)).toBe(true);
    const before = s.ssh.argv().length;
    // A working-tree edit that is not staged leaves the index as it was.
    s.write("src/keep.ts", "export const k = 2;\n");
    expect(await s.keeper.sync(null)).toBe(true);
    expect(await s.keeper.sync(s.target)).toBe(true);
    expect(s.ssh.argv().length).toBe(before);
    const direct = await ensureGitTree(s.target, TREE, s.root, BOOTSTRAP_DEADLINES);
    expect(direct.kind).toBe("present");
  });

  it("carries staged content that is in no commit, and an unstaged index back to HEAD", async () => {
    const s = setup(FILES);
    await s.keeper.sync(s.target);
    s.write("src/keep.ts", "export const k = 'staged';\n");
    s.write("src/added.ts", "export const a = 1;\n");
    s.git("add", "src/keep.ts", "src/added.ts");
    s.write("src/keep.ts", "export const k = 'not staged';\n");
    s.git("rm", "-q", "--cached", "src/old.ts");
    s.write("src/later.ts", "x\n");
    s.git("add", "-N", "src/later.ts");
    expect(await s.keeper.sync(s.target)).toBe(true);
    s.sameIndex();
    expect(s.there("show", ":src/keep.ts")).toBe("export const k = 'staged';\n");
    s.git("reset", "-q");
    expect(await s.keeper.sync(s.target)).toBe(true);
    s.sameIndex();
  });

  it("keeps intent-to-add apart from a staged empty file, both ways (review 0.1.662 B2)", async () => {
    const s = setup(FILES);
    await s.keeper.sync(s.target);
    s.write("src/later.ts", "export const later = 1;\n");
    s.git("add", "-N", "--", "src/later.ts");
    expect(await s.keeper.sync(s.target)).toBe(true);
    s.sameIndex();
    expect(s.there("diff", "--cached", "--name-only")).toBe("");
    // The flag is the index's: the working-tree file there stays the tree host's to write.
    expect(existsSync(join(s.remote, "src/later.ts"))).toBe(false);
    // To a staged empty file: the same `ls-files -s` line, another staged diff.
    s.git("rm", "-q", "--cached", "--", "src/later.ts");
    s.write("src/later.ts", "");
    s.git("add", "--", "src/later.ts");
    expect(await s.keeper.sync(null)).toBe(false);
    expect(await s.keeper.sync(s.target)).toBe(true);
    s.sameIndex();
    expect(s.there("diff", "--cached", "--name-status")).toBe("A\tsrc/later.ts\n");
    // And back to intent-to-add.
    s.git("rm", "-q", "--cached", "--", "src/later.ts");
    s.git("add", "-N", "--", "src/later.ts");
    expect(await s.keeper.sync(null)).toBe(false);
    expect(await s.keeper.sync(s.target)).toBe(true);
    s.sameIndex();
    const before = s.ssh.argv().length;
    expect(await s.keeper.sync(s.target)).toBe(true);
    expect(s.ssh.argv().length).toBe(before);
  });

  it("carries odd paths, intent-to-add ones too, as names and never as shell", async () => {
    const s = setup(FILES);
    await s.keeper.sync(s.target);
    const odd = 'src/q"t\tn\nl $(touch pwned) é.ts';
    s.write(odd, "odd\n");
    s.git("add", "--", odd);
    const oddIntent = 'src/i"t\t$(touch pwned2).ts';
    s.write(oddIntent, "intent\n");
    s.git("add", "-N", "--", oddIntent);
    expect(await s.keeper.sync(s.target)).toBe(true);
    s.sameIndex();
    expect(s.there("ls-files", "-z")).toBe(s.git("ls-files", "-z"));
    expect(s.there("show", `:${odd}`)).toBe("odd\n");
    expect(existsSync(join(s.remote, "pwned"))).toBe(false);
    expect(existsSync(join(s.remote, "pwned2"))).toBe(false);
  });

  it("carries a commit and a staged rename in one sync", async () => {
    const s = setup(FILES);
    await s.keeper.sync(s.target);
    s.write("src/third.ts", "3\n");
    s.git("add", "src/third.ts");
    s.git("commit", "-q", "-m", "third");
    s.git("mv", "src/third.ts", "src/moved.ts");
    expect(await s.keeper.sync(s.target)).toBe(true);
    s.sameIndex();
    expect(s.there("rev-parse", "HEAD")).toBe(s.git("rev-parse", "HEAD"));
  });

  it("carries a merge conflict's stages", async () => {
    const s = setup(FILES);
    s.git("checkout", "-q", "-b", "other");
    s.write("src/keep.ts", "other\n");
    s.git("commit", "-q", "-am", "other");
    s.git("checkout", "-q", "main");
    s.write("src/keep.ts", "main\n");
    s.git("commit", "-q", "-am", "main");
    expect(() => s.git("merge", "-q", "other")).toThrow();
    expect(s.git("ls-files", "-u")).not.toBe("");
    expect(await s.keeper.sync(s.target)).toBe(true);
    s.sameIndex();
    const before = s.ssh.argv().length;
    expect(await s.keeper.sync(s.target)).toBe(true);
    expect(s.ssh.argv().length).toBe(before);
  });
});
