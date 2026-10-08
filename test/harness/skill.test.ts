import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_DIR } from "../../src/harness/claude-code/build.js";
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
  it("is described by running tests and checking for breakage, not by claiming done", () => {
    const text = description();
    expect(text).toMatch(/^Use when about to run tests \(vitest, npm test\)/);
    expect(text).toContain("check whether a change broke something");
    expect(text).not.toMatch(/claim|complete|done/i);
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
   * agents to run node:test themselves. The skill is static, so it names
   * node:test as covered where squeal.config.json lists `nodeTest` projects.
   */
  it("names node:test as covered where nodeTest projects are listed, and never Vitest alone", () => {
    expect(description()).toContain("node:test tests where squeal.config.json lists nodeTest");
    expect(body).toContain("its node:test tests too where `squeal.config.json` lists `nodeTest`");
    expect(body).toContain("instead of running Vitest, or node:test where");
    expect(body).not.toMatch(/only the Vitest tests|covers only Vitest/);
  });

  it("names the squeal why line a FAIL report ends with", () => {
    expect(body).toContain('`Full output: squeal why "<name>"`');
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
