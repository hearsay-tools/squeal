import { describe, expect, it } from "vitest";
import { DEFAULT_COVERAGE } from "../../src/harness/shared/coverage.js";
import { PRIMER_CAP_CHARS, primer } from "../../src/harness/shared/primer.js";
import { CODEX, primerOf, repoFor, sessionStart } from "./primer-helpers.js";

/*
 * Row 019-49 (spec 019 D6, "No test group at `edit`"): with no test group at
 * `edit`, nothing runs between edits, so the primer's first sentence says
 * silence between edits is not a pass, and its path wait is the narrow run.
 * The default `tests` group counts only while it owns a listed file. A
 * policy with a test group at `edit` reads as before. Row 005-94: no
 * checkpoint in the wait, and the narrow run tried before any shorter wait.
 */

/** D6's example: every test group at `stop` or `manual`, lint at `stop`. */
const POLICY = {
  checks: [
    { name: "lint", lint: true, at: "stop" },
    { name: "unit", runner: "vitest", tests: ["test/unit/**"], at: "stop" },
    { name: "node", runner: "vitest", tests: ["test/node/**"], at: "stop" },
    { name: "browser", runner: "vitest", tests: ["test/browser/**"], at: "manual" },
  ],
};

/** Listed files every one of which a group owns: the default `tests` group has none. */
const OWNED = [
  { project: "", path: "test/unit/a.test.ts" },
  { project: "", path: "test/node/b.test.ts" },
  { project: "", path: "test/browser/c.test.ts" },
];

const D6_EXAMPLE =
  "Squeal runs this repository's Vitest tests in the background, but no test group runs after each edit, so silence between edits is not a pass; a SQUEAL message with your next tool call means a check changed; do not run Vitest to learn whether your edits broke something. Check groups: lint, unit and node at Stop, and Stop waits for them; browser waits for `squeal run browser`; `squeal run <group> --wait 60000` runs one now. Before you rely on a result for files you changed: `squeal run <group> <path>... --wait 60000`; `squeal status --wait 60000` before you finish.";

describe("the primer with no test group at edit (019-49)", () => {
  it("says D6's words under Claude Code, within the cap", async () => {
    const r = repoFor({ policy: POLICY as never, files: OWNED, replace: true });
    const text = primerOf(await sessionStart(r, "claude-code")).primer;
    expect(text.startsWith(D6_EXAMPLE)).toBe(true);
    expect(text).not.toContain("passes stay silent");
    expect(text).not.toContain("status --wait 60000 <path>...");
    expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
  });

  it("names the narrow run as Codex names its first command", async () => {
    const r = repoFor({ policy: POLICY as never, files: OWNED, replace: true });
    const text = primerOf(await sessionStart(r, "codex", CODEX)).primer;
    expect(text).toContain(
      "in the background, but no test group runs after each edit, so silence between edits is not a pass;",
    );
    expect(text).toContain(
      `Before you rely on a result for files you changed: \`${CODEX} run <group> <path>... --wait 60000\`; the CLI's \`status --wait 60000\` before you finish.`,
    );
    expect(text).not.toContain("passes stay silent");
    expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
  });

  it("reads as before while the default tests group owns a listed file", async () => {
    const files = [...OWNED, { project: "", path: "test/other.test.ts" }];
    const r = repoFor({ policy: POLICY as never, files, replace: true });
    const text = primerOf(await sessionStart(r, "claude-code")).primer;
    expect(text).toContain(
      "in the background; a SQUEAL message with your next tool call means a check changed; passes stay silent unless they follow a failure, so keep working;",
    );
    expect(text).toContain("tests (the test files no group selects) after each edit");
    expect(text).toContain("`squeal status --wait 60000 <path>...` for the verdict");
    expect(text).not.toContain("silence between edits");
  });

  it("reads as before with a checks test group at edit", async () => {
    const policy = {
      checks: [...POLICY.checks, { name: "fast", runner: "vitest", at: "edit" }],
    };
    const r = repoFor({ policy: policy as never, files: OWNED, replace: true });
    const text = primerOf(await sessionStart(r, "codex", CODEX)).primer;
    expect(text).toContain("; passes stay silent unless they follow a failure, so keep working;");
    expect(text).toContain(`\`${CODEX} status --wait 60000 <path>...\``);
    expect(text).not.toContain("silence between edits");
  });

  it("counts a lint group at edit as no test group", async () => {
    const policy = { checks: [{ ...POLICY.checks[0], at: "edit" }, ...POLICY.checks.slice(1)] };
    const r = repoFor({ policy: policy as never, files: OWNED, replace: true });
    const text = primerOf(await sessionStart(r, "claude-code")).primer;
    expect(text).toContain("Check groups: lint after each edit;");
    expect(text).toContain("silence between edits is not a pass");
  });

  // Row 005-94: the narrow run with the CLI named comes before any shorter wait, with text
  // dropped in row 005-89's order; a CLI too long for it even then goes unnamed.
  it("keeps the folding order: the narrow run names a long CLI, and none too long for it", () => {
    const groups = {
      moments: [{ at: "stop" as const, names: ["unit"] }],
      noTestsAtEdit: true as const,
    };
    for (const length of [400, 500]) {
      const fits = `/${"x".repeat(length)}/squeal`;
      const text = primer(fits, { ...DEFAULT_COVERAGE, groups });
      expect(text).toContain(
        `Before you rely on a result for files you changed: \`${fits} run <group> <path>... --wait 60000\`;`,
      );
      expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
    }
    const long = `/${"x".repeat(1_000)}/squeal`;
    const text = primer(long, { ...DEFAULT_COVERAGE, groups });
    expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
    expect(text).toContain("silence between edits is not a pass");
    expect(text).toContain(
      "Before you rely on a result for files you changed, on the CLI SQUEAL messages name: `run <group> <path>... --wait 60000`; `status --wait 60000` before you finish.",
    );
    expect(text).not.toContain(long);
  });
});
