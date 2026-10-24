import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../src/cli/main.js";
import { PLUGIN_DIR } from "../../src/harness/claude-code/build.js";
import { CODEX_PLUGIN_DIR, CODEX_SKILL } from "../../src/harness/codex/build.js";
import { PI_PLUGIN_DIR, PI_SKILL } from "../../src/harness/pi/build.js";

/*
 * Row 011-146 (011 C15 as amended 2026-10-23): the help text and every copy
 * of the skill's `commands.md` name the focused wait, what it returns and
 * that it is not the file's verdict.
 */

const COPIES = [
  join(PLUGIN_DIR, "skills/squeal"),
  join(CODEX_PLUGIN_DIR, CODEX_SKILL),
  join(PI_PLUGIN_DIR, PI_SKILL),
];
const commandsOf = (dir: string) => readFileSync(join(dir, "references/commands.md"), "utf8");

describe("the focused wait in the help and the skill (row 011-146)", () => {
  it("every copy of commands.md names --check, its exits and what it is not", () => {
    for (const dir of COPIES) {
      const commands = commandsOf(dir);
      expect(commands).toContain(
        "add `--check <text>`, repeatable, to the named wait: `squeal status --wait 60000 test/api.test.ts --check 'rejects a bad token'`.",
      );
      expect(commands).toContain(
        "It exits 1 when a selected check failed, else 3: a focused pass says nothing of the file's other checks, so say the file passes only after its own run.",
      );
      expect(commands).toContain("`Focused (not counted):`");
      expect(commands).toContain("this daemon (Squeal <version>) runs whole files only");
      expect(commands).toContain("`--check` with source paths only is a usage error (exit 2)");
      expect(commands).toContain("add `--check '<test name>'` to each wait");
    }
  });

  it("the status help names --check on both path forms", () => {
    const err: string[] = [];
    const io = { stdout: (t: string) => err.push(t), stderr: (t: string) => err.push(t) };
    main(["help"], io);
    const help = err.join("");
    expect(help).toContain("squeal status <path>... [--check <text>]... [--full] [--json]");
    expect(help).toContain(
      "squeal status --wait <ms> <path>... [--check <text>]... [--full] [--json]",
    );
    expect(help).toContain("outcome, not the file's verdict: exit 1 when one");
  });
});
