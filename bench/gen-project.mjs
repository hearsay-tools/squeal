#!/usr/bin/env node
// Writes a deterministic synthetic TypeScript + Vitest project for the benchmark.
// Usage: node gen-project.mjs <dir> <testFiles>
// Shape: modules in groups of 25. Each group is a binary tree: module k imports
// its parent, the group root imports only src/core.ts. An edit to a leaf touches
// one test file; an edit to a group root touches the whole group; an edit to
// src/core.ts touches every test file. Each test file runs 6 cases of about 15 ms
// of CPU each, so one file costs about 100 ms plus Vitest's per-file overhead.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, countArg] = process.argv.slice(2);
if (!dir || !countArg) {
  console.error("usage: gen-project.mjs <dir> <testFiles>");
  process.exit(2);
}
const count = Number(countArg);
export const GROUP = 25;
const parentOf = (i) => {
  const local = i % GROUP;
  return local === 0 ? null : i - local + Math.floor((local - 1) / 2);
};
const coreOf = (i) => i % 7;
// f_i(x) = f_parent(x) + core(i) + i ; root: x + core(i) + i
const expected = (i, x) => {
  const p = parentOf(i);
  return (p === null ? x : expected(p, x)) + coreOf(i) + i;
};

mkdirSync(join(dir, "src"), { recursive: true });
mkdirSync(join(dir, "test"), { recursive: true });
writeFileSync(
  join(dir, "package.json"),
  `${JSON.stringify(
    {
      name: "squeal-bench-project",
      private: true,
      type: "module",
      scripts: { test: "vitest run" },
      devDependencies: { vitest: "5.0.3", "@vitest/coverage-v8": "5.0.3" },
    },
    null,
    2,
  )}\n`,
);
writeFileSync(join(dir, "vitest.config.ts"), "export default { test: {} };\n");
writeFileSync(join(dir, ".gitignore"), "node_modules\n");
writeFileSync(join(dir, "squeal.config.json"), "{}\n");
writeFileSync(
  join(dir, "tsconfig.json"),
  `${JSON.stringify({ compilerOptions: { target: "es2022", module: "nodenext", strict: true, noEmit: true } }, null, 2)}\n`,
);
writeFileSync(
  join(dir, "src/core.ts"),
  "export const CORE_VERSION = 0;\nexport function core(n: number): number {\n  return n % 7;\n}\n",
);
for (let i = 0; i < count; i++) {
  const p = parentOf(i);
  const imports = [`import { core } from "./core.js";`];
  if (p !== null) imports.push(`import { f${p} } from "./m${p}.js";`);
  const base = p === null ? "x" : `f${p}(x)`;
  writeFileSync(
    join(dir, `src/m${i}.ts`),
    `${imports.join("\n")}\n\nexport const V${i} = 0;\n\nexport function f${i}(x: number): number {\n  return ${base} + core(${i}) + ${i};\n}\n`,
  );
  const cases = [0, 1, 2, 3, 4, 5]
    .map(
      (x) =>
        `  it("case ${x}", () => {\n    spin(15);\n    expect(f${i}(${x})).toBe(${expected(i, x)});\n  });`,
    )
    .join("\n");
  writeFileSync(
    join(dir, `test/m${i}.test.ts`),
    `import { describe, expect, it } from "vitest";\nimport { f${i} } from "../src/m${i}.js";\n\nfunction spin(ms: number): number {\n  const end = performance.now() + ms;\n  let n = 0;\n  while (performance.now() < end) n++;\n  return n;\n}\n\ndescribe("m${i}", () => {\n${cases}\n});\n`,
  );
}
console.log(JSON.stringify({ dir, testFiles: count, groups: Math.ceil(count / GROUP) }));
