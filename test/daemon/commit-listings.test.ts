import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { heldAt } from "../../src/core/commit/held.js";
import { listingsHeld } from "../../src/core/daemon/commit-listings.js";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { onCleanUp } from "../scheduler/cleanup.js";

/*
 * Row 023-64 (spec 023 D4.9 in the commit daemon): a folder read is held at
 * the commit when the commit worktree lists on disk exactly the names the
 * commit tracks there, resolved through links inside the worktree.
 */

function git(root: string, ...args: string[]): string {
  return execFileSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
    { cwd: root, encoding: "utf8" },
  );
}

/** A repository with a tracked folder, a link to it, a link out, and a committed HEAD. */
function repo(): { root: AbsolutePath; outside: string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "sq-listings-"))) as AbsolutePath;
  onCleanUp(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, "main") as AbsolutePath;
  const outside = join(dir, "outside");
  const files: Record<string, string> = {
    ".gitignore": "*.log\n",
    "rules/a.yml": "a\n",
    "rules/deep/b.yml": "b\n",
    "plain.txt": "p\n",
  };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(outside);
  writeFileSync(join(outside, "x.yml"), "x\n");
  symlinkSync("rules", join(root, "linked"));
  symlinkSync("rules/deep", join(root, "deeplink"));
  symlinkSync(outside, join(root, "away"));
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "a");
  return { root, outside };
}

async function held(root: AbsolutePath) {
  return listingsHeld(root, (await heldAt(root, "HEAD")).blobs);
}

describe("listingsHeld (row 023-64)", () => {
  it("holds a folder listed as the commit tracks it, plain, nested or through a link inside", async () => {
    const { root } = repo();
    const listed = await held(root);
    expect(listed("rules/")).toBe(true);
    expect(listed("rules/deep/")).toBe(true);
    expect(listed("linked/")).toBe(true);
    expect(listed("linked/deep/")).toBe(true);
  });

  it("refuses an extra name, a missing name, a link out of the tree, a file path and an untracked folder", async () => {
    const { root } = repo();
    // The root lists `.git`, which no commit tracks.
    expect((await held(root))("./")).toBe(false);
    expect((await held(root))("away/")).toBe(false);
    expect((await held(root))("plain.txt")).toBe(false);
    expect((await held(root))("rules")).toBe(false);
    mkdirSync(join(root, "made"));
    expect((await held(root))("made/")).toBe(false);
    writeFileSync(join(root, "rules/extra.log"), "ignored\n");
    expect((await held(root))("rules/")).toBe(false);
    expect((await held(root))("linked/")).toBe(false);
    rmSync(join(root, "rules/extra.log"));
    rmSync(join(root, "rules/a.yml"));
    expect((await held(root))("rules/")).toBe(false);
    expect((await held(root))("rules/deep/")).toBe(true);
  });

  it("walks a parent step after a link on disk, not by its spelling (review 0.1.610 S1)", async () => {
    const { root } = repo();
    const listed = await held(root);
    // `deeplink` is `rules/deep`; its `..` is `rules/`, so the path reaches
    // `rules/rules/`, which does not exist. Lexically it would read `rules/`.
    expect(listed("deeplink/../rules/")).toBe(false);
    // Its `..` alone is `rules/` on disk, held; lexically the root, refused.
    expect(listed("deeplink/../")).toBe(true);
    expect(listed("rules/deep/../")).toBe(true);
    expect(listed("rules/./deep/")).toBe(true);
  });
});
