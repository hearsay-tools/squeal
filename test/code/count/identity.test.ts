import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COUNTER_VERSION, countFile } from "../../../src/core/code/count/index.js";
import type { CodeLanguage, FunctionCount } from "../../../src/core/types/code.js";
import { FIXTURES } from "./reference.js";

/*
 * Spec 015 D2: a function's identity is its qualified name and occurrence;
 * an anonymous one is named by its call site, else by its receiver. The
 * body hash is no part of it and follows a move or a rename.
 */

const functions = async (text: string, language: CodeLanguage = "typescript") =>
  (await countFile(text, language)).functions;

const ids = (list: readonly FunctionCount[]) =>
  list.map((f) => (f.occurrence === 0 ? f.qualifiedName : `${f.qualifiedName}#${f.occurrence}`));

describe("a function's identity (spec 015 D2)", () => {
  it("chains the enclosing classes and functions", async () => {
    const ts = readFileSync(join(FIXTURES, "constructs.ts"), "utf8");
    const names = ids(await functions(ts));
    expect(names).toEqual(
      expect.arrayContaining([
        "K.method",
        "K.prop",
        "K.field",
        "Shape.describe",
        "Klass.m",
        "classInside.Inner.m",
        "withIf",
        "quoted-key",
        "innerDefault.f",
        // A namespace is no class or function, so no part of the chain.
        "inside",
      ]),
    );
    const py = readFileSync(join(FIXTURES, "constructs.py"), "utf8");
    expect(ids(await functions(py, "python"))).toEqual(
      expect.arrayContaining([
        "K.method",
        "K.amethod",
        "Outer.Inner.m",
        "Outer.outer_method.closure",
      ]),
    );
  });

  it("names an anonymous function by the call it is passed to, inside its parent", async () => {
    const text = [
      "export function createDelivery(db) {",
      "  return { deliver: () => db.transaction(() => db.run()) };",
      "}",
      "export function load(xs) {",
      "  xs.forEach((x) => x);",
      "  return new Promise((resolve) => setTimeout(() => resolve(xs.map((x) => x).map((x) => x))));",
      "}",
    ].join("\n");
    expect(ids(await functions(text))).toEqual([
      "createDelivery",
      "createDelivery.deliver",
      "createDelivery.deliver.<transaction>",
      "load",
      "load.<forEach>",
      "load.<new Promise>",
      "load.<new Promise>.<setTimeout>",
      "load.<new Promise>.<setTimeout>.<map>",
      "load.<new Promise>.<setTimeout>.<map>#1",
    ]);
  });

  it("names one that is no argument by the variable, property, field or assignment receiving it", async () => {
    const text = [
      "const plain = () => 1;",
      "const typed = (() => 2) as () => number;",
      "const obj = { key: function () {}, 'quoted-key': () => 3 };",
      "class C { field = () => 4; }",
      "module.exports.handler = async () => 5;",
      "let late; late = () => 6;",
      "export default () => 7;",
      "const curried = (a) => (b) => a + b;",
      "function withDefaults(cb = () => 8, { on = () => 9 } = {}, [z = () => 10] = []) {}",
      "const [first] = [() => 11];",
      "(() => 12)();",
    ].join("\n");
    expect(ids(await functions(text))).toEqual([
      "plain",
      "typed",
      "key",
      "quoted-key",
      "C.field",
      "handler",
      "late",
      "<anonymous>",
      "curried",
      "curried.<anonymous>",
      "withDefaults",
      "withDefaults.cb",
      "withDefaults.on",
      "withDefaults.z",
      "<anonymous>#1",
      "<anonymous>#2",
    ]);
  });

  it("gives functions of one qualified name occurrences in source order", async () => {
    const ts = readFileSync(join(FIXTURES, "constructs.ts"), "utf8");
    const value = (await functions(ts)).filter((f) => f.qualifiedName === "Fields.value");
    expect(value.map((f) => [f.occurrence, f.range.startLine])).toEqual([
      [0, 57],
      [1, 58],
    ]);
    const py = ["def f():", "    pass", "if True:", "    def f():", "        return 1", ""].join(
      "\n",
    );
    expect(ids(await functions(py, "python"))).toEqual(["f", "f#1"]);
    const props = readFileSync(join(FIXTURES, "constructs.py"), "utf8");
    expect(
      ids(await functions(props, "python")).filter((id) => id.startsWith("Outer.prop")),
    ).toEqual(["Outer.prop", "Outer.prop#1"]);
  });

  it("gives a 1-based range whose end is just after the last character", async () => {
    const [f] = await functions("\n  function f() { return 1; }\n");
    expect(f?.range).toEqual({ startLine: 2, startColumn: 3, endLine: 2, endColumn: 29 });
    const [arrow] = await functions("const g = (a) =>\n  a;\n");
    expect(arrow?.range).toEqual({ startLine: 1, startColumn: 11, endLine: 2, endColumn: 4 });
    const [py] = await functions("def h(a):\n    return a\n", "python");
    expect(py?.range).toEqual({ startLine: 1, startColumn: 1, endLine: 2, endColumn: 13 });
  });

  it("counts columns in UTF-16 code units, as V8's ranges do", async () => {
    const [f] = await functions('const s = "żółw🙂"; const f = () => 1;');
    expect(f?.range.startColumn).toBe('const s = "żółw🙂"; const f = '.length + 1);
  });
});

describe("the body hash (spec 015 D2)", () => {
  const hash = async (text: string, language: CodeLanguage = "typescript") =>
    (await functions(text, language)).map((f) => f.bodyHash);

  it("follows a rename, a move into a class and a reindent", async () => {
    const [original] = await hash("function settle(a, b) { return a ?? b; }");
    expect(await hash("function renamed(a, b) { return a ?? b; }")).toEqual([original]);
    expect(
      await hash("class Ledger {\n    settle(a, b) {\n        return a ?? b;\n    }\n}"),
    ).toEqual([original]);
    expect(await hash("function settle(a,b){return a??b;}")).toEqual([original]);
    // A formatter's trailing comma is a change of the text, not of its whitespace.
    expect(await hash("function settle(\n  a,\n  b,\n) {\n  return a ?? b;\n}")).not.toEqual([
      original,
    ]);
  });

  it("changes with an edit to the parameters or the body", async () => {
    const [original] = await hash("function settle(a, b) { return a ?? b; }");
    const [body] = await hash("function settle(a, b) { return a || b; }");
    const [params] = await hash("function settle(a, c) { return a ?? b; }");
    expect(new Set([original, body, params]).size).toBe(3);
  });

  it("leaves a Python function's name and decorators out", async () => {
    const [original] = await hash("def f(a):\n    return a or 1\n", "python");
    expect(await hash("@cache\ndef g(a):\n  return a or 1\n", "python")).toEqual([original]);
    expect(await hash("class K:\n    def f(a):\n        return a or 1\n", "python")).toEqual([
      original,
    ]);
  });
});

describe("the count of a file (spec 015 D3, D4)", () => {
  it("is keyed by the blob, the language and the counter version", async () => {
    const count = await countFile("", "javascript");
    // git's id of the empty blob.
    expect([count.blob, count.language, count.counterVersion]).toEqual([
      "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
      "javascript",
      COUNTER_VERSION,
    ]);
    expect((await countFile("x", "typescript", "a1b2")).blob).toBe("a1b2");
  });

  it("lists the ranges that did not parse, and still counts every function it found", async () => {
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

  it("has no errors for a file that parses", async () => {
    const count = await countFile("export const f = (a?: number) => a ?? 0;\n", "typescript");
    expect(count.errors).toEqual([]);
  });
});
