// Throwaway probe (spec 022 research, loaded-modules): cost of reading the
// evaluated-modules map per test file, on a generated fixture of N modules.
// Usage: node scripts/cost.mjs [modules=300] [testFiles=20] [rounds=5]
// Alternates runs with and without the recording runner; skips a round while
// the one-minute load is above 24.
import fs from "node:fs";
import path from "node:path";
import { SCRATCH, makeFixture, runVitest, load1 } from "./lib.mjs";

const [N = 300, F = 20, ROUNDS = 5] = process.argv.slice(2).map(Number);
const dir = path.join(SCRATCH, "cost");
const files = {};
for (let i = 0; i < N; i++) {
  const deps = i === 0 ? [] : [Math.floor(i / 2), Math.floor((i - 1) / 3)].filter((d, k, a) => a.indexOf(d) === k);
  files[`src/m${i}.ts`] =
    deps.map((d) => `import { v as v${d} } from "./m${d}";`).join("\n") +
    `\nexport const v = ${i}${deps.map((d) => ` + v${d} * 0`).join("")};\nexport function f${i}(x: number) { return x + ${i}; }\n`;
}
// every module is reachable from the top: an index importing all leaves keeps the closure at N
files["src/index.ts"] = Array.from({ length: N }, (_, i) => `export { v as v${i} } from "./m${i}";`).join("\n") + "\n";
for (let t = 0; t < F; t++) {
  files[`t${t}.test.ts`] = `import { test, expect } from "vitest";\nimport * as all from "./src/index";\ntest("t${t}", () => expect(Object.keys(all).length).toBe(${N}));\n`;
}
const config = (rec) =>
  `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { ${rec ? `runner: "./lm-runner.ts",` : ""} include: ["*.test.ts"], maxWorkers: 4 } });\n`;
makeFixture(dir, { ...files, "vitest.config.ts": config(false) });
fs.copyFileSync(path.join(SCRATCH, "scripts", "lm-runner.ts"), path.join(dir, "lm-runner.ts"));
// warm-up run (Vite cache), not counted
runVitest(dir, "warm");
const rows = [];
for (let r = 0; r < ROUNDS; r++) {
  for (const rec of [false, true]) {
    const l = load1();
    if (l > 24) { rows.push({ round: r, rec, skipped: true, load1: l }); continue; }
    fs.writeFileSync(path.join(dir, "vitest.config.ts"), config(rec));
    const res = runVitest(dir, `r${r}-${rec ? "rec" : "plain"}`);
    const sets = Object.values(res.sets);
    const readMs = sets.map((s) => s.readMs);
    const passed = Object.values(res.files).filter((f) => f.status === "passed").length;
    const row = {
      round: r, rec, wallMs: res.wallMs, load1Before: l, load1After: load1(), passed,
      recorded: sets.length,
      loadedPerFile: sets.length ? Math.round(sets.reduce((a, s) => a + s.loadedFiles.length, 0) / sets.length) : null,
      readMsMax: readMs.length ? Math.max(...readMs) : null,
      readMsAvg: readMs.length ? readMs.reduce((a, b) => a + b, 0) / readMs.length : null,
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
fs.writeFileSync(path.join(SCRATCH, `results-cost-${N}.json`), JSON.stringify(rows, null, 1));
