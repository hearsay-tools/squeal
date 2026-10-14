import { describe, expect, it } from "vitest";
import { PRIMER_CAP_CHARS, primer } from "../../../src/harness/shared/primer.js";
import { HARNESSES, NOT_COVERED, primerOf, repoFor, sessionStart } from "../primer-helpers.js";

/*
 * Spec 007 D8: the primer names pytest projects where it names node:test
 * ones (001-234), and a pytest-only repository is never told Vitest is
 * covered (003 D7, review wave 13aa B1).
 */

const SVC = { name: "svc", cwd: "svc", args: [], env: {}, include: ["tests/**/test_*.py"] };
const SCRIPTS = { name: "scripts", argv: [], env: {}, include: ["scripts/*.test.mjs"] };

describe("the primer names pytest projects (spec 007 D8)", () => {
  it.each(HARNESSES)("beside Vitest and node:test, under %s", async (harness) => {
    const r = repoFor({ policy: { nodeTest: [SCRIPTS], pytest: [SVC] }, files: [] });
    const text = primerOf(await sessionStart(r, harness)).primer;
    expect(text).toContain(
      "this repository's Vitest, node:test and pytest tests in the background",
    );
    expect(text).toContain("do not run Vitest, node:test or pytest to learn");
    expect(
      text.endsWith(
        'Squeal covers Vitest (vitest.config.ts), node:test project "scripts" (scripts/*.test.mjs) ' +
          `and pytest project "svc" (svc/tests/**/test_*.py). ${NOT_COVERED}`,
      ),
    ).toBe(true);
  });

  it.each(HARNESSES)("alone, without naming Vitest, under %s", async (harness) => {
    const r = repoFor({
      policy: { pytest: [SVC] },
      vitestConfig: false,
      replace: true,
      files: [{ project: "svc", path: "svc/tests/test_a.py" }],
    });
    const text = primerOf(await sessionStart(r, harness)).primer;
    expect(text).toContain("this repository's pytest tests in the background");
    expect(text).toContain("do not run pytest to learn");
    expect(text).not.toContain("Vitest");
    expect(
      text.endsWith(`Squeal covers pytest project "svc" (svc/tests/**/test_*.py). ${NOT_COVERED}`),
    ).toBe(true);
  });

  it("folds a long pytest list into 'and N more' within the cap", () => {
    const pytest = Array.from({ length: 40 }, (_, i) => ({
      name: `service-${i}`,
      include: [`services/service-${i}/tests/**/test_*.py`, `services/service-${i}/it/*_test.py`],
    }));
    const text = primer("squeal", {
      vitest: false,
      vitestConfig: null,
      nodeTest: [],
      pytest,
      slow: null,
    });
    expect(text.length).toBeLessThanOrEqual(PRIMER_CAP_CHARS);
    expect(text).toMatch(/Squeal covers pytest projects "service-0" \(.* and \d+ more\. /);
    expect(text.endsWith(NOT_COVERED)).toBe(true);
  });
});
