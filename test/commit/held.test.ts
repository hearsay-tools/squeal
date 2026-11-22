import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { needsOf } from "../../src/cli/status-at-run-select.js";
import { heldAt, parseBatch } from "../../src/core/commit/held.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { onCleanUp } from "../scheduler/cleanup.js";

/*
 * Row 023-48 (round 6 V1): D4.9 holds a path under a tracked symlink as
 * the link resolves at the commit's tree. Round 6: `.agents/skills/a` was a
 * tracked directory link to `../../.ai/skills/a`, and a test that read
 * `.agents/skills/a/SKILL.md` was refused "not comparable (needs …)".
 */

function git(root: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
    { cwd: root, encoding: "utf8" },
  );
}

function repo(): AbsolutePath {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "sq-held-"))) as AbsolutePath;
  onCleanUp(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, "main") as AbsolutePath;
  const files: Record<string, string> = {
    ".ai/skills/a/SKILL.md": "a\n",
    "plain.txt": "p\n",
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  writeFileSync(join(dir, "outside.md"), "o\n");
  mkdirSync(join(root, ".agents/skills"), { recursive: true });
  symlinkSync("../../.ai/skills/a", join(root, ".agents/skills/a"));
  symlinkSync("skills/a", join(root, ".agents/chain"));
  symlinkSync("..", join(root, ".agents/up"));
  symlinkSync("../..", join(root, ".agents/out"));
  symlinkSync(dir, join(root, ".agents/absolute"));
  symlinkSync("../gone", join(root, ".agents/dangling"));
  symlinkSync("loop", join(root, ".agents/loop"));
  git(root, "init", "-q", "-b", "main");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "A");
  return root;
}

describe("heldAt (row 023-48, V1)", () => {
  it("holds a path under a tracked directory symlink and refuses one that leaves the tree", async () => {
    const root = repo();
    const held = await heldAt(root, "HEAD");
    expect(held.has(".ai/skills/a/SKILL.md")).toBe(true);
    expect(held.has(".agents/skills/a")).toBe(true); // the link's own blob
    expect(held.has(".agents/skills/a/SKILL.md")).toBe(true);
    expect(held.has(".agents/chain/SKILL.md")).toBe(true); // a link to a link
    expect(held.has(".agents/up/plain.txt")).toBe(true);
    // Each of these exists on disk through its link, and none is the commit's.
    expect(held.has(".agents/out/outside.md")).toBe(false);
    expect(held.has(".agents/absolute/outside.md")).toBe(false);
    expect(held.has(".agents/skills/a/missing.md")).toBe(false);
    expect(held.has(".agents/dangling/x")).toBe(false);
    expect(held.has(".agents/loop/x")).toBe(false);
    expect(held.has("plain.txt/x")).toBe(false);
    // A folder read through the link stays a folder: no blob (review 0.1.597 B1).
    expect(held.has(".agents/skills/a/")).toBe(false);
  });

  it("needsOf gives no reason for a read through a tracked link, and one for a read that leaves", async () => {
    const root = repo();
    const needs = await needsOf({ root, commit: "HEAD", tree: root });
    const file = (loads: string[]) =>
      ({ ref: { project: "", path: "t.test.ts" }, at: { key: "k", loads } }) as never;
    expect(needs(file([".agents/skills/a/SKILL.md", ".agents/chain/SKILL.md"]))).toBeNull();
    expect(needs(file([".agents/skills/a/SKILL.md", ".agents/out/outside.md"]))).toBe(
      ".agents/out/outside.md",
    );
  });

  it("parses a batch with a missing object and multibyte content", () => {
    const out = Buffer.from("aa blob 4\nzółw\nbb missing\ncc blob 3\nx/y\n", "utf8");
    // "zółw" is 6 bytes; the size counts bytes.
    const fixed = Buffer.from(out.toString("utf8").replace("blob 4", "blob 6"), "utf8");
    expect(parseBatch(fixed)).toEqual(
      new Map([
        ["aa", "zółw"],
        ["cc", "x/y"],
      ]),
    );
  });
});
