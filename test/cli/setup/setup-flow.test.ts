import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../../../src/cli/main.js";
import { terminalAsker } from "../../../src/cli/setup/ask.js";
import { setupCommand } from "../../../src/cli/setup/command.js";
import { git } from "../../hash/git-repo.js";
import { capture, cleanupFixtures, harnessEnv, squealShaped, VITEST_GATE } from "./fixture.js";

/*
 * Spec 005 D3 steps 3 to 5, row 005-14a: bare `squeal setup` asks one
 * question per open choice on a terminal, or takes the defaults with
 * `--yes`, applies them through `squeal init`, and shows the diff. The
 * warm-up runs a daemon; `warmup.test.ts` tests it, so these say --no-warmup.
 */

afterEach(cleanupFixtures);

const read = (root: string, path: string) => readFileSync(join(root, path), "utf8");

/** A fake terminal: `lines` typed ahead, every prompt recorded. */
function fakeTerminal(lines: readonly string[]) {
  const input = Object.assign(new PassThrough(), { isTTY: true });
  const output = Object.assign(new PassThrough(), { isTTY: true });
  let shown = "";
  output.on("data", (chunk) => {
    shown += chunk;
  });
  input.end(lines.map((line) => `${line}\n`).join(""));
  return { asker: () => terminalAsker({ input, output }), prompts: () => shown };
}

async function setup(root: string, args: readonly string[], env = harnessEnv(["claude"])) {
  const { io, out } = capture(root, env);
  const code = await main(["setup", ...args], io);
  return { code, ...out };
}

describe("squeal setup on a terminal", () => {
  it("asks one question per open choice, the default first, and applies the answers", async () => {
    const root = squealShaped();
    const { io, out } = capture(root, harnessEnv(["claude"]));
    // Claude Code yes (default), Codex no (default), no block, keep the gate, slow (default).
    const terminal = fakeTerminal(["", "", "2", "keep", ""]);
    const code = await setupCommand(["--no-warmup"], io, { asker: terminal.asker });
    expect(out.stderr).toBe("");
    expect(code).toBe(0);
    const questions = [...out.stdout.matchAll(/^(\S.*\?)\n {2}1\. (.+)$/gm)].map(
      ([, q, first]) => `${q} -> ${first}`,
    );
    expect(questions).toEqual([
      "Set up Claude Code here (on the PATH, plugin not installed)? -> yes (default)",
      "Set up Codex here (not on the PATH, plugin not installed)? -> no (default)",
      "Write the Squeal block to CLAUDE.md (read by Claude Code)? -> write it (default)",
      "test/e2e/** (2 files: under a directory named e2e). Run these tests in the slow tier? -> slow (default)",
    ]);
    expect(out.stdout).toContain("Gate line CLAUDE.md:3:");
    expect(terminal.prompts()).toBe("Choice [1]: ".repeat(5));
    // The plan comes first, then the questions, then what init wrote, then the diff.
    expect(out.stdout.indexOf("Squeal setup plan for")).toBe(0);
    expect(out.stdout).toContain("squeal init: kept gate line CLAUDE.md:3");
    expect(out.stdout).toContain("squeal init: added test/e2e/** to slow.include");
    expect(read(root, "CLAUDE.md")).toBe(`# Agents\n\n${VITEST_GATE}\n`);
    expect(JSON.parse(read(root, "squeal.config.json")).slow).toEqual({
      include: ["test/e2e/**"],
    });
    expect(existsSync(join(root, ".claude/settings.json"))).toBe(true);
    expect(out.stdout).toMatch(/Changes:\n squeal\.config\.json \| \d+ \+/);
    expect(out.stdout).toContain(
      "Commit these when they look right; squeal setup never commits:\n  squeal.config.json\n  .claude/settings.json\n",
    );
    expect(git(root, ["log", "--oneline"]).trim().split("\n")).toHaveLength(3);
  });

  it("asks again on an answer it cannot read, and takes the default at the end of input", async () => {
    const root = squealShaped();
    const { io, out } = capture(root, harnessEnv(["claude"]));
    const terminal = fakeTerminal(["9", "no"]);
    expect(await setupCommand(["--no-warmup"], io, { asker: terminal.asker })).toBe(0);
    expect(out.stdout).toContain("Answer 1 to 2, or press Enter for 1.");
    // Claude Code: "9" then "no"; the rest took their defaults when input ended. With no
    // harness chosen, no block is offered; the gate is reworded by default.
    expect(existsSync(join(root, ".claude/settings.json"))).toBe(false);
    expect(out.stdout).not.toContain("Squeal block to");
    const claude = read(root, "CLAUDE.md");
    expect(claude).toContain("`squeal run --all --wait 110000`");
    expect(claude).not.toContain("squeal:begin");
  });
});

