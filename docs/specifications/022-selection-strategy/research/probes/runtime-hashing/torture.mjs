// Throwaway: torture pairs for the Candidate B prototype. Each pair says whether the two
// texts must hash the same (runtime-equal, same lines), differently, or fall back to raw bytes.
import { normalize } from "./strip.mjs";

const S = "same";
const D = "diff";
const F = "fallback";
/** [name, ext, a, b, expect for exact, for norm (default: exact's), for trim (default: exact's)] */
export const CASES = [
  // Comments and things that look like comments.
  ["comment edit", ".ts", "const a = 1; // one\n", "const a = 1; // uno\n", S],
  ["comment in string", ".ts", "const a = '// x';\n", "const a = '// y';\n", D],
  ["comment in template", ".ts", "const a = `/* x */`;\n", "const a = `/* y */`;\n", D],
  ["comment in regex", ".ts", "const a = /\\/\\/x/;\n", "const a = /\\/\\/y/;\n", D],
  ["jsx text slashes", ".tsx", "const a = <div>// x</div>;\n", "const a = <div>// y</div>;\n", D],
  ["jsx comment (JSX kept verbatim)", ".tsx", "const a = <div>{/* x */}</div>;\n", "const a = <div>{/* y */}</div>;\n", S],
  ["hashbang", ".mjs", "#!/usr/bin/env node\nx();\n", "#!/usr/bin/env bun\nx();\n", D],
  ["use strict vs comment", ".cjs", "'use strict';\nx();\n", "// use strict\nx();\n", D],
  ["triple slash", ".ts", "/// <reference types=\"a\" />\nx();\n", "/// <reference types=\"b\" />\nx();\n", S],
  ["sourceMappingURL", ".js", "x();\n//# sourceMappingURL=a.map\n", "x();\n//# sourceMappingURL=b.map\n", F],
  ["block comment newline ASI", ".ts", "function f(){return/*\n*/1}\n", "function f(){return/* */\n1}\n", D, S],
  ["block comment removes newline", ".ts", "function f(){return/*\n*/1}\n", "function f(){return/**/1}\n", D],
  ["glue a/* */b", ".js", "x = a/* */-b;\n", "x = a-/* */b;\n", D, D],
  ["minus minus spacing", ".js", "x = a - -b;\n", "x = a -  - b;\n", D, D],
  ["1/**/in x", ".js", "y = 1/**/in x;\n", "y = 1 in x;\n", D, S],
  // TypeScript erasable syntax.
  ["annotation edit", ".ts", "const x: number = 1;\n", "const x: string = 1;\n", S],
  ["annotation length (column shift)", ".ts", "const x: A = f();\n", "const x: LongerName = f();\n", D, S],
  ["import type", ".ts", "import type { A } from './a';\nx();\n", "import type { B } from './b';\nx();\n", S],
  ["inline type specifier", ".ts", "import { type A, B } from './a';\n", "import { type C, B } from './a';\n", S],
  ["all-type inline keeps side effect", ".ts", "import { type A } from './side';\n", "import type { A } from './side';\n", D],
  ["all-type inline vs bare import", ".ts", "import { type A } from './side';\n", "import {} from './side';\n", D, D],
  ["value import gains type", ".ts", "import { A } from './a';\n", "import { type A } from './a';\n", D],
  ["export type", ".ts", "export type { A } from './a';\nx();\n", "export type { B } from './a';\nx();\n", S],
  ["export type star", ".ts", "export type * from './a';\nx();\n", "export type * from './b';\nx();\n", `${F}|${S}`],
  ["interface", ".ts", "interface I { a: number }\nx();\n", "interface I { a: string }\nx();\n", S],
  ["type alias", ".ts", "type T = 1;\nx();\n", "type T = 2;\nx();\n", S],
  ["declare const", ".ts", "declare const z: number;\nx();\n", "declare const z: string;\nx();\n", S],
  ["declare field vs field", ".ts", "class K { declare y: number }\n", "class K { y: number }\n", D],
  ["field type", ".ts", "class K { y: number }\n", "class K { y: string }\n", S],
  ["definite field", ".ts", "class K { y!: number }\n", "class K { y: number }\n", D, S],
  ["overload", ".ts", "function g(a: string): void;\nfunction g(a: any) {}\n", "function g(a: number): void;\nfunction g(a: any) {}\n", S],
  ["method overload", ".ts", "class C { m(a: string): void;\nm(a) {} }\n", "class C { m(a: number): void;\nm(a) {} }\n", S],
  ["abstract method", ".ts", "abstract class A { abstract m(): void; }\n", "abstract class A { abstract n(): void; }\n", S],
  ["implements", ".ts", "class B implements I {}\n", "class B implements J {}\n", S],
  ["override", ".ts", "class B extends A { override q = 1 }\n", "class B extends A { q = 1 }\n", D, S],
  ["readonly field", ".ts", "class B { readonly q = 1 }\n", "class B { q = 1 }\n", D, S],
  ["visibility", ".ts", "class B { private q = 1 }\n", "class B { public  q = 1 }\n", S],
  ["parameter property", ".ts", "class P { constructor(public x: number) {} }\n", "class P { constructor(x: number) {} }\n", D],
  ["parameter property type", ".ts", "class P { constructor(public x: number) {} }\n", "class P { constructor(public x: string) {} }\n", S],
  ["readonly param property", ".ts", "class P { constructor(readonly x) {} }\n", "class P { constructor(x) {} }\n", D],
  ["this parameter", ".ts", "function h(this: A, a) {}\n", "function h(this: B, a) {}\n", S],
  ["this parameter removed", ".ts", "function h(this: A, a) {}\n", "function h(a) {}\n", D, D],
  ["as", ".ts", "const v = a as A;\n", "const v = a as B;\n", S],
  ["satisfies", ".ts", "const v = a satisfies A;\n", "const v = a satisfies B;\n", S],
  ["non-null", ".ts", "const v = a!.b;\n", "const v = a.b;\n", D, D],
  ["x! + 1", ".ts", "y = x! + 1;\n", "y = x + 1;\n", D, S],
  ["generic call", ".ts", "f<A>(x);\n", "f<B>(x);\n", S],
  ["generic call in js is comparison", ".js", "f<A>(x);\n", "f<B>(x);\n", F],
  ["enum", ".ts", "enum E { A }\n", "enum E { B }\n", D],
  ["const enum", ".ts", "const enum E { A }\n", "const enum E { B }\n", F],
  ["declare const enum", ".ts", "declare const enum E { A }\n", "declare const enum E { B }\n", F],
  ["namespace types", ".ts", "namespace N { export type X = 1 }\n", "namespace N { export type X = 2 }\n", S],
  ["namespace value", ".ts", "namespace N { export const x = 1 }\n", "namespace N { export const x = 2 }\n", D],
  ["decorator", ".ts", "@a class Q {}\n", "@b class Q {}\n", D],
  ["decorated param type", ".ts", "class Q { m(@a x: A) {} }\n", "class Q { m(@a x: B) {} }\n", S],
  ["using", ".ts", "{ using r = f(); }\n", "{ using r = g(); }\n", D],
  ["accessor", ".ts", "class R { accessor a = 1 }\n", "class R { a = 1 }\n", D],
  ["angle cast in ts", ".ts", "const c = <any>x;\n", "const c = <unknown>x;\n", `${F}|${D}`, `${F}|${S}`],
  ["arrow generic", ".tsx", "const g = <T,>(x: T) => x;\n", "const g = <U,>(x: U) => x;\n", S],
  ["typeof import in type arg", ".ts", "vi.mock(async (o) => o<typeof import('./a')>());\n", "vi.mock(async (o) => o<typeof import('./b')>());\n", `${F}|${S}`],
  ["tagged template bad escape", ".ts", "String.raw`\\x`;\n", "String.raw`\\y`;\n", `${F}|${D}`],
  // Line positions.
  ["type adds a line", ".ts", "type T = 1;\nx();\n", "type T =\n  1;\nx();\n", D],
  ["comment edit, longer", ".ts", "x(); // a\n", "x(); // a longer note\n", D, S, S],
  ["comment adds a line", ".ts", "x();\n", "// note\nx();\n", D],
  ["multi-line comment same lines", ".ts", "/* a\n b */\nx();\n", "/* cc\n dd */\nx();\n", D, S, S],
  // Whitespace.
  ["trailing spaces", ".ts", "x();   \n", "x();\n", D, S, S],
  ["indent", ".ts", "if (a) {\n  x();\n}\n", "if (a) {\n    x();\n}\n", D, S],
  ["spaces in template", ".ts", "const s = `a  b`;\n", "const s = `a b`;\n", D],
  ["spaces in jsx text", ".tsx", "const e = <p>a  b</p>;\n", "const e = <p>a b</p>;\n", D],
  ["space between jsx children", ".tsx", "const e = <p><b/> <i/></p>;\n", "const e = <p><b/><i/></p>;\n", D],
  // Magic comments.
  ["vitest env", ".ts", "// @vitest-environment jsdom\nx();\n", "// @vitest-environment node\nx();\n", F],
  ["vite-ignore", ".ts", "import(/* @vite-ignore */ p);\n", "import(p);\n", F],
  ["pure", ".js", "x = /* #__PURE__ */ f();\n", "x = f();\n", F],
  ["v8 ignore", ".ts", "/* v8 ignore next */\nx();\n", "/* note */\nx();\n", F],
  ["jsx pragma", ".tsx", "/** @jsxImportSource preact */\nx();\n", "/** note */\nx();\n", F],
  ["magic text inside string only", ".ts", "const s = '@vitest-environment jsdom';\n", "const s = '@vitest-environment node';\n", D],
];

export async function runCases() {
  const rows = [];
  for (const [name, ext, a, b, expExact, expNorm = expExact, expTrim = expExact] of CASES) {
    const ra = await normalize(a, ext);
    const rb = await normalize(b, ext);
    let exact, norm, trim;
    if (!ra.ok || !rb.ok) {
      exact = norm = trim = F;
    } else {
      exact = ra.exact === rb.exact ? S : D;
      norm = ra.norm === rb.norm ? S : D;
      trim = ra.trim === rb.trim ? S : D;
    }
    const reason = !ra.ok ? ra.reason : !rb.ok ? rb.reason : "";
    rows.push({ name, ext, exact, expExact, norm, expNorm, trim, expTrim, reason, ok: [exact, expExact, norm, expNorm, trim, expTrim].every((v, i, a) => i % 2 === 1 || a[i + 1].split("|").includes(v)) });
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = await runCases();
  for (const r of rows) {
    console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name.padEnd(36)} ${r.ext.padEnd(5)} exact=${r.exact}(want ${r.expExact}) norm=${r.norm}(want ${r.expNorm}) trim=${r.trim}(want ${r.expTrim}) ${r.reason}`);
  }
  console.log(`${rows.filter((r) => r.ok).length}/${rows.length} as expected`);
}
