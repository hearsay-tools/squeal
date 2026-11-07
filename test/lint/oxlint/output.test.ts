import { describe, expect, it } from "vitest";
import { lineHash } from "../../../src/core/lint/fingerprint.js";
import {
  fileResults,
  type OxlintDiagnostic,
  parseRun,
  utf16Column,
} from "../../../src/core/lint/provider/oxlint/output.js";
import type { RelativePath } from "../../../src/core/types/common.js";

/*
 * Spec 017 D11 "Output": oxlint's `--format json` as `LintFinding`s.
 * The JSON below is oxlint 1.90.0's, from `research/probes/oxlint-provider/out`.
 */

const p = (path: string) => path as RelativePath;

function diagnostic(over: Partial<OxlintDiagnostic> & { line: number; column: number }) {
  const { line, column, ...rest } = over;
  return {
    message: "m",
    code: "eslint(eqeqeq)",
    severity: "error",
    filename: "src/a.ts",
    labels: [{ span: { offset: 0, length: 1, line, column } }],
    ...rest,
  };
}

describe("utf16Column", () => {
  it("converts oxlint's UTF-8 byte column to ESLint's UTF-16 column", () => {
    // `out/column.txt`: `==` reads byte column 47; ESLint's column is 44.
    const line = 'export const f = (x: number) => "ü😀" && x == 1;';
    expect(utf16Column(line, 47)).toBe(44);
    expect(line.slice(43, 45)).toBe("==");
  });

  it("keeps an ASCII column and the first column", () => {
    expect(utf16Column("const a = b == c;", 13)).toBe(13);
    expect(utf16Column("ü", 1)).toBe(1);
  });

  it("keeps a column past the line's end as oxlint gave it", () => {
    expect(utf16Column("", 5)).toBe(5);
  });
});

describe("parseRun", () => {
  it("reads oxlint's JSON report", () => {
    const run = parseRun('{ "diagnostics": [], "number_of_files": 2, "number_of_rules": 9 }\n');
    expect(run).toEqual({ report: { diagnostics: [], number_of_files: 2, number_of_rules: 9 } });
  });

  it("names the first line of a run that printed text, not JSON (D9: a config does not load)", () => {
    const text =
      "Failed to parse oxlint configuration file.\n\n  x Failed to load JS plugin: ./nope.mjs\n";
    expect(parseRun(text)).toEqual({ text: "Failed to parse oxlint configuration file." });
  });

  it("reads JSON with no diagnostics array as text", () => {
    expect(parseRun('{ "x": 1 }')).toEqual({ text: '{ "x": 1 }' });
    expect(parseRun("")).toEqual({ text: "" });
  });
});

describe("fileResults", () => {
  const text = 'const s = "ü";\nexport const f = (x: number) => "ü😀" && x == 1;\n';
  const files = new Map([
    [p("src/a.ts"), text],
    [p("src/b.ts"), "export const b = 1;\n"],
  ]);

  it("maps code, message, severity, line and a UTF-16 column, per file in line order", () => {
    const results = fileResults(
      [
        diagnostic({ line: 2, column: 47, message: "Require the use of === and !==" }),
        diagnostic({
          line: 2,
          column: 33,
          code: "eslint(no-constant-binary-expression)",
          severity: "warning",
          message: "Unexpected constant truthiness",
        }),
      ],
      files,
    );
    expect(results.get(p("src/a.ts"))).toEqual({
      findings: [
        {
          rule: "eslint(no-constant-binary-expression)",
          message: "Unexpected constant truthiness",
          severity: "warning",
          line: 2,
          column: 33,
          lineHash: lineHash('export const f = (x: number) => "ü😀" && x == 1;'),
        },
        {
          rule: "eslint(eqeqeq)",
          message: "Require the use of === and !==",
          severity: "error",
          line: 2,
          column: 44,
          lineHash: lineHash('export const f = (x: number) => "ü😀" && x == 1;'),
        },
      ],
    });
    expect(results.get(p("src/b.ts"))).toEqual({ findings: [] });
  });

  it("reads a finding with no code as a parse error: rule null", () => {
    const results = fileResults(
      [diagnostic({ line: 1, column: 1, code: undefined, message: "Unexpected token" })],
      files,
    );
    expect(results.get(p("src/a.ts"))).toMatchObject({
      findings: [{ rule: null, message: "Unexpected token", severity: "error" }],
    });
  });

  it("drops the suppressions finding with an empty filename, and files not asked for", () => {
    const results = fileResults(
      [
        diagnostic({
          line: 0,
          column: 0,
          filename: "",
          code: undefined,
          message: "There are new violations not covered by the suppressions file.",
        }),
        diagnostic({ line: 1, column: 1, filename: "src/other.ts" }),
      ],
      files,
    );
    expect([...results.keys()]).toEqual(["src/a.ts", "src/b.ts"]);
    expect(results.get(p("src/a.ts"))).toEqual({ findings: [] });
  });

  it("reads a JS plugin's error as `unknown` for its file, naming the error", () => {
    const message =
      "Error running JS plugin.\nFile path: /tmp/x/src/a.ts\nError: rule exploded\n    at Object.create (file:///tmp/x/throw.mjs:1:79)";
    const results = fileResults(
      [diagnostic({ line: 0, column: 0, code: undefined, message })],
      files,
    );
    expect(results.get(p("src/a.ts"))).toEqual({
      unknown: "a JS plugin failed: Error: rule exploded",
    });
    expect(results.get(p("src/b.ts"))).toEqual({ findings: [] });
  });

  it("gives a finding with no label line and column 0", () => {
    const results = fileResults([{ ...diagnostic({ line: 1, column: 1 }), labels: [] }], files);
    expect(results.get(p("src/a.ts"))).toMatchObject({ findings: [{ line: 0, column: 0 }] });
  });
});
