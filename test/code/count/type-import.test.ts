import { describe, expect, it } from "vitest";
import { countFile } from "../../../src/core/code/count/index.js";
import type { FileCount } from "../../../src/core/types/code.js";

/*
 * Row 015-29: tree-sitter-tsx 0.23.2 reads `f<typeof import("x")>()` and
 * `f<import("x").T>()` as comparisons. The counter parses each such
 * `import("x")` as an identifier of the same length, and reads names and
 * body hashes from the file's own text. Each CC below is ESLint 10.13.0's
 * `complexity` on `@typescript-eslint/parser` 8.72.0 for the same text.
 */

const cc = (count: FileCount) => count.functions.map((f) => [f.qualifiedName, f.complexity]);

describe("`import(…)` in a type argument (row 015-29)", () => {
  it("parses `typeof import(…)` in a call's type argument, as in `vi.mock`", async () => {
    const last = "const e = f<typeof import ('x')>(); export const g = (v) => v || 1;";
    const text = [
      'vi.mock("./x.js", async (importOriginal) => {',
      '  const actual = await importOriginal<typeof import("./x.js")>();',
      "  return { ...actual, f: (a?: number) => a ?? 0 };",
      "});",
      "const a = f<typeof import('x').Y>();",
      "const b = f<typeof import('x'), string>();",
      "const c = f<import('x').T>();",
      "const d = vi.importActual<typeof import('x')>('x', (m) => m && 1);",
      last,
    ].join("\n");
    const count = await countFile(text, "typescript");
    expect({ errors: count.errors, cc: cc(count) }).toEqual({
      errors: [],
      cc: [
        ["<mock>", 1],
        ["<mock>.f", 2],
        ["<importActual>", 2],
        ["g", 2],
      ],
    });
    // The identifier is as long as the `import(…)` it stands for: the ranges after it stay.
    expect(count.functions[3]?.range).toEqual({
      startLine: 9,
      startColumn: last.indexOf("(v)") + 1,
      endLine: 9,
      endColumn: last.length,
    });
  });

  it("parses `import(…).T` in a type argument in a file with no semicolons", async () => {
    // cezar's `composer.test.tsx`, whose whole tree was one `ERROR`.
    const text = [
      "describe('composer', () => {",
      "  it('sets the draft', async () => {",
      "    const handle = React.createRef<import('./composer').ComposerHandle>()",
      "    const { textarea } = renderComposer({ ref: handle })",
      "    act(() => handle.current?.setDraft('hi'))",
      "    expect(textarea.value).toBe('hi')",
      "  })",
      "  it('reports whether it acted', () => {",
      "    const open = React.createRef<import('./composer').ComposerHandle>()",
      "    expect(open.current?.submit() ?? false).toBe(false)",
      "  })",
      "})",
    ].join("\n");
    const count = await countFile(text, "typescript");
    expect({ errors: count.errors, cc: cc(count) }).toEqual({
      errors: [],
      cc: [
        ["<describe>", 1],
        ["<describe>.<it>", 1],
        ["<describe>.<it>.<act>", 2],
        ["<describe>.<it>", 3],
      ],
    });
  });

  it("reads the same text in a string, a template and a comment as written", async () => {
    const text = [
      `const o = { "f<typeof import('./x.js')>()": (a) => a ?? 1 };`,
      "const p = { [`g<import('./c').H>()`]: (a) => a ?? 1 };",
      "function h(a) {",
      "  // a<typeof import('./x.js')>, import('./y.js')",
      "  return a ?? 1;",
      "}",
    ].join("\n");
    const count = await countFile(text, "typescript");
    expect({ errors: count.errors, cc: cc(count) }).toEqual({
      errors: [],
      cc: [
        ["f<typeof import('./x.js')>()", 2],
        ["[`g<import('./c').H>()`]", 2],
        ["h", 2],
      ],
    });
    // The body hash is the comment's own text, not the identifier it is parsed as.
    const blanked = text.replace(/import\('[^']*'\)/g, (m) => "_".repeat(m.length));
    const hashOfH = async (t: string) => (await countFile(t, "typescript")).functions[2]?.bodyHash;
    expect(await hashOfH(text)).not.toBe(await hashOfH(blanked));
  });
});
