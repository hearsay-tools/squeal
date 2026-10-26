import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type EslintFileResult, eslintFindings } from "../../src/core/lint/eslint.js";
import { lintTransition } from "../../src/core/lint/transition.js";
import type { LintChange, LintFinding } from "../../src/core/types/lint.js";

/*
 * Spec 017 goal 4: 016-33's seven ESLint edits, as ESLint 10.13.0 reported
 * them (`diagnostic-identity.md` Q2), through the findings, the fingerprint
 * and the transition function, give the a-set column: every notice true.
 */

const OUT = fileURLToPath(
  new URL(
    "../../docs/specifications/016-extensions/research/probes/diagnostic-identity/out/js/",
    import.meta.url,
  ),
);

/** Each state's findings by file name, `s0-baseline` to `s7-change-type-in-b-only`. */
function states(): [string, Map<string, readonly LintFinding[]>][] {
  return readdirSync(OUT)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => {
      const results = JSON.parse(readFileSync(join(OUT, name), "utf8")) as EslintFileResult[];
      const files = new Map(
        results.map((r) => [basename(r.filePath), eslintFindings(r.messages, r.source ?? "")]),
      );
      return [name.replace(/\.json$/, ""), files];
    });
}

function told(f: LintFinding): string {
  return `${f.rule} (${f.message}) @${f.line}`;
}

function notice(file: string, change: LintChange): string {
  const added = change.added.map((f) => ` +${told(f)}`).join("");
  const removed = change.removed.map((f) => ` -${told(f)}`).join("");
  return `${file} ${change.kind}${added}${removed}`;
}

describe("the 016-33 replay with ESLint (017 goal 4)", () => {
  it("gives the a-set column: one true notice per changed file, none for a move of lines", () => {
    const replay = states();
    expect(replay.map(([state]) => state)).toHaveLength(8);
    const notices: Record<string, string[]> = {};
    let before = new Map<string, readonly LintFinding[]>();
    for (const [state, after] of replay) {
      notices[state] = [...after.keys()].flatMap((file) => {
        const change = lintTransition(before.get(file) ?? null, after.get(file) ?? null);
        return change === null ? [] : [notice(file, change)];
      });
      before = after;
    }
    const unused = (name: string, line: number) =>
      `no-unused-vars ('${name}' is assigned a value but never used.) @${line}`;
    const undef = (name: string, line: number) => `no-undef ('${name}' is not defined.) @${line}`;
    expect(notices).toEqual({
      "s0-baseline": [
        `a.js first-seen-fail +${unused("count", 4)} +${undef("report", 5)} +${undef("notify", 10)}`,
      ],
      "s1-insert-line-above": [],
      // The message did change: it names the variable.
      "s2-rename-named-variable": [
        `a.js fail-changed +${unused("tally", 5)} -${unused("count", 5)}`,
      ],
      "s3-add-identical-finding": [`a.js fail-changed +${undef("report", 16)}`],
      // Two identical findings: the match names the second one, and the count is right (D2).
      "s4-fix-first-of-two-identical": [`a.js fail-changed -${undef("report", 16)}`],
      // True per file: `b` passed at s0 and fails now.
      "s5-move-function-to-other-file": [
        `a.js fail-changed -${undef("notify", 10)}`,
        `b.js pass-to-fail +${undef("notify", 4)}`,
      ],
      "s6-fix-last-finding-of-b": [`b.js fail-to-pass -${undef("notify", 4)}`],
      "s7-change-type-in-b-only": [],
    });
  });
});
