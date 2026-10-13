import { existsSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../../src/cli/main.js";
import { git } from "../../hash/git-repo.js";
import { capture, cleanupFixtures, harnessEnv, squealShaped, VITEST_GATE } from "./fixture.js";

/*
 * Spec 005 D3 step 5, row 005-28 (`reviews/wave-2.md` S1): setup shows the
 * diff of every instruction file it wrote and names what to commit, a file
 * new to Git included, each once. A new file is shown read-only, never staged.
 */

afterEach(cleanupFixtures);

/** `squealShaped()` with `CLAUDE.md` and its `AGENTS.md` symlink removed and committed. */
function withoutInstructions(): string {
  const root = squealShaped();
  git(root, ["rm", "-q", "CLAUDE.md", "AGENTS.md"]);
  git(root, ["commit", "-q", "-m", "no instructions"]);
  return root;
}

async function setupYes(root: string, harnesses: readonly ("claude" | "codex")[]) {
  const { io, out } = capture(root, harnessEnv(harnesses));
  const code = await main(["setup", "--yes", "--no-warmup"], io);
  expect(out.stderr).toBe("");
  expect(code).toBe(0);
  const changes = out.stdout.slice(out.stdout.indexOf("\nChanges:\n"));
  const listed = changes.split("squeal setup never commits:\n")[1] ?? "";
  return {
    changes,
    /** The commit list, one path per line. */
    commit: [...listed.matchAll(/^ {2}(\S+)$/gm)].map(([, path]) => path),
  };
}

const read = (root: string, path: string) => readFileSync(join(root, path), "utf8");
const count = (text: string, part: string) => text.split(part).length - 1;

describe("squeal setup shows a new instruction file", () => {
  it("shows and lists a fresh repository's new AGENTS.md once", async () => {
    const root = withoutInstructions();
    const { changes, commit } = await setupYes(root, ["claude"]);
    expect(read(root, "AGENTS.md")).toContain("<!-- squeal:begin v1");
    expect(count(changes, "diff --git a/AGENTS.md b/AGENTS.md\nnew file mode 100644\n")).toBe(1);
    expect(changes).toContain("+<!-- squeal:begin v1");
    expect(commit).toEqual(["squeal.config.json", ".claude/settings.json", "AGENTS.md"]);
    // Read-only: nothing staged.
    expect(git(root, ["diff", "--cached", "--name-only"])).toBe("");
  });

  it("shows and lists separate CLAUDE.md and AGENTS.md, each new, once", async () => {
    const root = withoutInstructions();
    writeFileSync(join(root, "CLAUDE.md"), "# Agents\n");
    const { changes, commit } = await setupYes(root, ["claude", "codex"]);
    expect(read(root, "CLAUDE.md")).toContain("<!-- squeal:begin v1");
    expect(read(root, "AGENTS.md")).toContain("<!-- squeal:begin v1");
    expect(count(changes, "diff --git a/CLAUDE.md b/CLAUDE.md\n")).toBe(1);
    expect(count(changes, "diff --git a/AGENTS.md b/AGENTS.md\n")).toBe(1);
    expect(commit.filter((p) => p === "CLAUDE.md" || p === "AGENTS.md").sort()).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
    ]);
    expect(new Set(commit).size).toBe(commit.length);
    expect(git(root, ["diff", "--cached", "--name-only"])).toBe("");
  });

  it("shows a tracked CLAUDE.md's change and a new AGENTS.md beside it, each once", async () => {
    const root = squealShaped({ "AGENTS.md": "# Codex\n" });
    git(root, ["rm", "-q", "AGENTS.md"]);
    git(root, ["commit", "-q", "-m", "no AGENTS.md"]);
    const { changes, commit } = await setupYes(root, ["claude", "codex"]);
    expect(read(root, "CLAUDE.md")).toContain(VITEST_GATE.slice(0, 20));
    expect(count(changes, "diff --git a/CLAUDE.md b/CLAUDE.md\n")).toBe(1);
    expect(count(changes, "diff --git a/AGENTS.md b/AGENTS.md\nnew file mode")).toBe(1);
    expect(commit.filter((p) => p === "CLAUDE.md").length).toBe(1);
    expect(commit.filter((p) => p === "AGENTS.md").length).toBe(1);
  });

  it("shows and lists a new symlinked pair once each, the block once", async () => {
    const root = withoutInstructions();
    symlinkSync("CLAUDE.md", join(root, "AGENTS.md"));
    const { changes, commit } = await setupYes(root, ["claude", "codex"]);
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(true);
    expect(count(changes, "+<!-- squeal:begin v1")).toBe(1);
    expect(count(changes, "diff --git a/CLAUDE.md b/CLAUDE.md\nnew file mode 100644\n")).toBe(1);
    expect(count(changes, "diff --git a/AGENTS.md b/AGENTS.md\nnew file mode 120000\n")).toBe(1);
    expect(commit.filter((p) => p === "CLAUDE.md" || p === "AGENTS.md").sort()).toEqual([
      "AGENTS.md",
      "CLAUDE.md",
    ]);
    expect(new Set(commit).size).toBe(commit.length);
  });

  it("shows a new CLAUDE.md behind a tracked AGENTS.md symlink once", async () => {
    const root = squealShaped();
    git(root, ["rm", "-q", "CLAUDE.md"]);
    git(root, ["commit", "-q", "-m", "dangling AGENTS.md"]);
    const { changes, commit } = await setupYes(root, ["claude"]);
    expect(count(changes, "+<!-- squeal:begin v1")).toBe(1);
    expect(count(changes, "diff --git a/CLAUDE.md b/CLAUDE.md\nnew file mode 100644\n")).toBe(1);
    expect(changes).not.toContain("diff --git a/AGENTS.md");
    expect(commit.filter((p) => p === "CLAUDE.md").length).toBe(1);
    expect(commit).not.toContain("AGENTS.md");
  });
});
