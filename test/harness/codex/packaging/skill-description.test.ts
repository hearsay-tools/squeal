import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CODEX_PLUGIN_DIR, CODEX_RUNTIME_DIR } from "../../../../src/harness/codex/build.js";

/*
 * Row 005-129: Codex reads a skill's description from the fixed plugin (spec 002 D7), and the
 * runtime's copy is what every other harness reads. They say the same, so a new runtime
 * description fails here until an adapter release carries it.
 */

function description(root: string, skill: string): string | undefined {
  const text = readFileSync(join(root, "skills", skill, "SKILL.md"), "utf8");
  return /^description: (.*)$/m.exec(text)?.[1];
}

describe("the fixed Codex plugin's skill descriptions (row 005-129)", () => {
  it.each(["squeal", "setup"])("%s: equals the runtime copy's", (skill) => {
    const fixed = description(CODEX_PLUGIN_DIR, skill);
    expect(fixed).toBeDefined();
    expect(fixed).toBe(description(CODEX_RUNTIME_DIR, skill));
  });
});
