import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_DIR } from "../../../src/harness/claude-code/build.js";
import { CODEX_PLUGIN_DIR } from "../../../src/harness/codex/build.js";

/* Spec 007 D8: both plugins' squeal skills name pytest projects where they name node:test. */

const read = (dir: string, file: string) => readFileSync(join(dir, "skills/squeal", file), "utf8");

describe("the squeal skill names pytest (spec 007 D8)", () => {
  it.each([PLUGIN_DIR, CODEX_PLUGIN_DIR])("in %s", (dir) => {
    expect(read(dir, "SKILL.md")).toContain(
      "the node:test tests of the `nodeTest` projects, the pytest tests of the `pytest` projects,",
    );
    expect(read(dir, "references/reports.md")).toContain("`nodeTest[].slow`, `pytest[].slow`");
    expect(read(dir, "references/commands.md")).toContain(
      "a pytest project's config or a sync of its environment every file of that project",
    );
  });

  it("is the same text in both plugins but for Codex's paragraph on the CLI", () => {
    const codex = read(CODEX_PLUGIN_DIR, "SKILL.md").replace(/\nUnder Codex `squeal`[^\n]*\n/, "");
    expect(codex).toBe(read(PLUGIN_DIR, "SKILL.md"));
  });
});
