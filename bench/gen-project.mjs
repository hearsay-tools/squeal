#!/usr/bin/env node
// Writes a deterministic synthetic TypeScript + Vitest project for the benchmark.
// Usage: node gen-project.mjs <dir> <testFiles> [--cases 6] [--functions 0]
// Shape: modules in groups of 25. Each group is a binary tree: module k imports
// its parent, the group root imports only src/core.ts. An edit to a leaf touches
// one test file; an edit to a group root touches the whole group; an edit to
// src/core.ts touches every test file. Each test file runs 6 cases of about 15 ms
// of CPU each, so one file costs about 100 ms plus Vitest's per-file overhead.
// Row 025-08, a real repository's scale: --cases sets the cases per test file, and
// --functions N adds src/h<i>.ts with N small exported functions, which the test
// file imports and its first case calls. The session never edits src/h<i>.ts.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { BENCH_DEPS } from "./lib.mjs";

const {
  values: opt,
  positionals: [dir, countArg],
} = parseArgs({
  allowPositionals: true,
  options: {
    cases: { type: "string", default: "6" },
    functions: { type: "string", default: "0" },
  },
});
if (!dir || !countArg) {
  console.error("usage: gen-project.mjs <dir> <testFiles> [--cases 6] [--functions 0]");
  process.exit(2);
}
const count = Number(countArg);
const caseCount = Number(opt.cases);
const functions = Number(opt.functions);
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
      devDependencies: BENCH_DEPS,
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
  // h<i>_k(x) = x + k: N one-line functions, as a real module holds many.
  if (functions > 0) {
    const fns = Array.from(
      { length: functions },
      (_, k) => `export function h${i}_${k}(x: number): number {\n  return x + ${k};\n}\n`,
    );
    writeFileSync(join(dir, `src/h${i}.ts`), fns.join("\n"));
  }
  const helper = functions > 0;
  const cases = Array.from({ length: caseCount }, (_, x) => x)
    .map(
      (x) =>
        `  it("case ${x}", () => {\n    spin(15);\n    expect(f${i}(${x})).toBe(${expected(i, x)});\n${helper && x === 0 ? `    expect(h${i}_0(${x})).toBe(${x});\n` : ""}  });`,
    )
    .join("\n");
  const helperImport = helper ? `import { h${i}_0 } from "../src/h${i}.js";\n` : "";
  writeFileSync(
    join(dir, `test/m${i}.test.ts`),
    `import { describe, expect, it } from "vitest";\nimport { f${i} } from "../src/m${i}.js";\n${helperImport}\nfunction spin(ms: number): number {\n  const end = performance.now() + ms;\n  let n = 0;\n  while (performance.now() < end) n++;\n  return n;\n}\n\ndescribe("m${i}", () => {\n${cases}\n});\n`,
  );
}
console.log(
  JSON.stringify({
    dir,
    testFiles: count,
    groups: Math.ceil(count / GROUP),
    checks: count * caseCount,
    functions: count * (1 + functions) + 1,
  }),
);
