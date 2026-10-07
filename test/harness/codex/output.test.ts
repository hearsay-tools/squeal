import { describe, expect, it } from "vitest";
import {
  additionalContext,
  block,
  CONTEXT_CAP_CHARS,
  capContext,
  deny,
} from "../../../src/harness/codex/output.js";
import { PRIMER } from "../../../src/harness/shared/primer.js";

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

  it("cuts a text with no primer and no line breaks", () => {
    const capped = capContext("y".repeat(20_000));
    expect(capped.length).toBeLessThanOrEqual(CONTEXT_CAP_CHARS);
    expect(capped.endsWith("`squeal status` has the rest.")).toBe(true);
  });
});
