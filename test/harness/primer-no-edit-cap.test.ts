import { describe, expect, it } from "vitest";
import { type Coverage, DEFAULT_COVERAGE } from "../../src/harness/shared/coverage.js";
import { PRIMER_CAP_CHARS, primer } from "../../src/harness/shared/primer.js";
import { CODEX, HARNESSES, primerOf, repoFor, sessionStart } from "./primer-helpers.js";

/*
 * Review 0.1.411, B1 (row 019-49, spec 019 D6 "No test group at `edit`"):
 * the primer stays within `PRIMER_CAP_CHARS` and its folding order. D6's
 * no-edit clause is longer than the clause it replaces, so with a slow tier
 * no fold fitted and the over-cap text was returned (1,590 characters under
 * Claude Code, 1,522 under Codex). Where the full clause leaves no fitting
 * rendering, the same folds run again with a compact clause that keeps the
 * warning; a policy with a test group at `edit` reads as before.
 */

const WARNING = "silence between edits is not a pass";
const FULL = "but no test group runs after each edit, so silence between edits is not a pass;";
const COMPACT =
  ", but not after each edit, so silence between edits is not a pass; a SQUEAL message means a check changed;";

/** The review's reproduction: D6's groups, and the browser group's files declared slow. */
const POLICY = {
  checks: [
    { name: "lint", lint: true, at: "stop" },
    { name: "unit", runner: "vitest", tests: ["test/unit/**"], at: "stop" },
    { name: "node", runner: "vitest", tests: ["test/node/**"], at: "stop" },
    { name: "browser", runner: "vitest", tests: ["test/browser/**"], at: "manual" },
  ],
  slow: { include: ["test/browser/**"] },
};

const GROUPS = {
  moments: [
    { at: "stop" as const, names: ["lint", "unit", "node"] },
    { at: "manual" as const, names: ["browser"] },
  ],
  noTestsAtEdit: true as const,
};

const project = (name: string) => ({ name, include: [`${name}/**/*.test.mjs`] });

/** Node:test projects: none (Vitest's config instead), one, and enough that the list folds. */
const PROJECTS: Record<string, Coverage["nodeTest"]> = {
  none: [],
  one: [project("scripts")],
  folded: ["scripts", "e2e", "fixtures", "integration", "contracts", "migrations"].map(project),
};

const SLOW: Record<string, Coverage["slow"]> = {
  none: null,
  "not counted": { files: null },
  off: { files: 1, requireSlowSuite: false },
  on: { files: 1, requireSlowSuite: true },
  "on, three holds": { files: 1, requireSlowSuite: true, maxHolds: 3 },
  "on, between turns": { files: 1, requireSlowSuite: true, pausesOnly: true },
};

/** `squeal`, a Codex path, and Codex paths too long for the narrow run (task 004-78). */
const COMMANDS: Record<string, string> = {
  squeal: "squeal",
  codex: CODEX,
  "217-character CLI": `/${"x".repeat(209)}/squeal`,
  "500-character CLI": `/${"x".repeat(500)}/squeal`,
};

/** Every command, slow setting and project list; `vitest` beside node:test projects or alone. */
const matrix = (beside: boolean) =>
  Object.entries(COMMANDS).flatMap(([cli, command]) =>
    Object.entries(SLOW).flatMap(([slow, slowCoverage]) =>
      Object.entries(PROJECTS).map(([projects, nodeTest]) => ({
        name: `${cli}, slow ${slow}, ${projects} node:test projects`,
        command,
        coverage: {
          ...DEFAULT_COVERAGE,
          vitest: beside || nodeTest.length === 0,
          nodeTest,
          slow: slowCoverage,
          groups: GROUPS,
        },
      })),
    ),
  );

/** The same coverage with the no-edit flag off: the wording a test group at `edit` gets. */
const edit = (coverage: Coverage): Coverage => ({
  ...coverage,
  groups: { moments: GROUPS.moments },
});

describe("the no-edit primer within its cap (review 0.1.411, B1)", () => {
  it.each(HARNESSES)("fits the review's reproduction under %s", async (harness) => {
    const r = repoFor({
      policy: POLICY as never,
      files: [{ project: "", path: "test/browser/core.test.ts" }],
      replace: true,
    });
    const text = primerOf(await sessionStart(r, harness)).primer;
    expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
    expect(text).toContain(
      `Squeal runs this repository's Vitest tests in the background${COMPACT}`,
    );
    expect(text).toContain("Check groups: lint, unit and node at Stop, and Stop waits for them;");
    expect(text).toContain("Slow test files run after the fast tests;");
  });

  it.each(matrix(false))(
    "stays within the cap with the warning: $name",
    ({ command, coverage }) => {
      const text = primer(command, coverage);
      expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
      expect(text).toContain(WARNING);
      expect(text).not.toContain("passing results stay silent");
      // The compact clause only where D6's clause leaves no rendering within the cap.
      expect(text.includes(COMPACT) || text.includes(FULL)).toBe(true);
      expect(primer(command, edit(coverage))).toContain("and passing results stay silent");
    },
  );

  it.each(matrix(true))(
    "fits wherever the edit wording fits, beside Vitest: $name",
    ({ command, coverage }) => {
      const text = primer(command, coverage);
      expect(text).toContain(WARNING);
      if (primer(command, edit(coverage)).length <= PRIMER_CAP_CHARS) {
        expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
      }
    },
  );

  it("folds the projects and says the compact clause somewhere in the matrix", () => {
    const texts = matrix(false).map(({ command, coverage }) => primer(command, coverage));
    expect(texts.some((text) => text.includes("node:test (6 projects)"))).toBe(true);
    expect(texts.some((text) => text.includes(COMPACT))).toBe(true);
    expect(texts.some((text) => text.includes(FULL))).toBe(true);
  });

  it("keeps D6's clause and the narrow run where they fit", () => {
    const text = primer("squeal", { ...DEFAULT_COVERAGE, slow: null, groups: GROUPS });
    expect(text).toContain(FULL);
    expect(text).toContain("`squeal run <group> <path>... --wait 60000`");
    expect(text).not.toContain(COMPACT);
  });
});
