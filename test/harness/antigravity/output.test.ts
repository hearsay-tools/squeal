import { describe, expect, it } from "vitest";
import {
  capContext,
  continueTurn,
  deny,
  injectSystemMessage,
  MESSAGE_CAP_CHARS,
} from "../../../src/harness/antigravity/output.js";
import { PRIMER } from "../../../src/harness/shared/primer.js";

/* Spec 024 D3: Antigravity's hook output shapes and the 10,000-character cap. */

const KEEP = "Squeal's skill for this session, kept across plugin updates: `/d/SKILL.md`.";
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i} ${"x".repeat(60)}`);

describe("output shapes", () => {
  it("injects a system message", () => {
    expect(injectSystemMessage("SQUEAL · news")).toEqual({
      injectSteps: [{ systemMessage: { systemMessage: "SQUEAL · news" } }],
    });
  });

  it("denies with a reason", () => {
    expect(deny("denied")).toEqual({ decision: "deny", reason: "denied" });
  });

  it("continues the turn with a reason", () => {
    expect(continueTurn("report")).toEqual({ decision: "continue", reason: "report" });
  });

  it("caps every shape", () => {
    const long = lines(400).join("\n");
    expect(deny(long).reason.length).toBeLessThanOrEqual(MESSAGE_CAP_CHARS);
    expect(continueTurn(long).reason.length).toBeLessThanOrEqual(MESSAGE_CAP_CHARS);
    const message = injectSystemMessage(long).injectSteps[0]?.systemMessage.systemMessage ?? "";
    expect(message.length).toBeLessThanOrEqual(MESSAGE_CAP_CHARS);
  });
});

describe("capContext", () => {
  it("is 10,000 characters", () => {
    expect(MESSAGE_CAP_CHARS).toBe(10_000);
  });

  it("puts the kept line before the primer and leaves a short text whole", () => {
    expect(capContext(`SQUEAL · registered\n\n${PRIMER}`, "squeal", KEEP)).toBe(
      `SQUEAL · registered\n\n${KEEP}\n\n${PRIMER}`,
    );
    expect(capContext("SQUEAL · news")).toBe("SQUEAL · news");
  });

  it("cuts a long text at a line, says so, and keeps the kept line and the primer whole", () => {
    const text = `${lines(400).join("\n")}\n\n${PRIMER}`;
    const out = capContext(text, "node /x/squeal.mjs", KEEP);
    expect(out.length).toBeLessThanOrEqual(MESSAGE_CAP_CHARS);
    expect(out.endsWith(`\n\n${KEEP}\n\n${PRIMER}`)).toBe(true);
    expect(out).toContain(
      "SQUEAL · cut to fit an Antigravity hook; `node /x/squeal.mjs status` has the rest.",
    );
    expect(out.split("\n")[0]).toBe(lines(1)[0]);
  });
});
