// Throwaway: Candidate A per Node version. for v in ~/.nvm/versions/node/*/bin/node; do $v a-probe.mjs; done
import * as mod from "node:module";
const cases = {
  basic: "const x: number = 1;\nfunction f<T>(a: T): T { return a }\n",
  importType: "import type { A } from './a';\nimport { type B, C } from './b';\nimport { type D } from './side';\n",
  exportTypeStar: "export type * from './t';\n",
  iface: "interface I { a: number }\ntype T = string;\n",
  declare: "declare const z: number;\nclass K { declare y: number; x!: number; private p = 1; }\n",
  overload: "function g(a: string): void;\nfunction g(a: any) {}\n",
  abstract: "abstract class A { abstract m(): void; }\n",
  implements: "class B implements I { override readonly q = 1 }\n",
  thisParam: "function h(this: Window, a: number) {}\n",
  asSat: "const v = (1 as any) satisfies number;\nconst w = v!;\n",
  genericCall: "f<string>('a'); new Map<string, number>();\n",
  enum: "enum E { A, B }\n",
  constEnum: "const enum CE { A }\n",
  nsType: "namespace N { export type X = 1 }\n",
  nsValue: "namespace M { export const x = 1 }\n",
  declareNs: "declare namespace DN { const x: 1 }\n",
  paramProp: "class P { constructor(public x: number) {} }\n",
  decorator: "@dec class Q {}\n",
  using: "{ using r = res(); }\n",
  awaitUsing: "async function u() { await using r = res(); }\n",
  accessor: "class R { accessor a = 1 }\n",
  angleCast: "const c = <any>1;\n",
  jsx: "const j = <div>hi</div>;\n",
  importEq: "import fs = require('fs');\n",
  exportEq: "export = 1;\n",
  comments: "// c\nconst a = 1; /* b */\n",
};
const fn = mod.stripTypeScriptTypes;
console.log(process.version, typeof fn);
if (typeof fn !== "function") process.exit(0);
for (const mode of ["strip", "transform"]) {
  for (const [k, src] of Object.entries(cases)) {
    let out;
    try { out = JSON.stringify(fn(src, { mode })); } catch (e) { out = "THROW " + (e.code ?? "") + " " + String(e.message).split("\n")[0].slice(0, 90); }
    console.log(mode, k, out.slice(0, 160));
  }
}
