import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SETUP_USAGE } from "../../src/cli/setup/command.js";
import { PLUGIN_DIR } from "../../src/harness/claude-code/build.js";
import { CODEX_PLUGIN_DIR } from "../../src/harness/codex/build.js";

/*
 * Task 005-19 (spec 005 D3 "The skill"): `/squeal:setup` in Claude Code and
 * `$squeal:setup` in Codex run `squeal setup`'s plan, questions and apply.
 * One text serves both harnesses, so the Codex copy is the source unchanged.
 * Both copies are committed, outside the Codex build's copy list: that build
 * file is key-format guarded, and listing a skill there would re-key results.
 */

const SKILL = join(PLUGIN_DIR, "skills/setup");
const CODEX = join(CODEX_PLUGIN_DIR, "skills/setup");
const body = readFileSync(join(SKILL, "SKILL.md"), "utf8");

const files = (dir: string) => readdirSync(dir, { recursive: true, encoding: "utf8" }).sort();

/** Each `--flag` in a code span that runs `squeal setup`. */
function setupFlags(text: string): string[] {
  const spans = [...text.matchAll(/`([^`]*)`/g)].map((m) => m[1] as string);
  const commands = spans.filter((s) => s.startsWith("squeal setup") || s.startsWith("--"));
  return [...new Set(commands.flatMap((s) => [...s.matchAll(/--[a-z][a-z-]*/g)].map((m) => m[0])))];
}

describe("the setup skill", () => {
  it("is the same files in both plugins", () => {
    expect(files(CODEX)).toEqual(files(SKILL));
    for (const f of files(SKILL)) {
      expect(readFileSync(join(CODEX, f), "utf8"), f).toBe(readFileSync(join(SKILL, f), "utf8"));
    }
  });

  it("is named setup, so the harnesses list it as squeal:setup", () => {
    expect(body).toMatch(/^---\nname: setup\ndescription: Use when [^\n]+\n---\n/);
    expect(body).toContain("/squeal:setup");
    expect(body).toContain("$squeal:setup");
  });

  it("names only flags `squeal setup` takes, and one for each answer", () => {
    const usage = new Set(SETUP_USAGE.match(/--[a-z][a-z-]*/g));
    const named = setupFlags(body);
    expect(named.filter((f) => !usage.has(f))).toEqual([]);
    expect([...usage].filter((f) => f !== "--check").sort()).toEqual(
      named.filter((f) => f !== "--check").sort(),
    );
  });

  // Review wave 3 B3: "no" to every harness is a flag too, not an omitted one.
  it("passes every value an answer can take, none included", () => {
    expect(SETUP_USAGE).toContain("[--harness <claude-code|codex|none>]...");
    for (const flag of ["--harness", "--block", "--slow"]) {
      expect(body).toContain(`\`${flag} none\` when none`);
    }
    // Row 005-40, `research/e2e-setup.md` defect 4: a bare directory and a literal "none" input.
    expect(body).toContain("`--input <glob>=none` when none");
    expect(body).toContain("the glob ending in `/**`");
  });

  it("finds the CLI in each harness", () => {
    expect(body).toContain(`\`"\${CLAUDE_PLUGIN_ROOT}/bin/squeal"\``);
    expect(body).toContain(
      '`node --disable-warning=ExperimentalWarning "<plugin root>/dist/cli/squeal.mjs"`, the plugin root being the directory that holds `skills/setup/`',
    );
  });

  it("asks through AskUserQuestion when it has it, and otherwise writes nothing", () => {
    expect(body).toContain("`AskUserQuestion`");
    expect(body).toContain("at most four questions");
    expect(body).toMatch(/`claude -p`, `codex exec`/);
    expect(body).toContain("end the turn without writing anything");
  });

  it("applies with --yes, shows the diffs and never commits", () => {
    expect(body).toContain("`squeal setup --yes --no-warmup` and one flag per answer");
    expect(body).toContain("Never commit");
  });

  it("says where a warm-up from the skill runs, and gives the terminal command", () => {
    expect(body).toContain("this session's daemon, which exits 3 s after the last session ends");
    expect(body).toContain("`squeal warmup`");
  });

  it("offers the launcher as install.sh copies it", () => {
    expect(body).toContain("bin/squeal-launcher");
    expect(body).toContain(`\${SQUEAL_BIN_DIR:-$HOME/.local/bin}/squeal`);
  });

  it("stays shorter than the squeal skill's own budget", () => {
    expect(body.length).toBeLessThan(5_000);
  });
});
