// Throwaway (row 019-08): writes a fixture repository for instances.mjs.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, modulesArg = "200", testsArg = "20"] = process.argv.slice(2);
const modules = Number(modulesArg);
const tests = Number(testsArg);
mkdirSync(join(dir, "src"), { recursive: true });
mkdirSync(join(dir, "test"), { recursive: true });
writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", type: "module", private: true }));
writeFileSync(
  join(dir, "vitest.config.mjs"),
  'import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.mjs"], pool: "forks" } });\n',
);
for (let i = 0; i < modules; i += 1) {
  const dep = i === 0 ? "" : `import { f${i - 1} } from "./m${i - 1}.mjs";\n`;
  // About 2 KB of code per module, so the transform cache holds something.
  const body = Array.from({ length: 40 }, (_, j) => `  x = (x * 31 + ${j}) % 1000003;`).join("\n");
  const call = i === 0 ? "0" : `f${i - 1}(n)`;
  writeFileSync(
    join(dir, "src", `m${i}.mjs`),
    `${dep}export function f${i}(n) {\n  let x = n + ${call};\n${body}\n  return x;\n}\n`,
  );
}
for (let t = 0; t < tests; t += 1) {
  const target = Math.floor(((t + 1) * modules) / tests) - 1;
  writeFileSync(
    join(dir, "test", `t${t}.test.mjs`),
    `import { test, expect } from "vitest";\nimport { f${target} } from "../src/m${target}.mjs";\n` +
      `test("t${t}", () => { expect(typeof f${target}(${t})).toBe("number"); });\n`,
  );
}
