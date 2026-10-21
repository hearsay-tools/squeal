import { describe, expect, it } from "vitest";
import {
  additionalContext,
  block,
  CONTEXT_CAP_CHARS,
  capContext,
  deny,
} from "../../../src/harness/codex/output.js";
import { VITEST_ONLY } from "../../../src/harness/shared/coverage.js";
import { PRIMER, primer } from "../../../src/harness/shared/primer.js";

const lines = (n: number) =>
  Array.from({ length: n }, (_, i) => `FAIL  check number ${i}`).join("\n");

describe("Codex output shapes (spec 002 D3)", () => {
  it("puts context, a denial and a block where Codex reads them", () => {
    expect(additionalContext("PostToolUse", "news")).toEqual({
      hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "news" },
    });
    expect(deny("why")).toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: "why",
      },
    });
    expect(block("report")).toEqual({ decision: "block", reason: "report" });
  });
});

describe("capContext", () => {
  it("leaves a text within 8,000 characters as it is", () => {
    const text = "x".repeat(CONTEXT_CAP_CHARS);
    expect(capContext(text)).toBe(text);
  });

  it("cuts a longer text at a line, says so, and keeps a trailing primer whole", () => {
    const text = `${lines(600)}\n\n${PRIMER}`;
    expect(text.length).toBeGreaterThan(CONTEXT_CAP_CHARS);
    const capped = capContext(text);
    expect(capped.length).toBeLessThanOrEqual(CONTEXT_CAP_CHARS);
    expect(capped.endsWith(`\n\n${PRIMER}`)).toBe(true);
    expect(capped).toContain("\nSQUEAL · cut to fit a Codex hook; `squeal status` has the rest.\n");
    const kept = capped.split("\nSQUEAL · cut")[0] ?? "";
    expect(text.startsWith(kept)).toBe(true);
    expect(kept.split("\n").at(-1)).toMatch(/^FAIL {2}check number \d+$/);
  });

  it("keeps the primer of the command it is given whole and names that command (002 D1)", () => {
    const command = 'node "/p/dist/cli/squeal.mjs"';
    const capped = capContext(`${lines(600)}\n\n${primer(command)}`, command);
    expect(capped.length).toBeLessThanOrEqual(CONTEXT_CAP_CHARS);
    expect(capped.endsWith(`\n\n${primer(command)}`)).toBe(true);
    expect(capped).toContain(
      `\nSQUEAL · cut to fit a Codex hook; \`${command} status\` has the rest.\n`,
    );
  });

  it("keeps the primer that names node:test whole too (003 lessons, defect 1)", () => {
    const tail = `\n\n${primer("squeal", { ...VITEST_ONLY, nodeTest: [{ name: "unit", include: ["test/*.test.mjs"] }] })}`;
    const capped = capContext(`${lines(600)}${tail}`);
    expect(capped.length).toBeLessThanOrEqual(CONTEXT_CAP_CHARS);
    expect(capped.endsWith(tail)).toBe(true);
  });

  it("cuts a text with no primer and no line breaks", () => {
    const capped = capContext("y".repeat(20_000));
    expect(capped.length).toBeLessThanOrEqual(CONTEXT_CAP_CHARS);
    expect(capped.endsWith("`squeal status` has the rest.")).toBe(true);
  });

  /*
   * Spec 005 D3 as amended 2026-10-21 (row 005-73): SessionStart and
   * SubagentStart put the kept skill's line before the primer, and it counts
   * against the cap with the primer.
   */
  const skill =
    "Squeal's skill for this session, kept across plugin updates: `/home/u/.codex/plugins/data/squeal-hearsay/versions/0.1.243/skills/squeal/SKILL.md`.";

  it("puts a kept line before the trailing primer, as its own paragraph", () => {
    expect(capContext(`header\n\n${PRIMER}`, "squeal", skill)).toBe(
      `header\n\n${skill}\n\n${PRIMER}`,
    );
    // After `compact` the text is the primer alone; with no primer the line goes last.
    expect(capContext(PRIMER, "squeal", skill)).toBe(`${skill}\n\n${PRIMER}`);
    expect(capContext("news", "squeal", skill)).toBe(`news\n\n${skill}`);
  });

  it("counts the kept line against the cap and keeps it whole with the primer", () => {
    const command = '"/home/u/.codex/plugins/data/squeal-hearsay/bin/squeal"';
    const tail = `\n\n${skill}\n\n${primer(command)}`;
    // Within the cap without the line, over it with the line: the line's characters count.
    const head = "x".repeat(CONTEXT_CAP_CHARS - primer(command).length - 2);
    expect(`${head}\n\n${primer(command)}`.length).toBe(CONTEXT_CAP_CHARS);
    const capped = capContext(`${head}\n\n${primer(command)}`, command, skill);
    expect(capped.length).toBeLessThanOrEqual(CONTEXT_CAP_CHARS);
    expect(capped.endsWith(tail)).toBe(true);
    expect(capped).toContain(`\`${command} status\` has the rest.`);
    const long = capContext(`${lines(600)}\n\n${primer(command)}`, command, skill);
    expect(long.length).toBeLessThanOrEqual(CONTEXT_CAP_CHARS);
    expect(long.endsWith(tail)).toBe(true);
  });
});