describe("squeal setup --yes", () => {
  it("takes the plan's defaults, after which setup --check finds nothing outdated", async () => {
    const root = squealShaped();
    const { code, stdout, stderr } = await setup(root, ["--yes", "--no-warmup"]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain(
      "Write the Squeal block to CLAUDE.md (read by Claude Code)?\n  write it (default, --yes)\n",
    );
    const claude = read(root, "CLAUDE.md");
    expect(claude).toContain("`squeal run --all --wait 110000`");
    expect(claude).toContain("<!-- squeal:begin v1");
    expect(JSON.parse(read(root, "squeal.config.json")).slow).toEqual({
      include: ["test/e2e/**"],
    });
    expect(existsSync(join(root, ".claude/settings.json"))).toBe(true);
    expect(stdout).toContain("diff --git a/CLAUDE.md b/CLAUDE.md");
    expect((await setup(root, ["--check"])).code).toBe(0);
  });

  it("asks nothing a flag answers", async () => {
    const root = squealShaped();
    const { code, stdout } = await setup(root, [
      "--yes",
      "--harness",
      "claude-code",
      "--block",
      "none",
      "--gate",
      "CLAUDE.md:3=keep",
      "--slow",
      "test/e2e/**/*.test.ts",
      "--no-warmup",
    ]);
    expect(code).toBe(0);
    expect(stdout).not.toMatch(/Set up |Squeal block to|Reword it\?|slow tier\?|Warm up now/);
    expect(read(root, "CLAUDE.md")).toBe(`# Agents\n\n${VITEST_GATE}\n`);
    expect(JSON.parse(read(root, "squeal.config.json")).slow).toEqual({
      include: ["test/e2e/**/*.test.ts"],
    });
  });

  it("offers an outdated repository its upgrade", async () => {
    const old =
      "<!-- squeal:begin v0 (managed by Squeal setup) -->\nRun tests.\n<!-- squeal:end -->\n";
    const root = squealShaped({ "CLAUDE.md": `# Agents\n\n${VITEST_GATE}\n\n${old}` });
    const check = await setup(root, ["--check"]);
    expect(check.code).toBe(1);
    expect(check.stdout).toContain("CLAUDE.md: the Squeal block is v0, older than v1");
    const { code, stdout } = await setup(root, ["--yes", "--no-warmup"]);
    expect(code).toBe(0);
    expect(stdout).toContain(
      "CLAUDE.md (read by Claude Code) holds the Squeal block v0, which is outdated. Upgrade it?\n  upgrade it (default, --yes)\n",
    );
    const claude = read(root, "CLAUDE.md");
    expect(claude).toContain("<!-- squeal:begin v1");
    expect(claude).not.toContain("v0");
    expect((await setup(root, ["--check"])).code).toBe(0);
  });
});

describe("squeal setup without a terminal or --yes", () => {
  it("prints the plan and the questions and writes nothing", async () => {
    const root = squealShaped();
    // Vitest's stdin is not a terminal: the default asker finds none.
    const { code, stdout, stderr } = await setup(root, []);
    expect(code).toBe(1);
    expect(stdout).toContain("Squeal setup plan for");
    expect(stdout).toContain("Questions, the default first:");
    expect(stdout).toContain(
      "Write the Squeal block to CLAUDE.md (read by Claude Code)?\n  1. write it (default)\n  2. no block\n",
    );
    expect(stdout).toMatch(/Warm up now: .*\?\n {2}1\. yes \(default\)/);
    expect(stdout).not.toContain("squeal init:");
    expect(stderr).toContain("no terminal to ask on");
    expect(stderr).toContain("nothing changed");
    expect(git(root, ["status", "--porcelain"])).toBe("");
  });
});
