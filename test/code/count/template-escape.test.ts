import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { countFile } from "../../../src/core/code/count/index.js";
import type { FileCount } from "../../../src/core/types/code.js";

/*
 * Row 020-12: since ES2018 a tagged template may hold an escape that is not
 * valid, such as `\x` with no two hex digits after it (its cooked value is
 * `undefined`, its raw text stays). tree-sitter-tsx 0.23.2 reads every
 * `\x` and `\u` with no valid digits as a parse error, even in a tagged
 * template. The counter parses each such escape in a tagged template as a
 * valid escape of the same length, so every range stays.
 */

const cc = (count: FileCount) => count.functions.map((f) => [f.qualifiedName, f.complexity]);

describe("an escape a tagged template allows (row 020-12)", () => {
  it("parses `\\x` with no hex digits in `String.raw`", async () => {
    const last = "export const after = (a) => a ?? 1;";
    const text = ["const raw = String.raw`\\x`;", last].join("\n");
    const count = await countFile(text, "typescript");
    expect({ errors: count.errors, cc: cc(count) }).toEqual({ errors: [], cc: [["after", 2]] });
    expect(count.functions[0]?.range).toEqual({
      startLine: 2,
      startColumn: last.indexOf("(a)") + 1,
      endLine: 2,
      endColumn: last.length,
    });
  });

  it("parses every `\\x` and `\\u` shape that has no valid digits, in any tag", async () => {
    const text = [
      'describe("a case", () => {',
      '  const thrown = String.raw`closure: expected a path, got "\\x"`;',
      "  const u = String.raw`🎉 é \\u`;",
      "  const brace = tag`\\u{`;",
      "  const short = tag`\\x4 and \\u12`;",
      "  const member = a.b.tag`\\xZ`;",
      `  const sub = String.raw\`\\x\${b ?? 1}\\u\${(c) => c && 2}\`;`,
      "  it('runs', () => expect(thrown).toBe(u || brace));",
      "});",
    ].join("\n");
    const count = await countFile(text, "typescript");
    expect({ errors: count.errors, cc: cc(count) }).toEqual({
      errors: [],
      cc: [
        ["<describe>", 2],
        ["<describe>.<anonymous>", 2],
        ["<describe>.<it>", 2],
      ],
    });
  });

  it("still lists a `\\x` with no hex digits outside a tagged template", async () => {
    // The grammar reads `tag<T>` before a template as comparisons, so that template is untagged.
    const untagged = ["`\\x`", '"\\x"', "'\\u'", `\`a \${String.raw\`b\`} \\x\``, "tag<T>`\\x`"];
    for (const bad of untagged) {
      const text = `const s = ${bad};\nconst t = String.raw\`\\x\`;`;
      const count = await countFile(text, "javascript");
      expect({ bad, lines: count.errors.map((e) => e.startLine) }).toEqual({ bad, lines: [1] });
    }
  });

  it("leaves valid escapes and `\\\\x` as they are", async () => {
    const text =
      "const a = `\\x41\\u0041\\u{41}\\\\x`; const b = String.raw`\\\\u`; const c = /\\x/;";
    expect((await countFile(text, "typescript")).errors).toEqual([]);
  });

  it("hashes the body's own escape, not the one it is parsed as", async () => {
    const hash = async (text: string) =>
      (await countFile(text, "typescript")).functions[0]?.bodyHash;
    const raw = await hash("function f() { return String.raw`\\x`; }");
    expect(raw).not.toBe(await hash("function f() { return String.raw`\\_`; }"));
  });

  it("counts `test/keys/validity/compare.test.ts` with no error range", async () => {
    const text = await readFile(new URL("../../keys/validity/compare.test.ts", import.meta.url));
    expect((await countFile(text.toString(), "typescript")).errors).toEqual([]);
  });
});
