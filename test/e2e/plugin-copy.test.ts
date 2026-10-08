import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { copyPlugin } from "./plugins.js";

/*
 * Board row 002-24: the e2e files are keyed by worktree content
 * (`squeal.config.json` declares `plugins/**` for them), so the plugin they
 * run is the worktree's tracked files, not `HEAD`'s. A version raise run
 * before its commit then stores results under the keys of what ran.
 */

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, args: readonly string[]) =>
  execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** A repository with a committed `plugins/codex`, then edited in its worktree. */
function repo(): string {
  const root = realpathSync(mkdtempSync("/tmp/squeal-plugin-copy-"));
  scratch.push(root);
  write(root, "plugins/codex/package.json", '{"version":"1.0.0"}\n');
  write(root, "plugins/codex/dist/cli/squeal.mjs", "// cli\n");
  chmodSync(join(root, "plugins/codex/dist/cli/squeal.mjs"), 0o755);
  write(root, "plugins/codex/gone.txt", "deleted in the worktree\n");
  write(root, "plugins/other/keep.txt", "another plugin\n");
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["add", "-A"]);
  git(root, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "plugins"]);
  // A version raise not yet committed, a deleted tracked file and an untracked one.
  write(root, "plugins/codex/package.json", '{"version":"1.0.1"}\n');
  rmSync(join(root, "plugins/codex/gone.txt"));
  write(root, "plugins/codex/untracked.txt", "never committed\n");
  return root;
}

describe("copyPlugin (002-24)", () => {
  it("copies the worktree content of the tracked files, as a commit of it would ship", () => {
    const root = repo();
    const dest = join(root, "copy");
    copyPlugin("codex", dest, root);

    expect(readFileSync(join(dest, "package.json"), "utf8")).toBe('{"version":"1.0.1"}\n');
    expect(readFileSync(join(dest, "dist/cli/squeal.mjs"), "utf8")).toBe("// cli\n");
    expect(statSync(join(dest, "dist/cli/squeal.mjs")).mode & 0o111).not.toBe(0);
    expect(existsSync(join(dest, "gone.txt"))).toBe(false);
    expect(existsSync(join(dest, "untracked.txt"))).toBe(false);
    expect(existsSync(join(dest, "keep.txt"))).toBe(false);
  });
});
