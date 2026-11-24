import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createTreeHost } from "../../../src/core/runner-host/remote/tree-host.js";
import { treeBlob } from "../../../src/core/runner-host/remote/tree-wire.js";

const scratch = mkdtempSync(join(tmpdir(), "squeal-tree-git-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let seq = 0;
function makeGitRemote(): { root: string; git: (...args: string[]) => string } {
  const root = join(scratch, `g${++seq}`, "root");
  mkdirSync(root, { recursive: true });
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@t", ...args])
      .toString()
      .trim();
  git("init", "-q");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "bin"), { recursive: true });
  writeFileSync(join(root, "src/clean.ts"), "export const clean = 1;\n");
  writeFileSync(join(root, "src/deleted.ts"), "export const deleted = 1;\n");
  writeFileSync(join(root, "bin/run"), "#!/bin/sh\necho hi\n");
  chmodSync(join(root, "bin/run"), 0o755);
  symlinkSync("src/clean.ts", join(root, "alias.ts"));
  git("add", ".");
  git("commit", "-q", "-m", "init");
  // Leave only `.git`, just as `ensureGitTree` leaves a fresh remote tree.
  rmSync(join(root, "src"), { recursive: true, force: true });
  rmSync(join(root, "bin"), { recursive: true, force: true });
  rmSync(join(root, "alias.ts"), { force: true });
  return { root, git };
}

describe("remote tree materialization from .git", () => {
  it("materializes clean files, executables and symlinks from .git and returns only dirty/untracked as missing", async () => {
    const { root } = makeGitRemote();
    const host = createTreeHost(root, () => {});
    const cleanBytes = Buffer.from("export const clean = 1;\n");
    const runBytes = Buffer.from("#!/bin/sh\necho hi\n");
    const linkBytes = Buffer.from("src/clean.ts");
    const dirtyBytes = Buffer.from("export const dirty = 2;\n");

    const answer = await host.tree([
      { path: "src/clean.ts", blob: treeBlob(cleanBytes) },
      { path: "bin/run", blob: treeBlob(runBytes), mode: "x" },
      { path: "alias.ts", blob: treeBlob(linkBytes), mode: "link" },
      { path: "src/dirty.ts", blob: treeBlob(dirtyBytes) },
    ]);

    expect(answer.missing).toEqual(["src/dirty.ts"]);
    expect(readFileSync(join(root, "src/clean.ts"), "utf8")).toBe("export const clean = 1;\n");
    expect(statSync(join(root, "bin/run")).mode & 0o111).not.toBe(0);
    expect(readlinkSync(join(root, "alias.ts"))).toBe("src/clean.ts");
    // A committed file omitted from `entries` (deleted locally) is never materialized.
    expect(existsSync(join(root, "src/deleted.ts"))).toBe(false);

    // Materialized files are recorded in `files.json` so removing them from `entries` deletes them.
    const next = await host.tree([{ path: "bin/run", blob: treeBlob(runBytes), mode: "x" }]);
    expect(next.missing).toEqual([]);
    expect(existsSync(join(root, "src/clean.ts"))).toBe(false);
    expect(existsSync(join(root, "alias.ts"))).toBe(false);
    expect(existsSync(join(root, "bin/run"))).toBe(true);
  });
});
