import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { narrowText } from "../../src/cli/run-group-narrow.js";
import { quietEditsText } from "../../src/core/delivery/format.js";
import type { ResolvedGroup } from "../../src/core/types/check-groups.js";
import type { RevisionNumber } from "../../src/core/types/common.js";
import { PLUGIN_DIR } from "../../src/harness/claude-code/build.js";
import { CODEX_RUNTIME_DIR, CODEX_SKILL } from "../../src/harness/codex/build.js";
import { PI_PLUGIN_DIR, PI_SKILL } from "../../src/harness/pi/build.js";

/*
 * Row 019-49 (spec 019 D6, "No test group at `edit`"): the skill's step on
 * reading reports, which says no message is not a pass, says what the edit
 * lines say under a policy with no test group at `edit`: nothing runs between
 * edits, and the narrow run gives the verdict for files the agent changed.
 * Row 005-128 (019 D6 as amended 2026-11-19): it is step 2, and the agent
 * reads the condition off `squeal checks`, not the start message. Every
 * harness's copy says it.
 */

const NARROW = "`squeal run <check> <path>... --wait 60000`";
const step2 = (text: string) => text.slice(text.indexOf("2. **"), text.indexOf("3. **"));

describe("the skill with no test group at edit (019-49)", () => {
  const copies = [
    join(PLUGIN_DIR, "skills", "squeal"),
    join(CODEX_RUNTIME_DIR, CODEX_SKILL),
    join(PI_PLUGIN_DIR, PI_SKILL),
  ].map((dir) => readFileSync(join(dir, "SKILL.md"), "utf8"));

  it("says in step 2 that silence between edits is then not a pass, and names the narrow run", () => {
    for (const body of copies) {
      expect(step2(body)).toContain(
        `No message means nothing changed, not that everything passes; where \`squeal checks\` shows no check that runs after each edit, nothing ran: use ${NARROW}.`,
      );
    }
  });

  it("names the narrow run the edit lines name, a check for a group", () => {
    expect(quietEditsText("squeal")).toContain("no test group runs after each edit");
    expect(quietEditsText("squeal")).toContain(NARROW.replace("<check>", "<group>"));
  });

  it("documents the narrow run in every copy of commands.md, with the lines the CLI prints", () => {
    const group = { name: "e2e", at: "stop", after: [] } as unknown as ResolvedGroup;
    const text = narrowText(
      group,
      { revision: 12 as RevisionNumber, queued: 2 },
      {
        selected: [
          { project: "", path: "test/e2e/a.test.ts" },
          { project: "", path: "test/e2e/b.test.ts" },
        ],
        reached: 0,
        others: [{ group: "unit", files: 1, paths: ["src/parse.ts"] }],
        unmatched: [],
        current: 0,
        notRun: [],
      },
      "squeal",
    ).split("\n");
    for (const dir of [
      join(PLUGIN_DIR, "skills", "squeal"),
      join(CODEX_RUNTIME_DIR, CODEX_SKILL),
      join(PI_PLUGIN_DIR, PI_SKILL),
    ]) {
      const commands = readFileSync(join(dir, "references", "commands.md"), "utf8");
      expect(commands).toContain("## squeal run <group> <path>...");
      expect(commands).toContain(`\`\`${text[0]}\`\``);
      expect(commands).toContain(`\`\`${text[1]}\`\``);
    }
  });
});
