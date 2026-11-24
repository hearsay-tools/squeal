import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  BOOTSTRAP_DEADLINES,
  ensureGitTree,
} from "../../../../src/core/runner-host/remote/providers/agent37/bootstrap.js";
import { gitKeeper } from "../../../../src/core/runner-host/remote/providers/agent37/machine.js";
import type { SshTarget } from "../../../../src/core/runner-host/remote/ssh.js";
import { treeEntries, treePaths, writesFor } from "../../../../src/core/runner-host/remote/tree.js";
import { createTreeHost } from "../../../../src/core/runner-host/remote/tree-host.js";
import type { AbsolutePath } from "../../../../src/core/types/common.js";
import { fakeSshAt } from "./agent37-api-mock.js";

/*
 * Review 0.1.619 B2, B3 (spec 026 D7.3, D8.4): the `git-bundle` bootstrap
 * over a fake `ssh` whose "instance" is a directory here, with real Git and
 * the real tree host. The bundle fills `.git` alone, so a file deleted here
 * never appears there; a later commit, tag or branch here reaches that
 * `.git` without a working-tree write, and only when it moved.
 */

const scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-agent37-git-")));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const TREE = "cache/squeal/trees/t1";
let n = 0;

function setup(files: Readonly<Record<string, string>>) {
  const dir = join(scratch, `s${++n}`);
  const root = join(dir, "worktree") as AbsolutePath;
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", ...args])
      .toString()
      .trim();
  git("init", "-q");
  git("add", ".");
  git("commit", "-q", "-m", "first");
  const ssh = fakeSshAt(dir);
  const target: SshTarget = {
    destination: "node@box",
    env: { ...process.env, PATH: `${ssh.bin}:${process.env.PATH}` },
  };
  const remote = join(ssh.home, TREE, "root");
  const there = (...args: string[]) => execFileSync("git", ["-C", remote, ...args]).toString();
  return { root, git, ssh, target, remote, there };
}

/** Every file under `root` but `.git`, sorted. */
function filesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .filter((path) => !path.startsWith(".git/"))
    .sort();
}

/** The tree host's sync of a connect, as `remoteHostOver` makes it. */
async function connectSync(root: AbsolutePath, remote: string): Promise<void> {
  const host = createTreeHost(remote, () => {});
  const entries = await treeEntries(root);
  const { missing } = await host.tree(entries);
  const paths = new Set(entries.map((entry) => entry.path));
  for (const write of await writesFor(root, missing, paths)) await host.write(write);
}

const FILES = {
  "src/keep.ts": "export const keep = 1;\n",
  "test/keep.test.ts": "import '../src/keep';\n",
  "test/deleted.test.ts": "import '../src/keep';\n",
  "data/table.json": "[1, 2, 3]\n",
};

describe("the git-bundle bootstrap writes no working-tree file (review 0.1.619 B2)", () => {
  it("leaves a tracked test and a tracked data file deleted here absent there after the first connect", async () => {
    const s = setup(FILES);
    unlinkSync(join(s.root, "test/deleted.test.ts"));
    unlinkSync(join(s.root, "data/table.json"));
    writeFileSync(join(s.root, "src/keep.ts"), "export const keep = 2;\n");
    const got = await ensureGitTree(s.target, TREE, s.root, BOOTSTRAP_DEADLINES);
    expect(got.kind).toBe("sent");
    expect(filesUnder(s.remote)).toEqual([]);
    await connectSync(s.root, s.remote);
    expect(existsSync(join(s.remote, "test/deleted.test.ts"))).toBe(false);
    expect(existsSync(join(s.remote, "data/table.json"))).toBe(false);
    expect(filesUnder(s.remote)).toEqual(filesUnder(s.root));
    expect(filesUnder(s.remote)).toEqual(["src/keep.ts", "test/keep.test.ts"]);
    expect(readFileSync(join(s.remote, "src/keep.ts"), "utf8")).toBe("export const keep = 2;\n");
    // Planning there lists what planning here lists; Git there sees what Git here sees.
    expect(await treePaths(s.remote as AbsolutePath)).toEqual(await treePaths(s.root));
    const status = execFileSync("git", ["-C", s.root, "status", "--porcelain"]).toString();
    expect(s.there("status", "--porcelain")).toBe(status);
  });
});

