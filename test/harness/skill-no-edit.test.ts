import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { quietEditsText } from "../../src/core/delivery/format.js";
import { PLUGIN_DIR } from "../../src/harness/claude-code/build.js";
import { CODEX_RUNTIME_DIR, CODEX_SKILL } from "../../src/harness/codex/build.js";
import { PI_PLUGIN_DIR, PI_SKILL } from "../../src/harness/pi/build.js";
import { DEFAULT_COVERAGE } from "../../src/harness/shared/coverage.js";
import { primer } from "../../src/harness/shared/primer.js";

/*
 * Row 019-49 (spec 019 D6, "No test group at `edit`"): the skill's step 1,
 * which says no message is not a pass, says what the primer and the edit
 * lines say under a policy with no test group at `edit`: nothing runs between
 * edits, and the narrow run gives the verdict for files the agent changed.
 * Every harness's copy says it.
 */

const NARROW = "`squeal run <group> <path>... --wait 60000`";
const step1 = (text: string) => text.slice(text.indexOf("1. **"), text.indexOf("2. **"));

describe("the skill with no test group at edit (019-49)", () => {
  const copies = [
    join(PLUGIN_DIR, "skills", "squeal"),
    join(CODEX_RUNTIME_DIR, CODEX_SKILL),
    join(PI_PLUGIN_DIR, PI_SKILL),
  ].map((dir) => readFileSync(join(dir, "SKILL.md"), "utf8"));

  it("says in step 1 that silence between edits is then not a pass, and names the narrow run", () => {
    for (const body of copies) {
      expect(step1(body)).toContain(
        `No message means nothing changed, not that everything passes; where the primer says no test group runs after each edit, nothing ran: use ${NARROW}.`,
      );
    }
  });

  it("matches the primer's and the edit lines' words for the condition and the command", () => {
    const groups = {
      moments: [{ at: "stop" as const, names: ["unit"] }],
      noTestsAtEdit: true as const,
    };
    const text = primer("squeal", { ...DEFAULT_COVERAGE, groups });
    expect(text).toContain("no test group runs after each edit");
    expect(text).toContain(NARROW);
    expect(quietEditsText("squeal")).toContain("no test group runs after each edit");
    expect(quietEditsText("squeal")).toContain(NARROW);
  });
});
