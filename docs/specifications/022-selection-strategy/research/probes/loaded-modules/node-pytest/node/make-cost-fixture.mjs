// Throwaway: generate a ~300-module node:test fixture. Module i (0..N-1) has
// children 2i+1, 2i+2; its kind by i % 3: .mjs (import), .cjs (require), .ts
// (import, type-stripped). t.test.mjs imports m0. Usage: node make-cost-fixture.mjs <dir> [N=300]
import { mkdirSync, writeFileSync } from "node:fs";
const [dir, n = "300"] = process.argv.slice(2);
const N = Number(n);
mkdirSync(`${dir}/m`, { recursive: true });
writeFileSync(`${dir}/package.json`, '{"name":"cost","private":true}\n');
const ext = (i) => [".mjs", ".cjs", ".ts"][i % 3];
const name = (i) => `./m${i}${ext(i)}`;
for (let i = 0; i < N; i++) {
  const kids = [2 * i + 1, 2 * i + 2].filter((k) => k < N);
  const body = `let x = ${i}; for (let j = 0; j < 50; j++) x = (x * 31 + j) % 1000003;`;
  let src;
  if (ext(i) === ".cjs") {
    src = `${kids.map((k, j) => `const c${j} = require("${name(k)}");`).join("\n")}\n${body}\nmodule.exports = { v: x${kids.map((_, j) => ` + (c${j}.v ?? c${j}.default?.v ?? 0)`).join("")} };\n`;
  } else {
    const t = ext(i) === ".ts" ? ": number" : "";
    src = `${kids.map((k, j) => `import * as c${j} from "${name(k)}";`).join("\n")}\n${body}\nexport const v${t} = x${kids.map((_, j) => ` + ((c${j} as any).v ?? (c${j} as any).default?.v ?? 0)`.replaceAll(ext(i) === ".ts" ? "" : " as any", "")).join("")};\n`;
    if (ext(i) !== ".ts") src = src.replaceAll(" as any)", ")").replaceAll("(c", "(c");
  }
  writeFileSync(`${dir}/m/m${i}${ext(i)}`, src);
}
writeFileSync(`${dir}/t.test.mjs`, `import { test } from "node:test";\nimport * as root from "./m/m0.mjs";\ntest("tree", () => { if (typeof root.v !== "number") throw new Error(String(root.v)); });\n`);
console.log(`wrote ${N} modules to ${dir}`);
