import { describe, expect, it } from "vitest";
import { type Coverage, DEFAULT_COVERAGE } from "../../src/harness/shared/coverage.js";
import { PRIMER_CAP_CHARS, primer } from "../../src/harness/shared/primer.js";
import { CODEX } from "./primer-helpers.js";

/*
 * Row 005-89 (research `hook-messages-2026-11-16.md`, finding 1): in cezar
 * no fold fitted the cap, so every session read the last fold tried, with
 * the CLI unnamed and no path wait. Over the cap, other text goes first:
 * the slow sentences while the listing counts no slow file, then the rest.
 * Row 005-94 (the human, 2026-11-17) replaces 005-89's "a primer that fits
 * today keeps its wait, unchanged": the path wait is tried first in every
 * primer, with the same drops, so every primer in the matrix has it.
 */

const PATH_WAIT = "`squeal status --wait 60000 <path>...`";

/** Cezar's coverage: Vitest and two node:test projects, four groups, slow declared with 0 files. */
const CEZAR: Coverage = {
  ...DEFAULT_COVERAGE,
  vitest: true,
  nodeTest: [
    { name: "test:unit", include: ["packages/cezar/test/unit/*.test.ts"] },
    {
      name: "root:test:unit",
      include: [
        ".github/scripts/*.test.cjs",
        "scripts/*.test.mjs",
        ".ai/skills/*/scripts/*.test.mjs",
      ],
    },
  ],
  slow: { files: 0, requireSlowSuite: false },
  groups: {
    moments: [
      { at: "edit", names: ["lint", "tests"] },
      { at: "pause", names: ["run-loop"] },
      { at: "manual", names: ["browser"] },
    ],
  },
};

const project = (name: string) => ({ name, include: [`${name}/**/*.test.mjs`] });

const PROJECTS: Record<string, Coverage["nodeTest"]> = {
  none: [],
  one: [project("scripts")],
  six: ["scripts", "e2e", "fixtures", "integration", "contracts", "migrations"].map(project),
};

const SLOW: Record<string, Coverage["slow"]> = {
  none: null,
  "not counted": { files: null },
  "0 files": { files: 0 },
  off: { files: 1 },
  "on, three holds": { files: 3, requireSlowSuite: true, maxHolds: 3 },
  "on, between turns": { files: 3, requireSlowSuite: true, pausesOnly: true },
};

const GROUPS: Record<string, Coverage["groups"]> = {
  none: undefined,
  cezar: CEZAR.groups,
  "every moment": {
    moments: [
      { at: "edit", names: ["lint", "unit", "tests"] },
      { at: "pause", names: ["run-loop", "integration"] },
      { at: "stop", names: ["e2e"] },
      { at: "commit", names: ["format"] },
      { at: "manual", names: ["browser", "visual"] },
    ],
  },
  "no test group at edit": {
    moments: [
      { at: "stop", names: ["lint", "unit", "node"] },
      { at: "manual", names: ["browser"] },
    ],
    noTestsAtEdit: true,
  },
};

/** Groups, slow settings, node:test projects beside Vitest or alone, with pytest or without. */
const MATRIX = Object.entries(GROUPS).flatMap(([groups, groupsCoverage]) =>
  Object.entries(SLOW).flatMap(([slow, slowCoverage]) =>
    Object.entries(PROJECTS).flatMap(([projects, nodeTest]) =>
      [true, false].flatMap((beside) =>
        [false, true].map((pytest) => ({
          name: `groups ${groups}, slow ${slow}, ${projects} node:test projects${beside ? " beside Vitest" : ""}${pytest ? ", pytest" : ""}`,
          coverage: {
            ...DEFAULT_COVERAGE,
            vitest: beside || nodeTest.length === 0,
            nodeTest,
            slow: slowCoverage,
            ...(groupsCoverage === undefined ? {} : { groups: groupsCoverage }),
            ...(pytest ? { pytest: [project("py")] } : {}),
          } satisfies Coverage,
        })),
      ),
    ),
  ),
);

describe("a primer over its cap keeps the CLI and the path wait (row 005-89)", () => {
  it("fits cezar's coverage with `squeal` and the path wait", () => {
    const text = primer("squeal", CEZAR);
    expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
    expect(text).toContain(PATH_WAIT);
  });

  it("drops the slow sentences first while no slow file is listed", () => {
    const text = primer("squeal", CEZAR);
    expect(text).not.toContain("Slow test files run");
    expect(text).not.toContain("A slow failure");
  });

  it.each(MATRIX)("fits and names `squeal` under Claude Code: $name", ({ coverage }) => {
    const text = primer("squeal", coverage);
    expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
    expect(text).toContain("`squeal ");
    expect(text).not.toContain("on the CLI SQUEAL messages name");
    // Row 005-94: every primer has the path wait, dropped text or not (it replaced 005-68's
    // plain wait wherever that fitted). Row 019-49: with no test group at `edit`, the narrow run.
    const quiet = coverage.groups?.noTestsAtEdit === true;
    expect(text).toContain(quiet ? "`squeal run <group> <path>... --wait 60000`" : PATH_WAIT);
    expect(text).not.toContain("for example before saying the task is done");
    expect(text).not.toContain("checkpoint");
  });

  it("drops the retry and the hand-run sentence only where the slow ones were not enough", () => {
    const texts = MATRIX.map(({ coverage }) => primer("squeal", coverage));
    expect(texts.some((text) => !text.includes("--reason load"))).toBe(true);
    expect(texts.some((text) => !text.includes("Run tests yourself"))).toBe(true);
    expect(texts.every((text) => text.includes("A revision is"))).toBe(true);
    for (const text of texts.filter((text) => !text.includes("Run tests yourself"))) {
      expect(text).not.toContain("--reason load");
    }
  });

  it.each([CODEX, `/${"x".repeat(209)}/squeal`, `/${"x".repeat(500)}/squeal`])(
    "names a Codex CLI at the wait: %s",
    (command) => {
      const text = primer(command, CEZAR);
      expect(text).toContain(`\`${command} status --wait 60000`);
    },
  );
});
