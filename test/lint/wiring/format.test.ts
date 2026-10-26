import { describe, expect, it } from "vitest";
import {
  lintEntryLine,
  lintLines,
  lintRegistrationLine,
  lintTitleWords,
} from "../../../src/core/delivery/lint-format.js";
import type { LintFinding, LintTransitionKind } from "../../../src/core/types/lint.js";
import type { LintNewsEntry } from "../../../src/core/types/lint-delivery.js";
import { finding } from "../helpers.js";

/* Spec 017 D8: the lint lines a delivery and a registration show. */

const UNUSED = finding("no-unused-vars", "'count' is assigned a value but never used.");
const FLOATING = finding("@typescript-eslint/no-floating-promises", "Promises must be awaited.");
const CONSOLE = finding("no-console", "Unexpected console statement.");

function entry(
  kind: LintTransitionKind,
  path: string,
  findings: number | null,
  added: readonly LintFinding[] = [],
  removed: readonly LintFinding[] = [],
): LintNewsEntry {
  return { path, kind, findings, added, removed, revision: 4 };
}

describe("lint lines (017 D8)", () => {
  it("words a FAIL with the findings added and removed, a PASS and a removed file", () => {
    expect(lintEntryLine(entry("fail-changed", "src/a.ts", 2, [UNUSED]))).toBe(
      "FAIL lint: src/a.ts: 2 findings, +1 no-unused-vars ('count' is assigned a value but never used.)",
    );
    expect(lintEntryLine(entry("fail-changed", "src/b.ts", 1, [FLOATING], [CONSOLE]))).toBe(
      "FAIL lint: src/b.ts: 1 finding, +1 @typescript-eslint/no-floating-promises (Promises must be awaited.), -1 no-console",
    );
    expect(lintEntryLine(entry("fail-to-pass", "src/a.ts", 0, [], [UNUSED]))).toBe(
      "PASS lint: src/a.ts: no findings",
    );
    expect(lintEntryLine(entry("removed", "src/c.ts", 0))).toBe(
      "RESOLVED lint: src/c.ts: no longer linted",
    );
  });

  it("counts one rule's findings together and names a parse error by its message", () => {
    const parse = finding(null, "Parsing error: ')' expected.\nat line 3");
    expect(
      lintEntryLine(entry("first-seen-fail", "src/d.ts", 3, [CONSOLE, { ...CONSOLE }, parse])),
    ).toBe(
      "FAIL lint: src/d.ts: 3 findings, +2 no-console (Unexpected console statement.), +1 Parsing error: ')' expected.",
    );
  });

  it("drops a rule's message when its findings say different things", () => {
    const other = finding("no-console", "Unexpected console.log.");
    expect(lintEntryLine(entry("pass-to-fail", "src/e.ts", 2, [CONSOLE, other]))).toBe(
      "FAIL lint: src/e.ts: 2 findings, +2 no-console",
    );
  });

  it("gives no count for a result no longer stored, and says when a FAIL is stale", () => {
    expect(
      lintEntryLine({ ...entry("pass-to-fail", "src/f.ts", null, [UNUSED]), stale: true }),
    ).toBe(
      "FAIL lint: src/f.ts: +1 no-unused-vars ('count' is assigned a value but never used.); stale: an input it reads changed, linted again when the agent is idle",
    );
  });

  it("orders the reasons and the summary before the changes, and counts the rest", () => {
    const summary = { reason: "config", revision: 7, failing: 14, stale: 0 } as const;
    const lines = lintLines(
      {
        v: 1,
        entries: [entry("pass-to-fail", "src/a.ts", 1, [UNUSED])],
        more: 3,
        summary,
        failed: "eslint.config.js does not load: Cannot find package 'x'.",
      },
      "squeal",
    );
    expect(lines).toEqual([
      "Lint: unknown: eslint.config.js does not load: Cannot find package 'x'.",
      "Lint config changed: 14 files with findings now; squeal lint lists them.",
      "FAIL lint: src/a.ts: 1 finding, +1 no-unused-vars ('count' is assigned a value but never used.)",
      "and 3 more lint changes; squeal lint --changed lists them.",
    ]);
    expect(
      lintLines(
        { v: 1, entries: [], more: 0, summary: { ...summary, reason: "first", stale: 2 } },
        "sq",
      ),
    ).toEqual(["Lint checked every file: 14 files with findings, 2 stale; sq lint lists them."]);
  });

  it("titles the changes, listed or by number, and nothing for a summary alone", () => {
    const one = entry("fail-to-pass", "src/a.ts", 0);
    expect(lintTitleWords({ v: 1, entries: [one], more: 0 })).toBe("1 lint change");
    expect(lintTitleWords({ v: 1, entries: [one], more: 5 })).toBe("6 lint changes");
    const summary = { reason: "config", revision: 7, failing: 2, stale: 0 } as const;
    expect(lintTitleWords({ v: 1, entries: [], more: 0, summary })).toBeNull();
  });

  it("registers by count, by the first pass's progress, or why lint cannot say more", () => {
    expect(lintRegistrationLine({ v: 1, failing: 12, stale: 0 }, "squeal")).toBe(
      "Lint: 12 files with findings; squeal lint lists them.",
    );
    expect(
      lintRegistrationLine(
        { v: 1, failing: 0, stale: 0, linting: { done: 340, total: 600 } },
        "sq",
      ),
    ).toBe("Lint: linting, 340 of 600 files.");
    expect(
      lintRegistrationLine({ v: 1, failing: 0, stale: 0, off: "ESLint 8 is not supported." }, "sq"),
    ).toBe("Lint: off: ESLint 8 is not supported.");
    expect(
      lintRegistrationLine(
        { v: 1, failing: 3, stale: 0, unreadable: "the file is damaged (x)" },
        "sq",
      ),
    ).toBe("Lint: the lint store cannot be read: the file is damaged (x).");
  });
});
