import { describe, expect, it } from "vitest";
import { DEFAULT_COVERAGE } from "../../src/harness/shared/coverage.js";
import { PRIMER_CAP_CHARS, primer } from "../../src/harness/shared/primer.js";
import { CODEX, primerOf, repoFor, sessionStart } from "./primer-helpers.js";

/*
 * Row 019-16 (spec 019 D6, Testing "Texts"): with a `checks` key the primer
 * names each moment's groups in one sentence, and its first sentence no
 * longer says every test runs after each edit. Read through each harness's
 * own SessionStart, as each names the CLI. Without the key it is today's
 * (`test/status/group-texts-golden.test.ts`).
 */

const POLICY = {
  checks: [
    { name: "e2e", runner: "vitest", tests: ["test/e2e/**"], at: "stop" },
    { name: "unit", runner: "vitest", tests: ["src/**"], at: "edit" },
    { name: "api", runner: "vitest", tests: ["test/api/**"], at: "pause" },
    { name: "lint", lint: true, at: "commit" },
  ],
};

/** A listed file no group selects: the default `tests` group owns it. */
const OTHER = [{ project: "", path: "test/other.test.ts" }];

const MOMENTS =
  "Check groups: unit and tests (the test files no group selects) after each edit; api between your turns; e2e at Stop, and Stop waits for them; lint when you commit;";

describe("the primer names each moment's groups (019 D6)", () => {
  it("under Claude Code, with `squeal run <group>`", async () => {
    const r = repoFor({ policy: POLICY as never, files: OTHER });
    const text = primerOf(await sessionStart(r, "claude-code")).primer;
    expect(text).toMatch(/^Squeal runs this repository's Vitest tests in the background; /);
    expect(text).not.toContain("after each edit; a SQUEAL message");
    expect(text).toContain(`${MOMENTS} \`squeal run <group> --wait 60000\` runs one now.`);
    expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
  });

  it("under Codex, naming the CLI as its other commands do", async () => {
    const r = repoFor({ policy: POLICY as never, files: OTHER });
    const text = primerOf(await sessionStart(r, "codex", CODEX)).primer;
    expect(text).toContain(MOMENTS);
    expect(text).toContain("the CLI's `run <group> --wait 60000` runs one now.");
    expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
  });

  it("leaves out the tests group once no listed file is its", () => {
    const text = primer("squeal", {
      ...DEFAULT_COVERAGE,
      groups: { moments: [{ at: "commit", names: ["lint"] }] },
    });
    expect(text).toContain("Check groups: lint when you commit;");
  });
});
