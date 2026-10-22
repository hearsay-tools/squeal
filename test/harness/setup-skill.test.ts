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

  // Row 005-41, from cezar: `.ai/qa/test-env.json` is rewritten on each boot, so never an input.
  // Task 004-81: no build output either, and no question asks for one.
  it("says an input is never build output nor what the suite's bootstrap rewrites", () => {
    expect(body).not.toContain("artifact");
    expect(body).toContain(
      "Setup asks no input question: Squeal covers no test of a build output, which goes in the runner's `exclude` instead; show the user the evidence the question names, and that Squeal never builds.",
    );
    // Row 005-70: the exclude question has its flag.
    expect(body).toContain("`--exclude <glob>` for each group answered yes");
    expect(body).toContain(
      "never a file the suite's own bootstrap rewrites on each run (an environment descriptor, a log, a PID file): declared, every boot re-runs the group.",
    );
  });

  // Row 005-47: cezar's hand-written Squeal paragraph got a second, managed one beside it.
  it("shows the user a file's Squeal instructions outside the block", () => {
    expect(body).toContain(
      "When the plan's `squealMentions` names a line, that file already holds Squeal instructions outside the block: show the user that line with the block question",
    );
  });

  // Rows 005-79 and 005-80: toolkit-dev's user asked what was left so that every test runs.
  it("shows the user what the config leaves out or runs twice, with the fix", () => {
    expect(body).toContain(
      "Show the user the plan's `not run:` and `run twice:` lines, each with its fix: no question or flag covers them.",
    );
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
