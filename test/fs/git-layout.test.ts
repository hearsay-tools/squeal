import { createHash } from "node:crypto";
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findWorktreeRoot,
  gitDirOf,
  hasGitEntry,
  linkedWorktreeDir,
  resolveCommonDir,
  worktreeIdFor,
} from "../../src/core/fs/index.js";
import { tempDir } from "../store/helpers.js";

describe("worktreeIdFor", () => {
  it("is the first 16 hex chars of sha256 of the realpath", () => {
    const root = tempDir();
    const expected = createHash("sha256").update(realpathSync(root)).digest("hex").slice(0, 16);
    expect(worktreeIdFor(root)).toBe(expected);
    expect(worktreeIdFor(root)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("resolves symlinks so two spellings of one worktree share an id", () => {
    const base = tempDir();
    const real = join(base, "real");
    mkdirSync(real);
    symlinkSync(real, join(base, "link"));
    expect(worktreeIdFor(join(base, "link"))).toBe(worktreeIdFor(real));
  });
});

describe("resolveCommonDir (spec 001 D1, without git)", () => {
  it("returns <root>/.git when it is a directory", () => {
    const root = tempDir();
    mkdirSync(join(root, ".git"));
    expect(resolveCommonDir(root)).toBe(realpathSync(join(root, ".git")));
  });

  it("follows a .git file and the gitdir's relative commondir", () => {
    const main = tempDir();
    const gitdir = join(main, ".git", "worktrees", "feature");
    mkdirSync(gitdir, { recursive: true });
    writeFileSync(join(gitdir, "commondir"), "../..\n");
    const linked = tempDir();
    writeFileSync(join(linked, ".git"), `gitdir: ${gitdir}\n`);
    expect(resolveCommonDir(linked)).toBe(realpathSync(join(main, ".git")));
  });

  it("resolves a relative gitdir against the worktree root", () => {
    const base = tempDir();
    const gitdir = join(base, "main", ".git", "worktrees", "nested");
    mkdirSync(gitdir, { recursive: true });
    writeFileSync(join(gitdir, "commondir"), "../..");
    const linked = join(base, "main", "nested");
    mkdirSync(linked);
    writeFileSync(join(linked, ".git"), "gitdir: ../.git/worktrees/nested");
    expect(resolveCommonDir(linked)).toBe(realpathSync(join(base, "main", ".git")));
  });

  it("uses an absolute commondir as is", () => {
    const base = tempDir();
    const common = join(base, "bare.git");
    const gitdir = join(common, "worktrees", "w");
    mkdirSync(gitdir, { recursive: true });
    writeFileSync(join(gitdir, "commondir"), common);
    const linked = join(base, "w");
    mkdirSync(linked);
    writeFileSync(join(linked, ".git"), `gitdir: ${gitdir}`);
    expect(resolveCommonDir(linked)).toBe(realpathSync(common));
  });

  it("treats a gitdir without commondir as its own common dir (submodule)", () => {
    const base = tempDir();
    const gitdir = join(base, "super", ".git", "modules", "sub");
    mkdirSync(gitdir, { recursive: true });
    const sub = join(base, "super", "sub");
    mkdirSync(sub);
    writeFileSync(join(sub, ".git"), `gitdir: ${gitdir}`);
    expect(resolveCommonDir(sub)).toBe(realpathSync(gitdir));
  });

  it("returns null without a .git entry, a malformed .git file, or a dangling gitdir", () => {
    const none = tempDir();
    expect(resolveCommonDir(none)).toBeNull();

    const malformed = tempDir();
    writeFileSync(join(malformed, ".git"), "not a gitdir line\n");
    expect(resolveCommonDir(malformed)).toBeNull();

    const dangling = tempDir();
    writeFileSync(join(dangling, ".git"), `gitdir: ${join(dangling, "missing")}`);
    expect(resolveCommonDir(dangling)).toBeNull();
  });
});

describe("gitDirOf", () => {
  it("is <root>/.git when it is a directory", () => {
    const root = tempDir();
    mkdirSync(join(root, ".git"));
    expect(gitDirOf(root)).toBe(join(root, ".git"));
    expect(linkedWorktreeDir(root)).toBeNull();
  });

  it("follows a .git file's gitdir, relative to the root, without checking it exists", () => {
    const root = tempDir();
    writeFileSync(join(root, ".git"), "gitdir:  ../main/.git/worktrees/w  \n");
    const expected = join(root, "..", "main", ".git", "worktrees", "w");
    expect(gitDirOf(root)).toBe(expected);
    expect(linkedWorktreeDir(root)).toBe(expected);
  });

  it("is null without a .git entry, for a malformed .git file, and for a symlinked .git", () => {
    expect(gitDirOf(tempDir())).toBeNull();

    const malformed = tempDir();
    writeFileSync(join(malformed, ".git"), "not a gitdir line\n");
    expect(gitDirOf(malformed)).toBeNull();
    expect(linkedWorktreeDir(malformed)).toBeNull();

    const linked = tempDir();
    mkdirSync(join(linked, "real"));
    symlinkSync(join(linked, "real"), join(linked, ".git"));
    expect(gitDirOf(linked)).toBeNull();
  });
});

describe("findWorktreeRoot (spec 001 D1)", () => {
  it("is the nearest ancestor with a .git entry, file or directory", async () => {
    const main = realpathSync(tempDir());
    mkdirSync(join(main, ".git"));
    const nested = join(main, "packages", "nested");
    mkdirSync(join(nested, "src"), { recursive: true });
    writeFileSync(join(nested, ".git"), "gitdir: ../../.git/modules/nested\n");

    expect(findWorktreeRoot(join(main, "packages"))).toBe(main);
    expect(findWorktreeRoot(join(nested, "src", "missing.ts"))).toBe(nested);
    expect(await hasGitEntry(nested)).toBe(true);
    expect(await hasGitEntry(join(main, "packages"))).toBe(false);
  });

  it("resolves symlinks in the starting path", () => {
    const base = realpathSync(tempDir());
    const real = join(base, "real");
    mkdirSync(join(real, ".git"), { recursive: true });
    symlinkSync(real, join(base, "link"));
    expect(findWorktreeRoot(join(base, "link"))).toBe(real);
  });
});
