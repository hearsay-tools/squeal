// Throwaway probe (spec 022 research, loaded-modules): with
// experimental.viteModuleRunner false (Node's own loader), what does
// __vitest_worker__.evaluatedModules hold?
// Usage: node scripts/native-mode.mjs   (from $TMPDIR/lm-vitest)
import fs from "node:fs";
import path from "node:path";
import { SCRATCH, makeFixture, runVitest } from "./lib.mjs";
const dir = path.join(SCRATCH, "native-mode");
makeFixture(dir, {
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { setupFiles: ["./lm-recorder.ts"], include: ["**/*.test.ts"], experimental: { viteModuleRunner: false } } });\n`,
  "shared.ts": "export const s = 1;\n",
  "a.test.ts": `import { test, expect } from "vitest";\nimport { s } from "./shared.ts";\ntest("a", () => expect(s).toBe(1));\n`,
});
const r = runVitest(dir, "run1");
console.log(JSON.stringify({ files: r.files, sets: Object.fromEntries(Object.entries(r.sets).map(([k, v]) => [k, v.ids])), stderr: r.stderrTail }, null, 1));
