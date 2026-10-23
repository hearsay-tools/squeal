import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { countFile } from "../../../src/core/code/count/index.js";
import type { FileCount, FunctionCount } from "../../../src/core/types/code.js";
import { FIXTURES, keyed, languageOf, readReference, referenceKeyed } from "./reference.js";

/*
 * Spec 015 D3, goal 2: the constructs fixtures, one construct per function
 * and then the edges, against ESLint 10.13.0's classic `complexity` and
 * radon 6.0.1, both stored by their own code.
 */

const count = (file: string): Promise<FileCount> =>
  countFile(readFileSync(join(FIXTURES, file), "utf8"), languageOf(file));

const named = (count: FileCount, name: string, occurrence = 0): FunctionCount => {
  const found = count.functions.find(
    (f) => f.qualifiedName === name && f.occurrence === occurrence,
  );
  if (found === undefined) throw new Error(`no ${name}#${occurrence}`);
  return found;
};

describe("the counter on the constructs fixtures (spec 015 D3)", () => {
  it("equals ESLint's classic counts on TS, TSX and CommonJS", async () => {
    const reference = readReference("constructs.eslint.json");
    expect(Object.keys(reference.files).sort()).toEqual(["constructs.ts", "plain.cjs", "view.tsx"]);
    for (const [file, entries] of Object.entries(reference.files)) {
      const counted = await count(file);
      expect({ file, counts: keyed(counted.functions, "end") }).toEqual({
        file,
        counts: referenceKeyed(entries),
      });
      expect(counted.errors).toEqual([]);
    }
  });

  it("equals radon's counts on Python, and adds only the methods radon drops", async () => {
    const counted = await count("constructs.py");
    const reference = referenceKeyed(
      readReference("constructs.radon.json").files["constructs.py"] ?? [],
    );
    const mine = keyed(counted.functions, "start");
    expect(new Map([...mine].filter(([key]) => reference.has(key)))).toEqual(reference);
    // radon reports no method of a class inside a function or a class.
    const extra = counted.functions.filter(
      (f) => !reference.has(`${f.range.startLine}:${f.range.startColumn}`),
    );
    expect(extra.map((f) => [f.qualifiedName, f.complexity])).toEqual([
      ["nested_class_in_function.C.m", 2],
      ["Outer.Inner.m", 2],
    ]);
  });

  it("is 1 plus its decision points by kind, for every function", async () => {
    for (const file of ["constructs.ts", "view.tsx", "plain.cjs", "constructs.py"]) {
      for (const f of (await count(file)).functions) {
        const points = Object.values(f.decisions).reduce((sum, n) => sum + n, 0);
        expect({ name: f.qualifiedName, cc: f.complexity }).toEqual({
          name: f.qualifiedName,
          cc: 1 + points,
        });
      }
    }
  });

  it("names each TS and JS decision point's kind", async () => {
    const ts = await count("constructs.ts");
    const kinds = (name: string) => named(ts, name).decisions;
    expect(kinds("base")).toEqual({});
    expect(kinds("elseIf")).toEqual({ if: 2 });
    expect(kinds("forOf")).toEqual({ loop: 1 });
    expect(kinds("switchFallThrough")).toEqual({ case: 3 });
    expect(kinds("tryCatch")).toEqual({ catch: 1 });
    expect(kinds("nestedTernary")).toEqual({ ternary: 2 });
    expect(kinds("optionalParamType")).toEqual({ logical: 2, "optional-chain": 1 });
    expect(kinds("chainTwice")).toEqual({ "optional-chain": 2 });
    expect(kinds("optCall")).toEqual({ "optional-chain": 1 });
    expect(kinds("arrayDefault")).toEqual({ default: 2 });
    expect(kinds("ternaryDefault")).toEqual({ default: 1, ternary: 1 });
    expect(kinds("orAssign")).toEqual({ "logical-assignment": 2 });
    expect(kinds("Fields.constructor")).toEqual({ default: 1, if: 1 });
    expect(kinds("deep")).toEqual({ if: 4, loop: 1, ternary: 2, catch: 1, logical: 1 });
  });

  it("names each Python decision point's kind, with radon's gaps", async () => {
    const py = await count("constructs.py");
    const kinds = (name: string) => named(py, name).decisions;
    expect(kinds("for_else")).toEqual({ loop: 1, if: 1, else: 1 });
    expect(kinds("try_else")).toEqual({ catch: 1, else: 1 });
    expect(kinds("try_star")).toEqual({});
    expect(kinds("comprehension_if")).toEqual({ comprehension: 2 });
    expect(kinds("nested_comprehension")).toEqual({ comprehension: 5 });
    expect(kinds("assert_operands")).toEqual({ assert: 1 });
    expect(kinds("match_two")).toEqual({ case: 2 });
    expect(kinds("match_captures")).toEqual({ case: 2 });
    expect(kinds("match_capture_last")).toEqual({ case: 2 });
    expect(kinds("or_chain")).toEqual({ logical: 3 });
    expect(kinds("lambda_ternary")).toEqual({ ternary: 1 });
    expect(kinds("default_decision")).toEqual({});
    expect(kinds("decorator_decision")).toEqual({});
  });

  it("counts a nested function on its own, never in its parent", async () => {
    const ts = await count("constructs.ts");
    expect([
      named(ts, "outerWithInner").complexity,
      named(ts, "outerWithInner.<map>").complexity,
    ]).toEqual([1, 2]);
    const py = await count("constructs.py");
    expect([
      named(py, "outer_with_inner").complexity,
      named(py, "outer_with_inner.inner").complexity,
      named(py, "Outer.outer_method").complexity,
      named(py, "Outer.outer_method.closure").complexity,
    ]).toEqual([2, 2, 1, 2]);
  });

  it("counts no class field initializer or static block, as ESLint reports none as a function", async () => {
    const ts = await count("constructs.ts");
    const fields = ts.functions.filter((f) => f.qualifiedName.startsWith("Fields."));
    expect(fields.map((f) => `${f.qualifiedName}#${f.occurrence}`)).toEqual([
      "Fields.constructor#0",
      "Fields.value#0",
      "Fields.value#1",
      "Fields.#hidden#0",
      "Fields.load#0",
      "Fields.[Symbol.iterator]#0",
    ]);
  });
});
