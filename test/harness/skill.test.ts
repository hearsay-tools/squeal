import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_DIR } from "../../src/harness/claude-code/build.js";
import { CODEX_PLUGIN_DIR, CODEX_SKILL } from "../../src/harness/codex/build.js";
import { PRIMER } from "../../src/harness/shared/primer.js";

/*
 * Task 001-88: the skill fires when the agent is about to run tests or check
 * whether a change broke something; its body is steps first, with reference
 * disclosed in `references/` behind pointers.
 */

const SKILL = join(PLUGIN_DIR, "skills/squeal");
const body = readFileSync(join(SKILL, "SKILL.md"), "utf8");
const references = readdirSync(join(SKILL, "references")).sort();
const read = (name: string) => readFileSync(join(SKILL, "references", name), "utf8");

function description(): string {
  const match = /^---\n(?:.*\n)*?description: (.*)\n(?:.*\n)*?---\n/.exec(body);
  return match?.[1] ?? "";
}

describe("the squeal skill", () => {
  /*
   * Task 001-283 (`research/primer-skill-writing.md` F5): the description is
   * a context pointer; its trigger stays the human's (001-88), and coverage,
   * which the static text said wrong for a node:test-only repository, is the
   * primer's list, read from the config.
   */
  it("is described by running tests and checking for breakage, not by claiming done", () => {
    const text = description();
    expect(text).toMatch(/^Use when about to run tests \(vitest, npm test\)/);
    expect(text).toContain("check whether a change broke something");
    expect(text).toContain("the suites its primer lists as covered");
    expect(text).not.toMatch(/claim|complete|done|Vitest tests|node:test/i);
  });

  it("puts the steps before the reference, and points at every reference file", () => {
    expect(body.indexOf("## Steps")).toBeGreaterThan(-1);
    expect(body.indexOf("## Steps")).toBeLessThan(body.indexOf("## Reference"));
    const pointed = [...body.matchAll(/`references\/([a-z-]+\.md)`/g)].map((m) => m[1]).sort();
    expect(pointed).toEqual(references);
    // Counts and policy keys live in the references, not the body.
    expect(body).not.toContain("| Key |");
    expect(body).not.toContain("**stale**");
  });

  it("says a header names the files changed since the last report, not the cause", () => {
    expect(body).toContain("changed since your last report");
    expect(read("reports.md")).toContain("changed since your last report");
    expect(`${body}${references.map(read).join("")}`).not.toMatch(/which edit it is about/);
  });

  /*
   * Spec 003 lessons, defect 1: "Squeal covers only the Vitest tests" sent
   * agents to run node:test themselves. The skill is static, so it says
   * coverage once, as the primer's list from `squeal.config.json`.
   */
  it("says coverage once, as the primer's list, with node:test and slow files", () => {
    expect(body).toContain("It covers what the SQUEAL primer lists from `squeal.config.json`");
    expect(body).toContain("the node:test tests of the `nodeTest` projects");
    expect(body.match(/`nodeTest`/g)).toHaveLength(1);
    expect(body).not.toMatch(/only the Vitest tests|covers only Vitest/);
  });

  /*
   * Task 001-283 (`research/slow-claims.md` §2): a model following step 3 to
   * the letter claimed while the slow tier ran. The claim step names
   * `run --slow --wait`, and its completion criterion is read off the header.
   */
  it("makes the slow tier current before a claim, with a checkable criterion", () => {
    const step = body.slice(body.indexOf("4. **"), body.indexOf("5. **"));
    expect(step).toContain("Before you say the task is done");
    expect(step).toContain("`squeal run --slow --wait 60000`");
    expect(step).toContain(
      "Done when no check of your edits is pending, the `Slow tier:` line says every slow file is current",
    );
    expect(body).not.toMatch(/never during Stop's wait/);
    for (const text of [body, ...references.map(read)]) expect(text).not.toContain("Stop's wait");
  });

  it("names the squeal why line a FAIL report ends with", () => {
    expect(body).toContain('`Full output: squeal why "<name>"`');
  });

  /*
   * Task 001-174, from 001-172's measurement (`lessons.md`, "`status --wait`
   * on a loaded host"): an agent ran neighbouring suites itself rather than
   * wait. Red/green through the wait, the measured wait for a busy host, and
   * a re-run beside Squeal's named a duplicate. Task 001-283: red/green is a
   * branch only some tasks reach, so it is disclosed in `commands.md` behind
   * a pointer that names it.
   */
  it("shows red/green through the wait, with the measured wait and no duplicate runs", () => {
    const commands = read("commands.md");
    const example = commands.slice(
      commands.indexOf("## Red/green"),
      commands.indexOf("## squeal why"),
    );
    expect(example).toMatch(
      /Revert the fix[\s\S]*status --wait[\s\S]*Restore the fix[\s\S]*status --wait/,
    );
    expect(example).toContain("its own revision");
    expect(example).toContain("PASS -> FAIL");
    // Review wave 13k, S1: quiet is no owed work, not a pass; the outcome is read from the result.
    expect(example).toContain(
      "Quiet says no result your edits owe is outstanding, not that it passed",
    );
    expect(example).toContain("listed under `Known failures` after the revert");
    expect(example).not.toMatch(/quiet means the test (still )?passes/);
    expect(body).toMatch(
      /`references\/commands\.md`:[^\n]*red\/green[^\n]*before a red\/green check/,
    );
    const codex = (name: string) =>
      readFileSync(join(CODEX_PLUGIN_DIR, CODEX_SKILL, "references", name), "utf8");
    expect(codex("commands.md")).toContain(example);
    expect(body).toContain("`--wait 120000` on a busy host");
    expect(read("commands.md")).toContain("On a busy host give it `120000`");
    expect(body).toContain("duplicates what Squeal is already running");
    expect(body).toContain("a gate the repository requires is still yours to run");
  });

  it("states the next-tool-call default before every `squeal status --wait`", () => {
    const texts = [body, ...references.map(read), PRIMER];
    let pointers = 0;
    for (const text of texts) {
      for (const paragraph of text.split(/\n\s*\n|\n(?=\d+\. |- )/)) {
        const wait = paragraph.indexOf("status --wait");
        if (wait === -1) continue;
        pointers++;
        const next = paragraph.indexOf("next tool call");
        expect(next, paragraph).toBeGreaterThan(-1);
        expect(next, paragraph).toBeLessThan(wait);
      }
    }
    expect(pointers).toBeGreaterThanOrEqual(3);
  });
});
