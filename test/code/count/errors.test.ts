import { describe, expect, it } from "vitest";
import { countFile } from "../../../src/core/code/count/index.js";
import type { FileCount } from "../../../src/core/types/code.js";

/*
 * Spec 015 D3: a range the parser could not read makes each function in it
 * unknown. Valid code the grammar misreads is no such range (row 015-23).
 */

const cc = (count: FileCount) => count.functions.map((f) => [f.qualifiedName, f.complexity]);

describe("the ranges that did not parse (spec 015 D3)", () => {
  it("lists them, and still counts every function it found", async () => {
    const text = [
      "export function before(a) { return a ? 1 : 2; }",
      "export function broken( { if (",
      "export function after(b) { return b && 1; }",
    ].join("\n");
    const count = await countFile(text, "typescript");
    expect(count.errors.length).toBeGreaterThan(0);
    expect(count.errors.every((e) => e.startLine >= 2)).toBe(true);
    expect(count.functions.find((f) => f.qualifiedName === "before")?.complexity).toBe(2);
    const py = await countFile("def ok(a):\n    return a or 1\ndef bad(:\n", "python");
    expect([
      py.errors.length > 0,
      py.functions[0]?.qualifiedName,
      py.functions[0]?.complexity,
    ]).toEqual([true, "ok", 2]);
  });

  it("has none for a file that parses", async () => {
    const count = await countFile("export const f = (a?: number) => a ?? 0;\n", "typescript");
    expect(count.errors).toEqual([]);
  });

  it("has none for TypeScript 5.0's `export type *`, which tree-sitter-tsx 0.23.2 lacks", async () => {
    const text = [
      'export type * from "./x.js";',
      'export type * as Shapes from "./shapes.js";',
      'export /* types */ type *\n  from "./y.js"',
      'declare module "m" { export type * from "./z.js"; }',
      "export function after(a) { return a ? 1 : 2; }",
    ].join("\n");
    const count = await countFile(text, "typescript");
    expect({ errors: count.errors, cc: cc(count) }).toEqual({ errors: [], cc: [["after", 2]] });
  });

  it("still lists an `export type` that is broken", async () => {
    for (const text of ["export type *;", "export type * from;", "export type * frm 'x';"]) {
      expect({ text, parses: (await countFile(text, "typescript")).errors.length === 0 }).toEqual({
        text,
        parses: false,
      });
    }
  });

  it("has none for a raw NUL in a JS string, template or comment", async () => {
    // cezar's `git-worktree.ts`: a NUL inside a function, then a function after it.
    const last = 'const s = "\0"; function after(a) { return a?.b ?? 1; }';
    const text = [
      "export function registered(stdout, path) {",
      "  const listed = stdout.split('\0');",
      "  return listed.some((entry) => entry.startsWith('worktree ') && entry.slice(9) === path);",
      "}",
      `const t = \`a\0\${b ?? 1}\0c\`; // d \0 e`,
      last,
    ].join("\n");
    const count = await countFile(text, "javascript");
    expect({ errors: count.errors, cc: cc(count) }).toEqual({
      errors: [],
      cc: [
        ["registered", 1],
        ["registered.<some>", 2],
        ["after", 3],
      ],
    });
    // A NUL is one UTF-16 unit, as its space is: the ranges after it stay where they were.
    expect(count.functions[2]?.range).toEqual({
      startLine: 6,
      startColumn: 'const s = "\0"; '.length + 1,
      endLine: 6,
      endColumn: last.length + 1,
    });
  });

  it("hashes the body's own NUL, not the space it is parsed as", async () => {
    const hash = async (text: string) =>
      (await countFile(text, "typescript")).functions[0]?.bodyHash;
    const nul = await hash("function f() { return 'a\0b'; }");
    expect(nul).not.toBe(await hash("function f() { return 'a b'; }"));
  });

  it("lists a NUL in Python, whose source never holds one", async () => {
    // CPython: "source code cannot contain null bytes".
    const py = await countFile("def f(a):\n    return '\0'.join(a)\n", "python");
    expect(py.errors.length).toBeGreaterThan(0);
  });
});
