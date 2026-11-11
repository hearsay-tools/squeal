// Throwaway probe (row 020-17, gh-175 study). Builds a synthetic "hub" repository
// under <dir>: src/hub.ts (K functions) is imported by every one of N test files
// through src/m/mod-<i>.ts; S side paths src/side-<j>.ts are each loaded by L of
// those test files too, spread evenly over the path order. Each test sleeps SLEEP ms. Commit 1 is the base; commit 2
// edits every hub and side function. node_modules is a symlink to the Squeal
// worktree's. Writes nothing outside <dir>.
// Usage: node fixture.mjs <dir> <N> [K=40] [S=8] [L=10] [SLEEP=40]
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const [dir, nArg, kArg = "40", sArg = "8", lArg = "10", sleepArg = "40"] = process.argv.slice(2);
const [N, K, S, L, SLEEP] = [nArg, kArg, sArg, lArg, sleepArg].map(Number);
const root = resolve(dir);
const modules = resolve(new URL("../../../../../../node_modules", import.meta.url).pathname);
rmSync(root, { recursive: true, force: true });
mkdirSync(join(root, "src/m"), { recursive: true });
mkdirSync(join(root, "test"), { recursive: true });
symlinkSync(modules, join(root, "node_modules"));
const w = (p, s) => writeFileSync(join(root, p), s);
const git = (...a) => execFileSync("git", ["-C", root, ...a], { stdio: "pipe" });
w("package.json", JSON.stringify({ name: "wide", private: true, type: "module" }));
w(".gitignore", "node_modules\n");
w("vitest.config.ts", `export default { test: { include: ["test/**/*.test.ts"] } };\n`);
w("squeal.config.json", JSON.stringify({ complexity: { enabled: true }, coverage: { enabled: true } }));
const hub = (edit) =>
  Array.from({ length: K }, (_, k) =>
    `export function f${k}(x: number): number {\n  if (x > ${k}) return x - ${k}${edit ? " + 0" : ""};\n  return x + ${k};\n}\n`,
  ).join("");
const side = (j, edit) =>
  `import { f${j % K} } from "./hub.ts";\nexport function s${j}(x: number): number {\n  return f${j % K}(x) * ${edit ? 3 : 2};\n}\nexport function t${j}(x: number): number {\n  return x > 0 ? s${j}(x) : 0;\n}\n`;
const log = join(root, "order.log");
const writeAll = (edit) => {
  w("src/hub.ts", hub(edit));
  for (let j = 0; j < S; j++) w(`src/side-${j}.ts`, side(j, edit));
};
writeAll(false);
for (let i = 0; i < N; i++) {
  // Side loaders are spread evenly over the path order (every stride-th file).
  const stride = Math.max(1, Math.floor(N / (S * L)));
  const q = i / stride;
  const usesSide = i % stride === 0 && q < S * L;
  const j = usesSide ? q % S : -1;
  w(`src/m/mod-${i}.ts`, `import { f${i % K} } from "../hub.ts";\nexport const g${i} = (x: number) => f${i % K}(x);\n`);
  const pad = String(i).padStart(5, "0");
  w(
    `test/t-${pad}.test.ts`,
    `import { appendFileSync } from "node:fs";\nimport { afterAll, expect, test } from "vitest";\nimport { g${i} } from "../src/m/mod-${i}.ts";\n` +
      (usesSide ? `import { t${j} } from "../src/side-${j}.ts";\n` : "") +
      `appendFileSync(${JSON.stringify(log)}, \`\${Date.now()} start ${pad}\\n\`);\n` +
      `afterAll(() => { appendFileSync(${JSON.stringify(log)}, \`\${Date.now()} end ${pad}\\n\`); });\n` +
      `test("t${i}", async () => {\n  await new Promise((r) => setTimeout(r, ${SLEEP}));\n  expect(g${i}(${i % 97})).toBeTypeOf("number");\n` +
      (usesSide ? `  expect(t${j}(1)).toBeTypeOf("number");\n` : "") +
      `});\n`,
  );
}
git("init", "-q", "-b", "main");
git("add", "-A");
git("-c", "user.email=p@x", "-c", "user.name=p", "commit", "-qm", "base");
writeAll(true);
git("add", "-A");
git("-c", "user.email=p@x", "-c", "user.name=p", "commit", "-qm", "edit hub and sides");
console.log(JSON.stringify({ root, N, K, S, L, SLEEP }));
