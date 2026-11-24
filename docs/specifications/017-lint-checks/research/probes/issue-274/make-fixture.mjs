#!/usr/bin/env node
// Throwaway (issue #274 research). Makes a synthetic ~3,000-file git repository
// under the directory given as argv[2]: nested folders, .ts/.json/.md files, a
// root .oxlintrc.json with a local TS JS plugin (its rules in other files, as
// the incident's lint plugin rule files), and 3 nested configs.
// argv[3] = "import" turns on oxlint's import plugin in the root config.
// argv[4] = path of an installed oxlint package (symlinked as node_modules/oxlint).
// argv[5] = packages (default 10, 300 files each). argv[6] = a @babel/parser package
// folder: the plugin then loads 70 more rule modules (~640 KB) and that parser, the
// shape of the issue's repository's plugin (read, not copied).
import { execFileSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [root, mode, oxlintDir, packagesArg, babelDir] = process.argv.slice(2);
const packages = Number(packagesArg ?? 10);
if (!root || !oxlintDir) throw new Error("usage: make-fixture.mjs <root> <plain|import> <oxlint package dir>");
const put = (rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};

let ts = 0, json = 0, md = 0;
for (let p = 0; p < packages; p++)
  for (let m = 0; m < 6; m++)
    for (let s = 0; s < 5; s++) {
      const dir = `packages/p${p}/src/m${m}/s${s}`;
      // 300 leaf folders x (7 ts + 2 json + 1 md) = 3,000 files.
      for (let f = 0; f < 7; f++) {
        const other = f === 0 ? "" : `import { v${f - 1} } from "./f${f - 1}";\n`;
        put(`${dir}/f${f}.ts`, `${other}export const v${f}: number = ${p * 1000 + m * 100 + s * 10 + f};\n`);
        ts++;
      }
      for (let f = 0; f < 2; f++) { put(`${dir}/d${f}.json`, JSON.stringify({ p, m, s, f }) + "\n"); json++; }
      put(`${dir}/README.md`, `# ${dir}\n`); md++;
    }

const plugins = mode === "import" ? ["typescript", "import"] : ["typescript"];
put(".oxlintrc.json", JSON.stringify({
  plugins,
  jsPlugins: ["./tools/lint/plugin.ts"],
  rules: { "no-debugger": "error", "local/no-foo": "warn", ...(mode === "import" ? { "import/no-cycle": "warn" } : {}) },
}, null, 2) + "\n");
const heavy = babelDir ? Array.from({ length: 70 }, (_, i) => i) : [];
for (const i of heavy) {
  const body = Array.from({ length: 120 }, (_, j) => `const k${j}: Record<string, number> = { a${j}: ${j}, b${j}: ${i} }; // padding line ${j} of rule ${i}`).join("\n");
  put(`tools/lint/rules/r${i}.ts`, `${i === 0 ? 'import { parse } from "@babel/parser";\nexport const parsed = typeof parse;\n' : ""}${body}\nexport const r${i} = { create(): Record<string, never> { return {}; } };\n`);
}
put("tools/lint/plugin.ts", `import { noFoo } from "./owner-reader-rules.ts";\nimport { enumLiteral } from "./test-enum-literal.ts";\n${heavy.map((i) => `import { r${i} } from "./rules/r${i}.ts";\n`).join("")}export default { meta: { name: "local" }, rules: { "no-foo": noFoo, "enum-literal": enumLiteral${heavy.map((i) => `, "r${i}": r${i}`).join("")} } };\n`);
put("tools/lint/owner-reader-rules.ts", `export const noFoo = { create(context: any) { return { Identifier(node: any) { if (node.name === "foo") context.report({ node, message: "no foo" }); } }; } };\n`);
put("tools/lint/test-enum-literal.ts", `export const enumLiteral = { create() { return {}; } };\n`);
for (const p of [0, 3, 7]) put(`packages/p${p}/.oxlintrc.json`, JSON.stringify({ rules: { "no-console": "warn" } }) + "\n");
put(".gitignore", "node_modules\n");
put("package.json", JSON.stringify({ name: "fixture-274", private: true, type: "module" }) + "\n");
mkdirSync(join(root, "node_modules"), { recursive: true });
symlinkSync(oxlintDir, join(root, "node_modules", "oxlint"));
if (babelDir) {
  mkdirSync(join(root, "node_modules", "@babel"), { recursive: true });
  symlinkSync(babelDir, join(root, "node_modules", "@babel", "parser"));
}
const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
git("init", "-q");
git("add", "-A");
git("-c", "user.email=p@example.invalid", "-c", "user.name=probe", "commit", "-qm", "fixture");
console.log(JSON.stringify({ root, mode, ts, json, md, total: ts + json + md + 7 }));
