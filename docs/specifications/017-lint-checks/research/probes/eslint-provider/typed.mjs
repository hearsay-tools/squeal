// Throwaway probe (017-01). What a warm typescript-eslint project service sees
// of files it is not asked to lint. One process, in order; each line says what
// a fresh CLI would report and what the warm instance reported.
// Usage: node typed.mjs <project root>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { loadProjectESLint } from "./lib.mjs";

const root = process.argv[2];
const u = join(root, "src/u.ts"), tsconfig = join(root, "tsconfig.json");
const uBase = readFileSync(u, "utf8"), tsBase = readFileSync(tsconfig, "utf8");
const uPromise = uBase.replace("export function load(): number {\n  return 1;", "export function load(): Promise<number> {\n  return Promise.resolve(1);");
const { ESLint } = await loadProjectESLint(root);
let eslint = new ESLint({ cwd: root });

const rules = async (file) => (await eslint.lintFiles([file]))[0].messages.map((m) => m.ruleId ?? m.message.slice(0, 50)).join(",") || "none";
const cli = (file) => {
  const r = spawnSync("node", [join(root, "node_modules/eslint/bin/eslint.js"), "-f", "json", file], { cwd: root, encoding: "utf8" });
  return JSON.parse(r.stdout)[0].messages.map((m) => m.ruleId ?? m.message.slice(0, 50)).join(",") || "none";
};
const check = async (label, file) => console.log(`${label.padEnd(58)} warm=${await rules(file)}  cli=${cli(file)}`);

try {
  await check("1 start: lint t.ts", "src/t.ts");
  writeFileSync(u, uPromise);
  await check("2 u.ts now returns a Promise; lint t.ts only", "src/t.ts");
  eslint = new ESLint({ cwd: root });
  await check("3 new ESLint instance, same thread; lint t.ts", "src/t.ts");
  await rules("src/u.ts");
  await check("4 lint u.ts once, then t.ts", "src/t.ts");
  writeFileSync(u, uBase);
  await rules("src/u.ts");
  await check("5 u.ts reverted and linted; then t.ts", "src/t.ts");
  writeFileSync(tsconfig, tsBase.replace('"include": ["src/**/*.ts"]', '"include": ["src/**/*.ts"], "exclude": ["src/t.ts"]'));
  await check("6 tsconfig excludes t.ts; lint t.ts", "src/t.ts");
  eslint = new ESLint({ cwd: root });
  await check("7 new ESLint instance; lint t.ts", "src/t.ts");
} finally {
  writeFileSync(u, uBase);
  writeFileSync(tsconfig, tsBase);
}
