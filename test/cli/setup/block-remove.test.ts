import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../../src/cli/main.js";
import { git } from "../../hash/git-repo.js";
import { capture, cleanupFixtures, squealShaped } from "./fixture.js";

/*
 * Spec 005 D4, row 005-24 (review `reviews/wave-1.md` B3): every block
 * destination `init --block` accepts is one `squeal remove` takes out or
 * lists under "Still there".
 */

afterEach(cleanupFixtures);

const read = (root: string, path: string) => readFileSync(join(root, path), "utf8");

async function run(root: string, args: readonly string[]) {
  const { io, out } = capture(root);
  const code = await main(args, io);
  return { code, ...out };
}

describe("a block in a nested instruction file", () => {
  it("init writes it and remove takes it out, untracked or tracked", async () => {
    const root = squealShaped();
    mkdirSync(join(root, "docs"));
    const written = await run(root, ["init", "--block", "docs/AGENTS.md"]);
    expect(written.code).toBe(0);
    expect(read(root, "docs/AGENTS.md")).toContain("<!-- squeal:begin v1");

    const removed = await run(root, ["remove"]);
    expect(removed.code).toBe(0);
    expect(existsSync(join(root, "docs/AGENTS.md"))).toBe(false);
    expect(removed.stdout).toContain(
      `  ${join(root, "docs/AGENTS.md")} (it held only the Squeal block: the deletion is a change to commit)`,
    );

    const original = "# Docs\r\n\r\nKeep this instruction.\r\n";
    writeFileSync(join(root, "docs/CLAUDE.md"), original);
    git(root, ["add", "docs/CLAUDE.md"]);
    git(root, ["commit", "-q", "-m", "docs"]);
    expect((await run(root, ["init", "--block", "docs/CLAUDE.md"])).code).toBe(0);
    expect(read(root, "docs/CLAUDE.md")).toContain("<!-- squeal:begin v1");
    expect((await run(root, ["remove"])).code).toBe(0);
    expect(read(root, "docs/CLAUDE.md")).toBe(original);
  });

  it("remove lists an unterminated nested block under Still there and exits 3", async () => {
    const root = squealShaped();
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs/AGENTS.md"), "# Docs\n\n<!-- squeal:begin v1 -->\nhalf\n");
    const stuck = await run(root, ["remove"]);
    expect(stuck.code).toBe(3);
    expect(stuck.stdout).toContain(
      `Still there:\n  ${join(root, "docs/AGENTS.md")}: its Squeal block begins at line 3 with no end marker; delete it by hand`,
    );
    expect(read(root, "docs/AGENTS.md")).toContain("half");
  });

  it("removes a block once when a nested symlink and its target both hold it", async () => {
    const root = squealShaped();
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs/CLAUDE.md"), "# Docs\n");
    symlinkSync("CLAUDE.md", join(root, "docs/AGENTS.md"));
    expect((await run(root, ["init", "--block", "docs/AGENTS.md"])).code).toBe(0);
    const removed = await run(root, ["remove"]);
    expect(removed.code).toBe(0);
    expect(read(root, "docs/CLAUDE.md")).toBe("# Docs\n");
    expect(removed.stdout.split(`${join(root, "docs/CLAUDE.md")}: the Squeal block`)).toHaveLength(
      2,
    );
  });
});

describe("a block destination remove could not find", () => {
  it("is refused before anything is written", async () => {
    const root = squealShaped({ ".gitignore": "node_modules/\ndist/\nbuild/\n" });
    mkdirSync(join(root, "docs"));
    mkdirSync(join(root, "build"));
    const cases: [string, string][] = [
      ["docs/notes.md", 'squeal remove could not find a block in "docs/notes.md"'],
      ["README.md", 'squeal remove could not find a block in "README.md"'],
      ["build/AGENTS.md", 'squeal remove could not find a block in "build/AGENTS.md"'],
    ];
    for (const [path, message] of cases) {
      const { code, stderr } = await run(root, ["init", "--block", path]);
      expect(code, path).toBe(1);
      expect(stderr).toContain(message);
      expect(stderr).toMatch(/; nothing changed\n$/);
      expect(existsSync(join(root, path)), path).toBe(false);
    }
    expect(existsSync(join(root, ".claude", "settings.json"))).toBe(false);
  });

  it("still accepts an ignored CLAUDE.local.md at the root, which remove checks by name", async () => {
    const root = squealShaped({ ".gitignore": "node_modules/\ndist/\nCLAUDE.local.md\n" });
    expect((await run(root, ["init", "--block", "CLAUDE.local.md"])).code).toBe(0);
    expect((await run(root, ["remove"])).code).toBe(0);
    expect(existsSync(join(root, "CLAUDE.local.md"))).toBe(false);
  });
});
