import { describe, expect, it } from "vitest";
import { registerLint, tellLint } from "../../../src/core/lint/surface/deliver.js";
import {
  lintChanges,
  lintEntryLine,
  lintLines,
  lintRegistrationLine,
  lintStatusLines,
  lintTitleWords,
} from "../../../src/core/lint/surface/format.js";
import type { LintNews, LintStatus } from "../../../src/core/types/lint-delivery.js";
import { finding } from "../helpers.js";
import { consumer, lintRig, ownAfter } from "./helpers.js";

/* Spec 017 D8: the lint lines, in 015's code form. */

const unused = finding("no-unused-vars", "'count' is assigned a value but never used.");

describe("lint lines (017 D8)", () => {
  it("words D8's three examples", () => {
    expect(
      lintEntryLine({
        path: "src/a.ts",
        kind: "pass-to-fail",
        findings: 2,
        added: [unused],
        removed: [],
        revision: 3,
      }),
    ).toBe(
      "FAIL lint: src/a.ts: 2 findings, +1 no-unused-vars ('count' is assigned a value but never used.)",
    );
    expect(
      lintEntryLine({
        path: "src/b.ts",
        kind: "fail-changed",
        findings: 1,
        added: [finding("@typescript-eslint/no-floating-promises", "Promises must be awaited.")],
        removed: [finding("no-console", "Unexpected console statement.")],
        revision: 3,
      }),
    ).toBe(
      "FAIL lint: src/b.ts: 1 finding, +1 @typescript-eslint/no-floating-promises, -1 no-console",
    );
    expect(
      lintEntryLine({
        path: "src/a.ts",
        kind: "fail-to-pass",
        findings: 0,
        added: [],
        removed: [unused],
        revision: 4,
      }),
    ).toBe("PASS lint: src/a.ts: no findings");
  });

  it("words a removed file, a stale FAIL, a parse error, many rules and a result not stored", () => {
    const entry = { path: "src/a.ts", findings: 0, added: [], removed: [], revision: 2 } as const;
    expect(lintEntryLine({ ...entry, kind: "removed", removed: [unused] })).toBe(
      "RESOLVED lint: src/a.ts: deleted or no longer linted",
    );
    expect(
      lintEntryLine({
        ...entry,
        kind: "first-seen-fail",
        findings: 1,
        added: [finding(null, "Parsing error: Unexpected token }\nat line 3")],
        stale: true,
      }),
    ).toBe(
      "FAIL lint: src/a.ts: 1 finding (linted before the last program change), +1 fatal (Parsing error: Unexpected token })",
    );
    const rules = ["a", "b", "c", "d", "e"].map((r) => finding(r, `${r} found`));
    expect(
      lintEntryLine({
        ...entry,
        kind: "fail-changed",
        findings: null,
        added: [...rules, rules[0] ?? unused],
        removed: [],
      }),
    ).toBe("FAIL lint: src/a.ts: findings not stored, +2 a, +1 b, +1 c, +2 more");
  });

  it("puts the summary first, the changes past the cap last, then D9's reasons", () => {
    const news: LintNews = {
      v: 1,
      entries: [
        {
          path: "src/a.js",
          kind: "fail-to-pass",
          findings: 0,
          added: [],
          removed: [],
          revision: 3,
        },
      ],
      more: 3,
      summary: { reason: "config", revision: 2, failing: 14, stale: 0 },
      failed: "eslint.config.js does not load: SyntaxError: Unexpected token.\n    at x",
      off: "the ESLint worker failed 3 times; it exited",
    };
    expect(lintLines(news, "squeal")).toEqual([
      "Lint config changed: 14 files with findings now; squeal lint lists them.",
      "PASS lint: src/a.js: no findings",
      "and 3 more lint changes; squeal lint --changed lists them.",
      "Lint: unknown: eslint.config.js does not load: SyntaxError: Unexpected token.",
      "Lint: off: the ESLint worker failed 3 times; it exited.",
    ]);
    expect(lintChanges(news)).toBe(4);
    expect(lintTitleWords(news)).toBe("4 lint changes");
    const summary = { reason: "first", revision: 1, failing: 1, stale: 2 } as const;
    expect(lintLines({ v: 1, entries: [], more: 0, summary }, "squeal")).toEqual([
      "Lint: 1 file with findings, 2 stale; squeal lint lists them.",
    ]);
    expect(lintTitleWords({ v: 1, entries: [], more: 1 })).toBe("1 lint change");
    expect(lintTitleWords({ v: 1, entries: [], more: 0, summary })).toBeNull();
  });

  it("words each registration", () => {
    const line = (reg: Parameters<typeof lintRegistrationLine>[0]) =>
      lintRegistrationLine(reg, "squeal");
    expect(line({ v: 1, failing: 12, stale: 0 })).toBe(
      "Lint: 12 files with findings; squeal lint lists them.",
    );
    expect(line({ v: 1, failing: 0, stale: 0, linting: { done: 340, total: 600 } })).toBe(
      "Lint: linting, 340 of 600 files.",
    );
    expect(line({ v: 1, failing: 0, stale: 0, linting: { done: 0, total: 0 } })).toBe(
      "Lint: linting has not started.",
    );
    expect(line({ v: 1, failing: 3, stale: 0, off: "ESLint 8 is not supported" })).toBe(
      "Lint: off: ESLint 8 is not supported.",
    );
    expect(line({ v: 1, failing: 0, stale: 0, unreadable: "the file is damaged" })).toBe(
      "Lint: unknown: the lint store cannot be read: the file is damaged.",
    );
  });

  it("words status: counts apart, reasons each a line", () => {
    const status: LintStatus = {
      v: 1,
      files: 600,
      failing: 12,
      sinceRegistration: 2,
      since: "session",
      pending: 0,
      stale: 40,
      unknown: 3,
      reasons: [{ reason: "the ESLint worker timed out after 5000 ms", files: 3 }],
    };
    expect(lintStatusLines(status, "squeal")).toEqual([
      "Lint: 12 files with findings, 2 since this session started, 40 stale, 3 unknown; squeal lint lists them.",
      "Lint: unknown: 3 files: the ESLint worker timed out after 5000 ms.",
    ]);
    expect(
      lintStatusLines(
        {
          ...status,
          since: null,
          stale: 0,
          unknown: 0,
          reasons: [],
          pending: 260,
          linting: { done: 340, total: 600 },
        },
        "squeal",
      ),
    ).toEqual([
      "Lint: 12 files with findings, 260 not linted yet; linting, 340 of 600 files; squeal lint lists them.",
    ]);
  });

  it("words the news the real pass and store give", async () => {
    const rig = await lintRig({ "src/a.js": "ok\n" });
    const me = consumer(rig.tree);
    expect(
      lintRegistrationLine(registerLint(rig.source, me, 5_000) ?? expect.unreachable(), "squeal"),
    ).toBe("Lint: 0 files with findings; squeal lint lists them.");
    rig.tree.write("src/a.js", "bad no-undef\nbad no-undef\n");
    await rig.revise();
    const news = tellLint(rig.source, me, 5_100, () => ownAfter(1));
    expect(lintLines(news ?? expect.unreachable(), "squeal")).toEqual([
      "FAIL lint: src/a.js: 2 findings, +2 no-undef",
    ]);
  });
});
