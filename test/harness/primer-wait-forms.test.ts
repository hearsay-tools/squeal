import { describe, expect, it } from "vitest";
import type { Coverage } from "../../src/harness/shared/coverage.js";
import { PRIMER_CAP_CHARS, primer } from "../../src/harness/shared/primer.js";

/*
 * Row 005-122 (quality slice 1; row 005-94's notes, "short" wait form): with the path wait tried
 * first at every drop level, a primer never says the short wait sentence or the plain one that
 * names the CLI: one that fits either also fits the path wait after drops. Only the plain
 * sentence that leaves the CLI unnamed is left, where no drop lets the CLI be named. Proven over
 * every CLI length from 10 to 2,000 characters, beside coverages that make the primer long.
 */

const SHORT = "Wait only when you need a result, as before you finish:";
const PLAIN = "for example before saying the task is done: `";

const projects = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `project-${i}`, include: [`p${i}/**/*.test.mjs`] }));
const base: Coverage = { vitest: true, vitestConfig: "vitest.config.ts", nodeTest: [], slow: null };
const COVERAGES: [string, Coverage][] = [
  ["Vitest alone", base],
  ["slow files, required", { ...base, slow: { files: 3, requireSlowSuite: true, maxHolds: 2 } }],
  ["many node:test projects", { ...base, nodeTest: projects(24), slow: { files: 2 } }],
  [
    "check groups",
    {
      ...base,
      nodeTest: projects(6),
      slow: { files: 1 },
      groups: {
        moments: [
          { at: "edit", names: ["unit", "tests"] },
          { at: "stop", names: ["e2e"] },
          { at: "manual", names: ["parity"] },
        ],
      },
    },
  ],
  [
    "no test group at edit",
    {
      ...base,
      nodeTest: projects(6),
      slow: null,
      groups: {
        moments: [
          { at: "edit", names: ["lint"] },
          { at: "stop", names: ["unit", "node"] },
        ],
        noTestsAtEdit: true,
      },
    },
  ],
];

/*
 * Measured before the removal, per coverage above: the path wait naming the CLI up to 917, 571,
 * 530, 338 and 816 characters, then the path wait with the CLI unnamed (Vitest alone, slow
 * files, no test group at edit) or the plain sentence with the CLI unnamed (many projects,
 * check groups) up to 2,000.
 */

describe("the primer's wait forms (row 005-122, slice 1)", () => {
  it.each(COVERAGES)("never says the short or the CLI-named plain wait: %s", (_, coverage) => {
    const said = new Set<"paths" | "plain, unnamed">();
    for (let length = 10; length <= 2_000; length++) {
      const cli = `/${"c".repeat(length - 1)}`;
      const text = primer(cli, coverage);
      expect(text.length, `CLI of ${length}`).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
      expect(text, `CLI of ${length}`).not.toContain(SHORT);
      expect(text, `CLI of ${length}`).not.toContain(`${PLAIN}${cli}`);
      said.add(text.includes(PLAIN) ? "plain, unnamed" : "paths");
    }
    expect(said.has("paths")).toBe(true);
  });
});
