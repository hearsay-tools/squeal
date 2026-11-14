// Throwaway probe (spec 022 research, loaded-modules): do per-file loaded sets mix
// or undercount when files share a worker? Records with both the setup-file
// recorder (afterAll) and the custom-runner recorder (onAfterRunFiles).
// Usage: node scripts/isolation.mjs   (from $TMPDIR/lm-vitest)
import fs from "node:fs";
import path from "node:path";
import { SCRATCH, makeFixture, runVitest, load1 } from "./lib.mjs";

const variants = [
  ["forks-isolate", `pool: "forks", isolate: true, maxWorkers: 1`],
  ["forks-noisolate", `pool: "forks", isolate: false, maxWorkers: 1`],
  ["threads-isolate", `pool: "threads", isolate: true, maxWorkers: 1`],
  ["threads-noisolate", `pool: "threads", isolate: false, maxWorkers: 1`],
  ["threads-noisolate-nofileparallel", `pool: "threads", isolate: false, fileParallelism: false`],
  ["vmThreads", `pool: "vmThreads", maxWorkers: 1`],
  ["vmForks", `pool: "vmForks", maxWorkers: 1`],
];
const out = [];
for (const [name, opts] of variants) {
  for (const via of ["setup", "runner"]) {
    const dir = path.join(SCRATCH, "isolation", `${name}-${via}`);
    const recorder = via === "setup" ? `setupFiles: ["./lm-recorder.ts"]` : `runner: "./lm-runner.ts"`;
    makeFixture(dir, {
      "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { ${recorder}, include: ["**/*.test.ts"], sequence: { shuffle: false }, ${opts} } });\n`,
      "shared.ts": "export const s = 1;\n",
      "onlyA.ts": "export const a = 1;\n",
      "1-a.test.ts": `import { test, expect } from "vitest";\nimport { s } from "./shared";\nimport { a } from "./onlyA";\ntest("a", () => expect(s + a).toBe(2));\n`,
      "2-b.test.ts": `import { test, expect } from "vitest";\nimport { s } from "./shared";\ntest("b", () => expect(s).toBe(1));\n`,
      "3-c.test.ts": `import { test, expect } from "vitest";\ntest("c", () => expect(1).toBe(1));\n`,
    });
    fs.copyFileSync(path.join(SCRATCH, "scripts", "lm-runner.ts"), path.join(dir, "lm-runner.ts"));
    const r = runVitest(dir, "run1");
    const row = { variant: name, via, statuses: Object.fromEntries(Object.entries(r.files).map(([k, v]) => [k, v.status ?? v])), load1: load1() };
    for (const [f, s] of Object.entries(r.sets)) {
      row[f] = { pid: s.pid, threadId: s.threadId, loaded: s.loadedFiles.filter((x) => !x.startsWith("<pnpm>") && !["fs", "path"].includes(x)), notEvaluatedNodes: s.notEvaluated.filter((x) => !x.startsWith("<pnpm>")) };
    }
    out.push(row);
    console.log(JSON.stringify(row));
  }
}
fs.writeFileSync(path.join(SCRATCH, "results-isolation.json"), JSON.stringify(out, null, 1));