describe("a reused tree's .git follows the worktree's Git state (review 0.1.619 B3)", () => {
  const unpacks = (s: ReturnType<typeof setup>) =>
    s.ssh.argv().filter((argv) => argv.at(-1)?.includes("bundle unbundle") === true).length;

  it("sends nothing when HEAD, its branch and the tags are unchanged", async () => {
    const s = setup(FILES);
    s.git("tag", "v1");
    expect((await ensureGitTree(s.target, TREE, s.root, BOOTSTRAP_DEADLINES)).kind).toBe("sent");
    const before = s.ssh.argv().length;
    const again = await ensureGitTree(s.target, TREE, s.root, BOOTSTRAP_DEADLINES);
    expect(again).toMatchObject({ kind: "present", commit: s.git("rev-parse", "HEAD") });
    expect(s.ssh.argv().length - before).toBe(1);
    expect(unpacks(s)).toBe(1);
  });

  it("brings a new commit and added, moved and deleted tags there without a working-tree write", async () => {
    const s = setup(FILES);
    s.git("tag", "v1");
    s.git("tag", "old");
    s.git("tag", "-a", "-m", "first", "ann");
    await ensureGitTree(s.target, TREE, s.root, BOOTSTRAP_DEADLINES);
    writeFileSync(join(s.root, "src/keep.ts"), "export const keep = 'dirty';\n");
    await connectSync(s.root, s.remote);
    writeFileSync(join(s.root, "src/new.ts"), "export const fresh = 1;\n");
    s.git("add", "src/new.ts");
    s.git("commit", "-q", "-m", "second");
    s.git("tag", "v2");
    s.git("tag", "-f", "v1");
    s.git("tag", "-f", "-a", "-m", "moved", "ann");
    s.git("tag", "-d", "old");
    const got = await ensureGitTree(s.target, TREE, s.root, BOOTSTRAP_DEADLINES);
    expect(got).toMatchObject({ kind: "sent", commit: s.git("rev-parse", "HEAD") });
    expect(s.there("rev-parse", "HEAD").trim()).toBe(s.git("rev-parse", "HEAD"));
    expect(s.there("symbolic-ref", "HEAD").trim()).toBe(s.git("symbolic-ref", "HEAD"));
    expect(s.there("show-ref", "--tags").trim()).toBe(s.git("show-ref", "--tags"));
    expect(s.there("ls-files", "-s").trim()).toBe(s.git("ls-files", "-s"));
    // The synced dirty file stays; the commit's new file waits for the tree host.
    expect(readFileSync(join(s.remote, "src/keep.ts"), "utf8")).toBe(
      "export const keep = 'dirty';\n",
    );
    expect(existsSync(join(s.remote, "src/new.ts"))).toBe(false);
    expect(unpacks(s)).toBe(2);
  });

  it("follows an amend, a branch switch, a detached HEAD and a history it never had", async () => {
    const s = setup(FILES);
    await ensureGitTree(s.target, TREE, s.root, BOOTSTRAP_DEADLINES);
    const same = () => ({
      head: s.there("rev-parse", "HEAD").trim(),
      ref: s.there("rev-parse", "--symbolic-full-name", "HEAD").trim(),
    });
    const here = () => ({
      head: s.git("rev-parse", "HEAD"),
      ref: s.git("rev-parse", "--symbolic-full-name", "HEAD"),
    });
    s.git("commit", "-q", "--amend", "-m", "amended");
    await ensureGitTree(s.target, TREE, s.root, BOOTSTRAP_DEADLINES);
    expect(same()).toEqual(here());
    s.git("checkout", "-q", "-b", "topic");
    await ensureGitTree(s.target, TREE, s.root, BOOTSTRAP_DEADLINES);
    expect(same()).toEqual({ ...here(), ref: "refs/heads/topic" });
    s.git("checkout", "-q", "--detach");
    await ensureGitTree(s.target, TREE, s.root, BOOTSTRAP_DEADLINES);
    expect(same()).toEqual({ ...here(), ref: "HEAD" });
    // Another worktree's history there: its HEAD is no commit here, so the whole history comes.
    const other = setup({ "x.ts": "x\n" });
    await ensureGitTree(s.target, TREE, other.root, BOOTSTRAP_DEADLINES);
    expect(same().head).toBe(other.git("rev-parse", "HEAD"));
    await ensureGitTree(s.target, TREE, s.root, BOOTSTRAP_DEADLINES);
    expect(same()).toEqual({ ...here(), ref: "HEAD" });
  });

  it("is none for a worktree with no commit yet", async () => {
    const s = setup(FILES);
    const empty = join(scratch, `empty${++n}`);
    execFileSync("git", ["init", "-q", empty]);
    expect(await ensureGitTree(s.target, TREE, empty, BOOTSTRAP_DEADLINES)).toEqual({
      kind: "none",
      why: "the worktree has no commit yet",
    });
  });
});

describe("a machine's git keeper (review 0.1.619 B3)", () => {
  async function kept() {
    const s = setup(FILES);
    const got = await ensureGitTree(s.target, TREE, s.root, BOOTSTRAP_DEADLINES);
    if (got.kind === "none") throw new Error(got.why);
    const log: string[] = [];
    const keeper = gitKeeper(
      { tree: TREE, root: s.root, deadlines: BOOTSTRAP_DEADLINES, log: (l) => log.push(l) },
      got.state,
    );
    return { s, keeper, log };
  }

  it("answers with no SSH call while the worktree's Git state is unchanged", async () => {
    const { s, keeper } = await kept();
    const before = s.ssh.argv().length;
    expect(await keeper.sync(null)).toBe(true);
    expect(await keeper.sync(s.target)).toBe(true);
    expect(keeper.current()).toBe(true);
    expect(s.ssh.argv().length).toBe(before);
  });

  it("is not current after a commit here until a sync brings it there", async () => {
    const { s, keeper, log } = await kept();
    s.git("commit", "-q", "--allow-empty", "-m", "second");
    expect(await keeper.sync(null)).toBe(false);
    expect(keeper.current()).toBe(false);
    expect(await keeper.sync(s.target)).toBe(true);
    expect(s.there("rev-parse", "HEAD").trim()).toBe(s.git("rev-parse", "HEAD"));
    expect(log).toEqual([`node@box: git history brought to ${s.git("rev-parse", "HEAD")}`]);
  });

  it("is not current when its sync fails, and says why", async () => {
    const { s, keeper, log } = await kept();
    s.git("tag", "v9");
    const broken: SshTarget = { ...s.target, ssh: join(scratch, "no-such-ssh") };
    expect(await keeper.sync(broken)).toBe(false);
    expect(keeper.current()).toBe(false);
    expect(log[0]).toMatch(/^node@box: git history not brought current: /);
    // The worktree's state unchanged since: still not current, until a sync succeeds.
    expect(await keeper.sync(null)).toBe(false);
    expect(await keeper.sync(s.target)).toBe(true);
  });
});
