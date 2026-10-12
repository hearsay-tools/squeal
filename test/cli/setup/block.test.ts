import { lstatSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../../src/cli/main.js";
import {
  BLOCK_VERSION,
  blockText,
  withBlock,
  withoutBlock,
  writeBlockFile,
} from "../../../src/cli/setup/block.js";
import { buildPlan } from "../../../src/cli/setup/plan.js";
import { capture, cleanupFixtures, harnessEnv, squealShaped, VITEST_GATE } from "./fixture.js";

/* Spec 005 D4, row 005-12: the instruction block, written, replaced, refused and removed. */

afterEach(cleanupFixtures);

const D4 = `<!-- squeal:begin v1 (managed by Squeal setup; edits inside are replaced) -->
## Tests

Squeal runs the Vitest tests after each edit. Before you say the work is done, run \`squeal status --wait 60000\` (or the command the SQUEAL messages name) and report its known failures and pending checks instead of running Vitest. If you have seen no SQUEAL message in this session, run \`npx vitest run\` instead. Where this file's verification steps name a test command, they take precedence.
<!-- squeal:end -->
`;

const plan = (root: string) => buildPlan(root, { env: harnessEnv() });

describe("the block's text", () => {
  it("is D4's text at version 1 for a Vitest repository", () => {
    expect(BLOCK_VERSION).toBe(1);
    expect(blockText()).toBe(D4);
  });

  it("names the runners as the primer does", () => {
    expect(blockText({ vitest: true, nodeTest: true })).toContain(
      "Squeal runs the Vitest and node:test tests after each edit.",
    );
    const nodeOnly = blockText({ vitest: false, nodeTest: true });
    expect(nodeOnly).toContain("instead of running node:test.");
    expect(nodeOnly).toContain("run the node:test projects yourself instead.");
  });
});

describe("writing the block", () => {
  it("appends it after a blank line, then replaces only what lies between the markers", () => {
    const first = withBlock("# Agents\n\nRead the docs.\n", D4) as string;
    expect(first).toBe(`# Agents\n\nRead the docs.\n\n${D4}`);
    const old = first.replace("squeal:begin v1", "squeal:begin v0").replace("Squeal runs", "Old");
    const edited = `${old}\n## After\n\nKept.\n`;
    expect(withBlock(edited, D4)).toBe(`# Agents\n\nRead the docs.\n\n${D4}\n## After\n\nKept.\n`);
    expect(withBlock(first, D4)).toBe(first);
    expect(withBlock("", D4)).toBe(D4);
  });

  it("refuses a begin marker without its end, and leaves the file as it was", async () => {
    const root = squealShaped();
    const broken = `# Agents\n\n<!-- squeal:begin v1 (managed) -->\nhalf a block\n`;
    writeFileSync(join(root, "CLAUDE.md"), broken);
    expect(writeBlockFile(root, "CLAUDE.md", D4)).toEqual({
      path: "CLAUDE.md",
      result: "unterminated",
      line: 3,
    });
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(broken);
    const facts = await plan(root);
    expect(facts.instructions[0]?.block).toEqual({ state: "unterminated", line: 3 });
    expect(facts.outdated).toContain(
      "CLAUDE.md:3: a Squeal block begins with no end; fix it by hand",
    );
  });

  it("writes one block for AGENTS.md -> CLAUDE.md, through the symlink", async () => {
    const root = squealShaped();
    expect((await plan(root)).instructions).toEqual([
      {
        path: "CLAUDE.md",
        aliases: ["AGENTS.md"],
        harnesses: ["claude-code", "codex"],
        exists: true,
        tracked: true,
        block: { state: "absent" },
      },
    ]);
    expect(writeBlockFile(root, "AGENTS.md", D4).result).toBe("written");
    expect(writeBlockFile(root, "CLAUDE.md", D4).result).toBe("unchanged");
    expect(lstatSync(join(root, "AGENTS.md")).isSymbolicLink()).toBe(true);
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(
      `# Agents\n\n${VITEST_GATE}\n\n${D4}`,
    );
    expect((await plan(root)).instructions[0]?.block).toEqual({
      state: "current",
      version: 1,
      line: 5,
    });
  });

  it("names an older block outdated", async () => {
    const root = squealShaped();
    writeFileSync(join(root, "CLAUDE.md"), D4.replace("begin v1", "begin v0"));
    const facts = await plan(root);
    expect(facts.instructions[0]?.block).toEqual({ state: "outdated", version: 0, line: 1 });
    expect(facts.outdated).toContain("CLAUDE.md: the Squeal block is v0, older than v1");
  });
});

describe("which file each harness reads", () => {
  it("Claude Code reads AGENTS.md when no Claude file exists, so both share it", async () => {
    const root = squealShaped();
    rmSync(join(root, "AGENTS.md"));
    rmSync(join(root, "CLAUDE.md"));
    expect((await plan(root)).instructions).toMatchObject([
      { path: "AGENTS.md", aliases: [], harnesses: ["claude-code", "codex"], exists: false },
    ]);
  });

  it("Claude Code reads CLAUDE.md beside a separate AGENTS.md, unless CLAUDE.md imports it", async () => {
    const root = squealShaped();
    rmSync(join(root, "AGENTS.md"));
    writeFileSync(join(root, "AGENTS.md"), "# Codex\n");
    expect((await plan(root)).instructions).toMatchObject([
      { path: "CLAUDE.md", harnesses: ["claude-code"] },
      { path: "AGENTS.md", harnesses: ["codex"] },
    ]);
    writeFileSync(join(root, "CLAUDE.md"), "@AGENTS.md\n");
    expect((await plan(root)).instructions).toMatchObject([
      { path: "AGENTS.md", harnesses: ["claude-code", "codex"] },
    ]);
  });
});

describe("removing the block", () => {
  it("restores the file as it was before the block", () => {
    const before = "# Agents\n\nRead the docs.\n";
    expect(withoutBlock(withBlock(before, D4) as string)).toBe(before);
    expect(withoutBlock(before)).toBeNull();
    expect(withoutBlock(D4)).toBe("");
  });

  it("squeal remove takes it out, and names one it cannot", async () => {
    const root = squealShaped();
    const original = readFileSync(join(root, "CLAUDE.md"), "utf8");
    writeBlockFile(root, "CLAUDE.md", D4);
    const done = capture(root);
    expect(await main(["remove"], done.io)).toBe(0);
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toBe(original);
    expect(done.out.stdout).toContain(
      `Removed:\n  ${join(root, "CLAUDE.md")}: the Squeal block (a change to commit)`,
    );

    writeFileSync(join(root, "CLAUDE.md"), `${original}<!-- squeal:begin v1 -->\n`);
    const stuck = capture(root);
    expect(await main(["remove"], stuck.io)).toBe(3);
    expect(stuck.out.stdout).toContain(
      `Still there:\n  ${join(root, "CLAUDE.md")}: its Squeal block begins at line 4 with no end marker; delete it by hand`,
    );
  });
});
