// Throwaway probe (row 011-415): what Vite 8's TypeScript transform (rolldown's
// oxc transformSync, the function Vite's oxc plugin calls) keeps of each import
// form, with verbatimModuleSyntax on and off. Usage: node elision.mjs <vite-dir>
import { createRequire } from "node:module";
import { join } from "node:path";
const viteDir = process.argv[2];
const require = createRequire(join(viteDir, "package.json"));
const { transformSync } = await import(require.resolve("rolldown/utils"));
const cases = {
  "import type": `import type { A } from "./a"; export const x: A = 1 as any;`,
  "inline type only": `import { type A } from "./a"; export const x: A = 1 as any;`,
  "inline type + value": `import { type A, b } from "./a"; export const x: A = b;`,
  "value used as type only": `import { A } from "./a"; export const x: A = 1 as any;`,
  "value never used": `import { A } from "./a"; export const x = 1;`,
  "default never used": `import A from "./a"; export const x = 1;`,
  "namespace used as type only": `import * as A from "./a"; export const x: A.T = 1 as any;`,
  "side effect": `import "./a"; export const x = 1;`,
  "empty braces": `import {} from "./a"; export const x = 1;`,
  "export type from": `export type { A } from "./a";`,
  "export inline type from": `export { type A } from "./a";`,
  "export value from": `export { A } from "./a";`,
  "export * from": `export * from "./a";`,
  "export type * from": `export type * from "./a";`,
  "re-export of import used nowhere else": `import { A } from "./a"; export { A };`,
  "typeof only": `import { a } from "./a"; export type T = typeof a;`,
  "dynamic literal": `export const f = () => import("./a");`,
  "import equals require": `import a = require("./a"); export const x = a;`,
};
for (const vms of [true, false]) {
  for (const [name, src] of Object.entries(cases)) {
    const r = transformSync("/x/f.ts", src, { lang: "ts", sourcemap: false, tsconfig: { compilerOptions: { verbatimModuleSyntax: vms } } });
    const kept = /["']\.\/a["']/.test(r.code);
    console.log(`vms=${vms}\t${kept ? "KEEP" : "drop"}\t${name}\t${r.errors.length ? "ERR " + r.errors[0].message : r.code.replace(/\n/g, " ").slice(0, 70)}`);
  }
}
