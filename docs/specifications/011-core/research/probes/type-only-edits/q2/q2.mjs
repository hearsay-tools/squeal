// 011-149 probe (throwaway): for each case, run its test with lib.A.ts and with lib.B.ts as lib.ts
// (Vitest, the squeal clone's install), and compare what Vite's oxc transform emits for the two.
// Then transform-only demos: decorators with metadata, enums, namespaces, parameter properties,
// and import elision under two tsconfig settings. Usage: node q2.mjs (from this folder)
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, readdirSync, mkdirSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { transformWithOxc } from "vite";
import { minifySync } from "rolldown/utils";

const bare = (js) => minifySync("x.js", js, { compress: false, mangle: false, module: true, codegen: { removeWhitespace: false, legalComments: "none" } }).code;
async function compare(a, b, file, options = {}) {
  const x = await transformWithOxc(a, file, { sourcemap: true, ...options });
  const y = await transformWithOxc(b, file, { sourcemap: true, ...options });
  let strip = "n/a";
  try { strip = stripTypeScriptTypes(a) === stripTypeScriptTypes(b) ? "same" : "differs"; } catch (e) { strip = e.code; }
  return { code: x.code === y.code ? "same" : "differs", mappings: x.map.mappings === y.map.mappings ? "same" : "differs",
    bare: bare(x.code) === bare(y.code) ? "same" : "differs", nodeStrip: strip };
}

mkdirSync("out", { recursive: true });
for (const name of readdirSync("cases")) {
  const dir = `cases/${name}`;
  const a = readFileSync(`${dir}/lib.A.ts`, "utf8"), b = readFileSync(`${dir}/lib.B.ts`, "utf8");
  const row = { case: name, emitted: await compare(a, b, `${process.cwd()}/${dir}/lib.ts`) };
  for (const v of ["A", "B"]) {
    copyFileSync(`${dir}/lib.${v}.ts`, `${dir}/lib.ts`);
    const out = `out/${name}.${v}.json`;
    try { execFileSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", dir, "--reporter=json", `--outputFile=${out}`, "--maxWorkers=1"], { stdio: "pipe" }); } catch { /* a failing run exits 1 */ }
    const r = JSON.parse(readFileSync(out, "utf8")).testResults[0];
    const t = r.assertionResults[0] ?? {};
    const where = (t.failureMessages?.[0] ?? r.message ?? "").split("\n").find((l) => l.includes("lib.ts:")) ?? "";
    row[v] = { status: t.status ?? r.status, libFrame: where.trim().replace(process.cwd(), ".") };
  }
  console.log(JSON.stringify(row));
}

const f = `${process.cwd()}/demo.ts`;
const deco = (t) => `function D(): PropertyDecorator { return () => {}; }\nexport class C { @D() p!: ${t}; }\n`;
const demos = {
  "decorator metadata, string -> number (experimentalDecorators + emitDecoratorMetadata)":
    [deco("string"), deco("number"), { decorator: { legacy: true, emitDecoratorMetadata: true } }],
  "decorator metadata, same edit without emitDecoratorMetadata":
    [deco("string"), deco("number"), { decorator: { legacy: true } }],
  "enum member value": ["export enum E { A = 1 }\n", "export enum E { A = 2 }\n", {}],
  "namespace": ["export namespace N { export const x = 1; }\n", "export namespace N { export const x: number = 1; }\n", {}],
  "parameter property type": ["export class P { constructor(public a: string) {} }\n", "export class P { constructor(public a: number) {} }\n", {}],
  "import of a type used only as a type, default settings": ['import { T } from "./t.js";\nexport const f = (x: T) => x;\n', 'import type { T } from "./t.js";\nexport const f = (x: T) => x;\n', {}],
  "the same edit under verbatimModuleSyntax (onlyRemoveTypeImports)": ['import { T } from "./t.js";\nexport const f = (x: T) => x;\n', 'import type { T } from "./t.js";\nexport const f = (x: T) => x;\n', { typescript: { onlyRemoveTypeImports: true } }],
};
for (const [label, [a, b, opts]] of Object.entries(demos)) console.log(JSON.stringify({ demo: label, ...(await compare(a, b, f, opts)) }));
const same = 'import { T } from "./t.js";\nexport const f = (x: T) => x;\n';
const off = (await transformWithOxc(same, f, {})).code, on = (await transformWithOxc(same, f, { typescript: { onlyRemoveTypeImports: true } })).code;
console.log(JSON.stringify({ demo: "same bytes, onlyRemoveTypeImports off vs on", code: off === on ? "same" : "differs", off, on }));
const d1 = (await transformWithOxc(deco("string"), f, { decorator: { legacy: true } })).code, d2 = (await transformWithOxc(deco("string"), f, { decorator: { legacy: true, emitDecoratorMetadata: true } })).code;
console.log(JSON.stringify({ demo: "same bytes, emitDecoratorMetadata off vs on", code: d1 === d2 ? "same" : "differs" }));
